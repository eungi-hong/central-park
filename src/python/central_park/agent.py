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
import pathlib
from typing import Literal, TypedDict

from langgraph.graph import StateGraph, START, END

from central_park.llm import get_provider
from central_park.tools import create_alert, get_patient_context, search_guidelines

_PROMPT_PATH = pathlib.Path(__file__).parent / "prompts" / "triage.txt"
_SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")

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
    parsed = json.loads(raw)
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
