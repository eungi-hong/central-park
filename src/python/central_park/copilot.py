"""Clinician copilot agent: read-only, grounded Q&A over one patient's record.

A clinician reviewing a case can ask free-text questions ("why ED?", "any
interaction with their warfarin?", "what's their kidney function?"). This agent
answers them, grounded on the patient's FHIR record, the retrieved triage
guidelines, and the deterministic safety screen. It is strictly read-only: it
never writes to FHIR and never changes a triage. That keeps it safe to expose in
the console and clearly separated from the triage agents that own clinical
decisions.

It reuses the same bounded JSON tool-loop protocol as the triage reasoner, so
the model can pull more guidelines or zoom into observations before answering,
then returns {answer, citations}.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import get_provider
from central_park.tools import get_patient_context, safety, search_guidelines

_log = logging.getLogger("central_park.copilot")

_PROMPT = (pathlib.Path(__file__).parent / "prompts" / "copilot.txt").read_text(encoding="utf-8")

_MAX_STEPS = 4


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


def _get_observations(patient_context: dict, contains: str) -> list[dict]:
    needle = (contains or "").strip().lower()
    obs = patient_context.get("observations", []) or []
    if not needle:
        return obs[:10]
    return [o for o in obs if needle in str(o.get("display", "")).lower()][:10]


def answer_question(patient_id: str, question: str) -> dict:
    """Answer a clinician's question about a patient. Returns {answer, citations}."""
    provider = get_provider()
    patient_context = get_patient_context(patient_id)
    guidelines = search_guidelines(question, k=5)
    retrieved = list(guidelines)
    # Surface the deterministic safety screen so the copilot can speak to
    # interactions without re-deriving them from scratch.
    detected_issues = safety.screen(patient_context, question)

    opening = {
        "patient_context": patient_context,
        "guidelines": guidelines,
        "detected_issues": detected_issues,
        "question": question,
    }
    messages: list[dict] = [{"role": "user", "content": json.dumps(opening, ensure_ascii=False)}]

    for _ in range(_MAX_STEPS):
        parsed = _loads(provider.complete(system=_PROMPT, messages=messages))
        action = parsed.get("action")

        if action == "final" or not action:
            return {
                "answer": parsed.get("answer", "")
                or "I could not find enough in the record to answer that confidently.",
                "citations": parsed.get("citations", []),
            }

        args = parsed.get("args", {}) or {}
        if action == "search_guidelines":
            hits = search_guidelines(str(args.get("query", "")), k=int(args.get("k", 5) or 5))
            for h in hits:
                if h["source"] not in {r["source"] for r in retrieved}:
                    retrieved.append(h)
            result: object = hits
        elif action == "get_observations":
            result = _get_observations(patient_context, str(args.get("contains", "")))
        else:
            result = {"error": f"unknown tool {action!r}"}

        messages.append({"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)})
        messages.append(
            {"role": "user", "content": json.dumps({"tool_result": {"action": action, "result": result}}, ensure_ascii=False)}
        )

    _log.info("copilot: step budget exhausted for patient %s", patient_id)
    return {
        "answer": "I need more information than the record provides to answer that confidently.",
        "citations": [],
    }
