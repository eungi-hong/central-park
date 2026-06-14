"""LangGraph triage agent.

    START
      │
      ▼
    gather_context       <- pulls Patient, Conditions, Meds, Observations, Allergies
      │
      ▼
    retrieve_guidelines  <- vector search over the triage corpus
      │
      ▼
    validate_red_flags   <- deterministic safety gate (no LLM call)
      │
      ├── hard red flag matched  ─────────────────────────────▶ escalate ──▶ END
      └── clear                                                      │
              │                                                      │
              ▼                                                      │
    reason   <- agentic tool-using loop (ReAct): the model fetches  │
      │         more guidelines / observations on demand, then      │
      │         commits to a structured triage                      │
      ▼                                                              │
    verify   <- self-critique pass: grounds citations against what  │
      │         was retrieved and may ESCALATE (never downgrade)     │
      ├── level in {urgent-care, ed}  ──────────────▶ escalate ──────┘
      └── otherwise                          ──────────────────────▶ END

The agent layers three safety mechanisms, every one of them one-directional
(they can only raise acuity, never lower it):

  * validate_red_flags — a deterministic floor. Hard-coded emergency phrases
    short-circuit straight to ED before any LLM call, so a missed keyword can
    never lower the triage level below a matched red flag.
  * reason — a bounded tool-calling loop (see reasoning.reason_loop). The model
    decides what extra evidence it needs (refined guideline searches, specific
    observations) before committing. The loop is capped and falls back to a
    single structured call, so it always resolves.
  * verify — a self-critique reviewer (see reasoning.verify). It drops
    hallucinated citations deterministically and may escalate the level when the
    evidence warrants, but is forbidden from downgrading.
"""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Literal, TypedDict

_log = logging.getLogger("central_park.agent")

from langgraph.graph import StateGraph, START, END

from central_park import reasoning
from central_park.llm import get_provider
from central_park.tools import (
    create_alert,
    create_encounter,
    create_observations,
    create_service_request,
    get_patient_context,
    get_questionnaire_response,
    search_guidelines,
)

# The free-text triage path (the /run graph) reasons via reasoning.reason_loop,
# which owns the agent + single-shot prompts. This module only loads the handoff
# prompt used by the interview path below.
_HANDOFF_PROMPT_PATH = pathlib.Path(__file__).parent / "prompts" / "handoff.txt"
_HANDOFF_PROMPT = _HANDOFF_PROMPT_PATH.read_text(encoding="utf-8")

TriageLevel = Literal["self-care", "see-gp", "urgent-care", "ed"]


class TriageState(TypedDict, total=False):
    # Inputs
    patient_id: str
    message: str
    conversation_id: str | None
    # Populated during execution
    patient_context: dict
    guidelines: list[dict]
    level: TriageLevel
    summary: str
    citations: list[dict]
    red_flags: list[str]
    communication_id: str
    # Populated by the agentic reasoning loop + verifier
    retrieved_sources: list[str]
    tool_trace: list[dict]
    verifier_note: str


# --- nodes ------------------------------------------------------------------


def _gather_context(state: TriageState) -> dict:
    return {"patient_context": get_patient_context(state["patient_id"])}


def _retrieve_guidelines(state: TriageState) -> dict:
    return {"guidelines": search_guidelines(state["message"], k=5)}


# Hard emergency phrases. A non-negated match short-circuits to ED escalation
# before the LLM runs. Keys are lowercase substrings; values are the clinical
# reason surfaced to the clinician.
#
# Scope is deliberately narrow: only presentations that warrant the emergency
# department *regardless of context* (stroke signs, airway compromise,
# anaphylaxis, major haemorrhage, syncope, suicidal ideation). Nuanced cardiac
# complaints — chest pain, chest tightness — are intentionally NOT here: they
# are common and often benign, so they need the patient's FHIR risk factors and
# guideline retrieval to triage correctly. That reasoning is the LLM's job, and
# routing them through `reason` is what the flagship chest-tightness demo
# exercises. This gate is the floor for the can't-miss cases, not a replacement
# for clinical reasoning.
_RED_FLAG_PATTERNS: tuple[tuple[str, str], ...] = (
    # Airway / breathing
    ("can't breathe", "difficulty breathing"),
    ("cant breathe", "difficulty breathing"),
    ("can not breathe", "difficulty breathing"),
    ("cannot breathe", "difficulty breathing"),
    ("struggling to breathe", "difficulty breathing"),
    ("gasping for air", "difficulty breathing"),
    # Stroke (FAST)
    ("slurred speech", "slurred speech"),
    ("speech is slurred", "slurred speech"),
    ("face is drooping", "facial droop"),
    ("face drooping", "facial droop"),
    ("facial droop", "facial droop"),
    ("weakness on one side", "unilateral weakness"),
    ("one-sided weakness", "unilateral weakness"),
    ("numbness on one side", "unilateral numbness"),
    ("worst headache", "thunderclap headache"),
    # Circulation / consciousness
    ("passed out", "syncope"),
    ("pass out", "syncope"),
    ("fainted", "syncope"),
    ("unconscious", "loss of consciousness"),
    # Major bleeding
    ("coughing up blood", "hemoptysis"),
    ("vomiting blood", "hematemesis"),
    ("severe bleeding", "severe hemorrhage"),
    ("uncontrolled bleeding", "severe hemorrhage"),
    ("won't stop bleeding", "severe hemorrhage"),
    # Allergy / psych
    ("anaphylaxis", "anaphylaxis"),
    ("suicidal", "suicidal ideation"),
    ("kill myself", "suicidal ideation"),
)

# Negation tokens that, if they appear just before a matched phrase, void the
# match — so "no slurred speech" and "denies passing out" do not escalate.
_NEGATIONS: tuple[str, ...] = ("no ", "not ", "without ", "denies ", "deny ", "never ")


def _detect_red_flags(text: str) -> list[str]:
    """Return clinical reasons for each non-negated red-flag phrase in `text`."""
    lowered = text.lower()
    found: list[str] = []
    for keyword, reason in _RED_FLAG_PATTERNS:
        idx = lowered.find(keyword)
        if idx == -1:
            continue
        # Cheap negation guard: scan the ~20 chars immediately preceding the
        # match for a negation token ("no chest pain", "denies chest pain").
        window = lowered[max(0, idx - 20):idx]
        if any(neg in window for neg in _NEGATIONS):
            continue
        if reason not in found:
            found.append(reason)
    return found


def _validate_red_flags(state: TriageState) -> dict:
    """Deterministic safety gate, run before the LLM.

    Hits short-circuit straight to ED escalation without an LLM call; a clear
    scan falls through to `reason`. Returns an empty `red_flags` list when clear
    so the router can branch on it.
    """
    flags = _detect_red_flags(state.get("message", ""))
    if not flags:
        return {"red_flags": []}
    _log.info("validate_red_flags: hard escalation, matched %r", flags)
    summary = (
        "Deterministic red-flag screen matched: "
        + ", ".join(flags)
        + ". Escalated to the emergency department without LLM assessment as a "
        "safety precaution; immediate clinician review required."
    )
    return {"level": "ed", "summary": summary, "red_flags": flags, "citations": []}


def _reason(state: TriageState) -> dict:
    """Agentic tool-using reasoning loop (see reasoning.reason_loop)."""
    result = reasoning.reason_loop(
        get_provider(),
        patient_context=state["patient_context"],
        guidelines=state["guidelines"],
        message=state["message"],
    )
    return {
        "level": result["level"],
        "summary": result["summary"],
        "citations": result["citations"],
        "retrieved_sources": result["retrieved_sources"],
        "tool_trace": result["tool_trace"],
    }


def _verify(state: TriageState) -> dict:
    """Self-critique pass: ground citations, escalate-only (see reasoning.verify)."""
    result = reasoning.verify(
        get_provider(),
        level=state["level"],
        summary=state["summary"],
        citations=state.get("citations", []),
        patient_context=state["patient_context"],
        guidelines=state["guidelines"],
        message=state["message"],
        retrieved_sources=state.get("retrieved_sources", []),
    )
    return {
        "level": result["level"],
        "summary": result["summary"],
        "citations": result["citations"],
        "verifier_note": result["verifier_note"],
    }


def _escalate(state: TriageState) -> dict:
    comm_id = create_alert(
        patient_id=state["patient_id"],
        level=state["level"],
        summary=state["summary"],
    )
    return {"communication_id": comm_id}


def _route_red_flags(state: TriageState) -> Literal["escalate", "reason"]:
    return "escalate" if state.get("red_flags") else "reason"


def _route(state: TriageState) -> Literal["escalate", "end"]:
    return "escalate" if state.get("level") in ("urgent-care", "ed") else "end"


# --- graph ------------------------------------------------------------------


def _build_graph():
    g = StateGraph(TriageState)
    g.add_node("gather_context", _gather_context)
    g.add_node("retrieve_guidelines", _retrieve_guidelines)
    g.add_node("validate_red_flags", _validate_red_flags)
    g.add_node("reason", _reason)
    g.add_node("verify", _verify)
    g.add_node("escalate", _escalate)

    g.add_edge(START, "gather_context")
    g.add_edge("gather_context", "retrieve_guidelines")
    g.add_edge("retrieve_guidelines", "validate_red_flags")
    g.add_conditional_edges(
        "validate_red_flags", _route_red_flags, {"escalate": "escalate", "reason": "reason"}
    )
    # reason -> verify -> route. The verifier may escalate, so the routing
    # decision is made on its (possibly raised) level, not the reasoner's.
    g.add_edge("reason", "verify")
    g.add_conditional_edges("verify", _route, {"escalate": "escalate", "end": END})
    g.add_edge("escalate", END)
    return g.compile()


_GRAPH = _build_graph()


# --- shared FHIR persistence ------------------------------------------------


def _persist_fhir(
    patient_id: str,
    triage_level: str,
    chief_complaint: str,
    *,
    qr_id: str | None = None,
    qa_transcript: list[dict] | None = None,
    handoff: dict | None = None,
) -> dict:
    """Write the Encounter -> ServiceRequest -> Observation cascade for one triage.

    Shared by both entrypoints:
      - run_interview() supplies a QuestionnaireResponse id (linked on the
        Encounter) and a structured Q&A transcript (parsed into Observations).
      - run() (the free-text API path) supplies neither, so the Encounter has no
        QR linkage and no Observations are written — there is no structured Q&A
        to code. It still gets an Encounter + ServiceRequest so a direct API
        call leaves the same first-class FHIR footprint as the interview path.

    Every write is best-effort: failures are logged and the cascade continues,
    so a partial FHIR footprint never blocks the triage response.
    """
    encounter_id = ""
    service_request_id = ""
    observation_ids: list[str] = []

    try:
        encounter_id = create_encounter(patient_id, qr_id=qr_id)
    except Exception as exc:
        body = getattr(getattr(exc, "response", None), "text", "")
        _log.warning("create_encounter failed: %s | body: %s", exc, body)

    if encounter_id:
        try:
            service_request_id = create_service_request(
                patient_id, encounter_id, triage_level, chief_complaint, handoff=handoff
            )
        except Exception as exc:
            body = getattr(getattr(exc, "response", None), "text", "")
            _log.warning("create_service_request failed: %s | body: %s", exc, body)

        if qa_transcript:
            try:
                observation_ids = create_observations(patient_id, encounter_id, qa_transcript)
            except Exception as exc:
                _log.warning("create_observations failed: %s", exc)

    return {
        "encounter_id": encounter_id,
        "service_request_id": service_request_id,
        "observation_ids": observation_ids,
    }


# --- public entrypoint ------------------------------------------------------


def run_interview(patient_id: str, questionnaire_response_id: str) -> dict:
    """Generate a clinician handoff summary from a stored QuestionnaireResponse.

    Fetches the QR from FHIR by id, retrieves matching guidelines via vector
    search, then asks the LLM to produce a structured clinician handoff.
    Called from the FastAPI /interview endpoint.
    """
    provider = get_provider()
    patient_context = get_patient_context(patient_id)

    # Fetch the answers the patient gave during the interview.
    qa_transcript = get_questionnaire_response(questionnaire_response_id)

    # Use chief-complaint + onset answers as the vector search query.
    query = " ".join(
        item["answer"] for item in qa_transcript[:2] if item.get("answer")
    )
    guidelines = search_guidelines(query, k=5)

    user_payload = json.dumps(
        {
            "patient_context": patient_context,
            "guidelines": guidelines,
            "interview_transcript": [
                {"question": item["question"], "answer": item["answer"]}
                for item in qa_transcript
            ],
        },
        ensure_ascii=False,
    )
    raw = provider.complete(
        system=_HANDOFF_PROMPT,
        messages=[{"role": "user", "content": user_payload}],
    )
    try:
        parsed = json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        _log.warning("run_interview: LLM returned non-JSON: %r", raw[:200])
        parsed = {}
    triage_level = parsed.get("triage_level", "see-gp")
    chief_complaint = parsed.get("chief_complaint", "")
    hpi = parsed.get("hpi", "")
    citations = parsed.get("citations", [])

    # Same self-critique safeguards as the free-text path: ground citations
    # against what was retrieved, then run the escalate-only verifier so the
    # handoff inherits the agent's one-directional safety guarantee.
    retrieved_sources = [g["source"] for g in guidelines]
    verified = reasoning.verify(
        provider,
        level=triage_level,
        summary=hpi,
        citations=reasoning.ground_citations(citations, retrieved_sources),
        patient_context=patient_context,
        guidelines=guidelines,
        message=chief_complaint or query,
        retrieved_sources=retrieved_sources,
    )
    triage_level = verified["level"]
    hpi = verified["summary"]
    citations = verified["citations"]

    handoff = {
        "hpi": hpi,
        "recommended_actions": parsed.get("recommended_actions", []),
        "red_flags": parsed.get("red_flags", []),
        "citations": citations,
        "qr_id": questionnaire_response_id,
    }
    fhir = _persist_fhir(
        patient_id,
        triage_level,
        chief_complaint,
        qr_id=questionnaire_response_id,
        qa_transcript=qa_transcript,
        handoff=handoff,
    )

    return {
        "triage_level": triage_level,
        "chief_complaint": chief_complaint,
        "hpi": handoff["hpi"],
        "red_flags": handoff["red_flags"],
        "recommended_actions": handoff["recommended_actions"],
        "citations": handoff["citations"],
        "questionnaire_response_id": questionnaire_response_id,
        "encounter_id": fhir["encounter_id"],
        "service_request_id": fhir["service_request_id"],
        "observation_ids": fhir["observation_ids"],
    }


def run(patient_id: str, message: str, conversation_id: str | None = None) -> dict:
    """Invoke the agent and return its shaped result.

    Called from ObjectScript via:
        CentralPark.Operation.TriageAgent.InvokeAgent
    """
    final = _GRAPH.invoke(
        {
            "patient_id": patient_id,
            "message": message,
            "conversation_id": conversation_id,
        }
    )

    # The free-text path has no QuestionnaireResponse and no structured Q&A, so
    # the cascade writes an Encounter (no QR linkage) + ServiceRequest and skips
    # Observations. The patient's message stands in as the chief complaint.
    fhir = _persist_fhir(
        patient_id,
        final.get("level") or "see-gp",
        chief_complaint=message,
        handoff={
            "hpi": final.get("summary", ""),
            "red_flags": final.get("red_flags", []),
            "citations": final.get("citations", []),
        },
    )

    return {
        "level": final.get("level"),
        "summary": final.get("summary"),
        "citations": final.get("citations", []),
        "red_flags": final.get("red_flags", []),
        "communication_id": final.get("communication_id", ""),
        "encounter_id": fhir["encounter_id"],
        "service_request_id": fhir["service_request_id"],
        "observation_ids": fhir["observation_ids"],
    }
