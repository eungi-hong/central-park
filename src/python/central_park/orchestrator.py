"""Multi-agent orchestrator: a supervisor that routes and chains specialist agents.

A clinician asks for something in plain language ("summarize this patient, check
for interactions, and draft a care plan"). The supervisor LLM classifies the
request and dispatches to the right specialist agent(s) — and can chain several
in one request — then synthesizes a single answer.

This is the agent-of-agents pattern: the specialist agents (triage, risk, gaps,
summary, labs, follow-up, care-plan, FHIR query, grounded Q&A) are exposed to the
supervisor as callable tools. It routes like iris-fhir-agents' dispatcher, but
unlike the single-agent platforms it can coordinate multiple agents per request,
and each specialist keeps its own depth (the triage agent's ReAct loop, the
deterministic safety floor, the self-critique reviewer).

Bounded and resilient: the loop is capped and any agent failure is reported back
to the supervisor rather than aborting the request.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park import agent as triage_agent
from central_park import careplan, copilot, followup, gaps as gaps_agent, labs, query, summary
from central_park.llm import get_provider
from central_park.tools import create_tasks, get_patient_context, risk

_log = logging.getLogger("central_park.orchestrator")

_PROMPT = (pathlib.Path(__file__).parent / "prompts" / "orchestrator.txt").read_text(encoding="utf-8")

_MAX_STEPS = 5


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


# --- specialist agents exposed to the supervisor as tools -------------------
# Each returns a compact, JSON-serialisable result fed back to the supervisor.


def _run_triage(patient_id: str, args: dict) -> dict:
    message = args.get("message") or args.get("question") or ""
    out = triage_agent.run(patient_id, message)
    return {"level": out.get("level"), "summary": out.get("summary"), "detected_issues": out.get("detected_issues", [])}


def _run_summary(patient_id: str, args: dict) -> dict:
    return summary.summarize(patient_id)


def _run_labs(patient_id: str, args: dict) -> dict:
    return labs.explain_labs(patient_id)


def _run_gaps(patient_id: str, args: dict) -> dict:
    found = gaps_agent.find_gaps(get_patient_context(patient_id))
    task_ids = create_tasks(patient_id, found) if found else []
    return {"gaps": found, "task_ids": task_ids}


def _run_risk(patient_id: str, args: dict) -> dict:
    return risk.assess(get_patient_context(patient_id))


def _run_careplan(patient_id: str, args: dict) -> dict:
    return careplan.draft_care_plan(patient_id)


def _run_followup(patient_id: str, args: dict) -> dict:
    return followup.run_followup(patient_id)


def _run_query(patient_id: str, args: dict) -> dict:
    return query.run_query(args.get("question") or args.get("message") or "")


def _run_answer(patient_id: str, args: dict) -> dict:
    return copilot.answer_question(patient_id, args.get("question") or args.get("message") or "")


_AGENTS = {
    "triage": _run_triage,
    "summary": _run_summary,
    "labs": _run_labs,
    "gaps": _run_gaps,
    "risk": _run_risk,
    "careplan": _run_careplan,
    "followup": _run_followup,
    "query": _run_query,
    "answer": _run_answer,
}


def orchestrate(message: str, patient_id: str | None = None) -> dict:
    """Route `message` to the right specialist agent(s) and synthesize a reply.

    Returns {answer, steps: [{agent, args, result}]}. `patient_id` is required by
    the patient-specific agents; `query` works without one.
    """
    provider = get_provider()
    opening = {"message": message, "patient_id": patient_id}
    messages: list[dict] = [{"role": "user", "content": json.dumps(opening, ensure_ascii=False)}]
    steps: list[dict] = []

    for _ in range(_MAX_STEPS):
        parsed = _loads(provider.complete(system=_PROMPT, messages=messages))
        action = parsed.get("action")

        if action == "final" or not action:
            return {"answer": parsed.get("answer", "") or "Done.", "steps": steps}

        fn = _AGENTS.get(action)
        if fn is None:
            result: object = {"error": f"unknown agent {action!r}"}
        elif action not in ("query",) and not patient_id:
            result = {"error": f"{action} needs a patient_id"}
        else:
            try:
                result = fn(patient_id or "", parsed.get("args", {}) or {})
            except Exception as exc:  # an agent failure must not abort the request
                _log.warning("orchestrate: agent %s failed (%s)", action, exc)
                result = {"error": f"{action} failed"}

        steps.append({"agent": action, "args": parsed.get("args", {}), "result": result})
        messages.append({"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)})
        messages.append(
            {"role": "user", "content": json.dumps({"agent_result": {"agent": action, "result": result}}, ensure_ascii=False)}
        )

    # Budget spent: synthesize from whatever was gathered.
    _log.info("orchestrate: step budget exhausted")
    return {
        "answer": "I ran several agents; see the steps for details.",
        "steps": steps,
    }
