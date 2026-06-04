"""LangGraph triage agent.

The graph has four nodes:

    START
      │
      ▼
    gather_context   <- pulls Patient, Conditions, Meds, Observations, Allergies
      │
      ▼
    retrieve_guidelines  <- vector search over the triage corpus
      │
      ▼
    reason   <- single LLM call, returns structured JSON
      │
      ├── level in {urgent-care, ed}  ──▶ escalate ──▶ END
      └── otherwise                          ───────▶ END

Keeping the graph deterministic (single LLM call, no looping tool use) is a
v1 choice: it's easier to demo on video, easier to evaluate, easier to add
guardrails to. Iteration 2 can branch into a loop with tool-calling if the
single-shot version turns out to be too brittle on edge cases.
"""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Literal, TypedDict

_log = logging.getLogger("central_park.agent")

from langgraph.graph import StateGraph, START, END

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

_PROMPT_PATH = pathlib.Path(__file__).parent / "prompts" / "triage.txt"
_SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")

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
    communication_id: str


# --- nodes ------------------------------------------------------------------


def _gather_context(state: TriageState) -> dict:
    return {"patient_context": get_patient_context(state["patient_id"])}


def _retrieve_guidelines(state: TriageState) -> dict:
    return {"guidelines": search_guidelines(state["message"], k=5)}


def _reason(state: TriageState) -> dict:
    provider = get_provider()
    user_payload = json.dumps(
        {
            "patient_context": state["patient_context"],
            "guidelines": state["guidelines"],
            "message": state["message"],
        },
        ensure_ascii=False,
    )
    raw = provider.complete(
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_payload}],
    )
    try:
        parsed = json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        _log.warning("_reason: LLM returned non-JSON: %r", raw[:200])
        parsed = {}
    return {
        "level": parsed.get("level", "see-gp"),
        "summary": parsed.get("summary", ""),
        "citations": parsed.get("citations", []),
    }


def _escalate(state: TriageState) -> dict:
    comm_id = create_alert(
        patient_id=state["patient_id"],
        level=state["level"],
        summary=state["summary"],
    )
    return {"communication_id": comm_id}


def _route(state: TriageState) -> Literal["escalate", "end"]:
    return "escalate" if state.get("level") in ("urgent-care", "ed") else "end"


# --- graph ------------------------------------------------------------------


def _build_graph():
    g = StateGraph(TriageState)
    g.add_node("gather_context", _gather_context)
    g.add_node("retrieve_guidelines", _retrieve_guidelines)
    g.add_node("reason", _reason)
    g.add_node("escalate", _escalate)

    g.add_edge(START, "gather_context")
    g.add_edge("gather_context", "retrieve_guidelines")
    g.add_edge("retrieve_guidelines", "reason")
    g.add_conditional_edges("reason", _route, {"escalate": "escalate", "end": END})
    g.add_edge("escalate", END)
    return g.compile()


_GRAPH = _build_graph()


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

    encounter_id = ""
    service_request_id = ""
    try:
        encounter_id = create_encounter(patient_id, qr_id=questionnaire_response_id)
    except Exception as exc:
        body = getattr(getattr(exc, "response", None), "text", "")
        _log.warning("create_encounter failed: %s | body: %s", exc, body)
    observation_ids: list[str] = []
    try:
        if encounter_id:
            service_request_id = create_service_request(
                patient_id, encounter_id, triage_level, chief_complaint
            )
    except Exception as exc:
        body = getattr(getattr(exc, "response", None), "text", "")
        _log.warning("create_service_request failed: %s | body: %s", exc, body)
    try:
        if encounter_id:
            observation_ids = create_observations(patient_id, encounter_id, qa_transcript)
    except Exception as exc:
        _log.warning("create_observations failed: %s", exc)

    return {
        "triage_level": triage_level,
        "chief_complaint": chief_complaint,
        "hpi": parsed.get("hpi", ""),
        "red_flags": parsed.get("red_flags", []),
        "recommended_actions": parsed.get("recommended_actions", []),
        "citations": parsed.get("citations", []),
        "questionnaire_response_id": questionnaire_response_id,
        "encounter_id": encounter_id,
        "service_request_id": service_request_id,
        "observation_ids": observation_ids,
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
    return {
        "level": final.get("level"),
        "summary": final.get("summary"),
        "citations": final.get("citations", []),
        "communication_id": final.get("communication_id", ""),
    }
