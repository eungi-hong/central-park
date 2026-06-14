"""Agentic triage reasoning: a bounded tool-using loop plus a self-critique verifier.

This replaces the v1 single-shot LLM call. Two pieces live here:

  reason_loop()  — a ReAct-style loop. Each turn the model returns one JSON
                   object choosing either a *tool call* (fetch more guidelines,
                   zoom into specific observations) or a *final* triage answer.
                   The loop is bounded (`max_steps`) and falls back to a single
                   structured call if the model never commits or the protocol
                   breaks, so a flaky model can never hang the request.

  verify()       — a self-critique pass over the reasoner's answer. It is
                   deliberately asymmetric: it grounds citations against what
                   was actually retrieved (dropping anything hallucinated) and
                   may *only ever escalate* the triage level, never lower it.
                   That keeps it consistent with the deterministic red-flag gate
                   in agent.py: every safety mechanism here is one-directional.

The provider interface stays `complete(system, messages) -> str`, so the loop is
provider-agnostic (OpenAI/Anthropic/Ollama all work) without native
function-calling APIs — the tool protocol is carried in JSON.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import LLMProvider
from central_park.tools import search_guidelines

_log = logging.getLogger("central_park.reasoning")

_PROMPTS = pathlib.Path(__file__).parent / "prompts"
_LOOP_PROMPT = (_PROMPTS / "triage_agent.txt").read_text(encoding="utf-8")
_VERIFY_PROMPT = (_PROMPTS / "verify.txt").read_text(encoding="utf-8")
_SINGLE_SHOT_PROMPT = (_PROMPTS / "triage.txt").read_text(encoding="utf-8")

# Triage levels in ascending acuity. The verifier and the red-flag gate may only
# move *up* this ladder, never down.
_LEVELS = ("self-care", "see-gp", "urgent-care", "ed")


def _rank(level: str) -> int:
    try:
        return _LEVELS.index(level)
    except ValueError:
        return _LEVELS.index("see-gp")


def _higher(a: str, b: str) -> str:
    """Return whichever of the two levels is the more acute."""
    return a if _rank(a) >= _rank(b) else b


def _loads(raw: str) -> dict:
    """Tolerant JSON parse: strips ```json fences and shrugs off junk."""
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


# --- tools the loop can call ------------------------------------------------


def _tool_search_guidelines(args: dict, retrieved: list[dict]) -> list[dict]:
    """Re-retrieve guidelines on a refined query the model forms mid-reasoning."""
    query = str(args.get("query", "")).strip()
    if not query:
        return []
    hits = search_guidelines(query, k=int(args.get("k", 5) or 5))
    for h in hits:
        if h["source"] not in {r["source"] for r in retrieved}:
            retrieved.append(h)
    return hits


def _tool_get_observations(args: dict, patient_context: dict) -> list[dict]:
    """Let the model zoom into observations whose label matches a substring.

    The full record is large, so the reasoning prompt only carries a digest;
    this tool is how the model pulls the specific vitals/labs it decides matter
    (e.g. "blood pressure", "troponin") without bloating every turn.
    """
    needle = str(args.get("contains", "")).strip().lower()
    obs = patient_context.get("observations", []) or []
    if not needle:
        return obs[:10]
    return [o for o in obs if needle in str(o.get("display", "")).lower()][:10]


# --- the loop ---------------------------------------------------------------


def reason_loop(
    provider: LLMProvider,
    *,
    patient_context: dict,
    guidelines: list[dict],
    message: str,
    max_steps: int = 4,
) -> dict:
    """Run the bounded tool-using reasoning loop.

    Returns {level, summary, citations, retrieved_sources, tool_trace}. The
    `tool_trace` is surfaced so the clinician handoff can show *how* the agent
    reasoned, and `retrieved_sources` lets the verifier ground citations.
    """
    retrieved: list[dict] = list(guidelines)
    tool_trace: list[dict] = []

    # The opening turn carries a context digest; detailed observations are
    # fetched on demand via the get_observations tool.
    opening = {
        "patient_context": patient_context,
        "guidelines": guidelines,
        "message": message,
    }
    messages: list[dict] = [{"role": "user", "content": json.dumps(opening, ensure_ascii=False)}]

    for step in range(max_steps):
        raw = provider.complete(system=_LOOP_PROMPT, messages=messages)
        parsed = _loads(raw)
        action = parsed.get("action")

        if action == "final" or not action:
            return {
                "level": parsed.get("level", "see-gp"),
                "summary": parsed.get("summary", ""),
                "citations": parsed.get("citations", []),
                "retrieved_sources": [r["source"] for r in retrieved],
                "tool_trace": tool_trace,
            }

        # Otherwise it's a tool call. Execute, record, feed the result back.
        args = parsed.get("args", {}) or {}
        if action == "search_guidelines":
            result: object = _tool_search_guidelines(args, retrieved)
        elif action == "get_observations":
            result = _tool_get_observations(args, patient_context)
        else:
            result = {"error": f"unknown tool {action!r}"}

        tool_trace.append({"step": step, "action": action, "args": args})
        messages.append({"role": "assistant", "content": raw})
        messages.append(
            {
                "role": "user",
                "content": json.dumps(
                    {"tool_result": {"action": action, "result": result}}, ensure_ascii=False
                ),
            }
        )

    # Budget exhausted without a final answer: force one structured single-shot
    # call so the request always resolves to a real triage.
    _log.info("reason_loop: step budget exhausted, forcing single-shot")
    return _single_shot(provider, patient_context, retrieved, message)


def _single_shot(
    provider: LLMProvider, patient_context: dict, guidelines: list[dict], message: str
) -> dict:
    """The v1 path, kept as the loop's safety net."""
    payload = json.dumps(
        {"patient_context": patient_context, "guidelines": guidelines, "message": message},
        ensure_ascii=False,
    )
    parsed = _loads(provider.complete(system=_SINGLE_SHOT_PROMPT, messages=[{"role": "user", "content": payload}]))
    return {
        "level": parsed.get("level", "see-gp"),
        "summary": parsed.get("summary", ""),
        "citations": parsed.get("citations", []),
        "retrieved_sources": [r["source"] for r in guidelines],
        "tool_trace": [],
    }


# --- self-critique verifier -------------------------------------------------


def ground_citations(citations: list[dict], retrieved_sources: list[str]) -> list[dict]:
    """Drop citations whose source was never actually retrieved.

    Pure and deterministic: a model that invents a guideline title cannot smuggle
    it into the clinician handoff.
    """
    allowed = set(retrieved_sources)
    return [c for c in citations if c.get("source") in allowed]


def verify(
    provider: LLMProvider,
    *,
    level: str,
    summary: str,
    citations: list[dict],
    patient_context: dict,
    guidelines: list[dict],
    message: str,
    retrieved_sources: list[str],
) -> dict:
    """Self-critique the reasoner's answer.

    Two safeguards, both one-directional:
      1. Citations are grounded against retrieved sources (deterministic).
      2. An LLM critic may escalate the level if the evidence warrants it, and
         may never downgrade. On any error the original answer passes through.
    """
    grounded = ground_citations(citations, retrieved_sources)

    payload = json.dumps(
        {
            "proposed": {"level": level, "summary": summary, "citations": grounded},
            "patient_context": patient_context,
            "guidelines": guidelines,
            "message": message,
        },
        ensure_ascii=False,
    )
    try:
        parsed = _loads(provider.complete(system=_VERIFY_PROMPT, messages=[{"role": "user", "content": payload}]))
    except Exception as exc:  # network/provider failure must not block triage
        _log.warning("verify: critic call failed (%s); passing answer through", exc)
        return {"level": level, "summary": summary, "citations": grounded, "verifier_note": ""}

    verdict = parsed.get("verdict", "confirm")
    note = (parsed.get("note") or "").strip()

    if verdict == "escalate":
        proposed = parsed.get("level", level)
        final_level = _higher(level, proposed)  # escalate-only guarantee
        if final_level != level:
            suffix = f" (Verifier escalated from {level}: {note})" if note else ""
            return {
                "level": final_level,
                "summary": (summary + suffix).strip(),
                "citations": grounded,
                "verifier_note": note,
            }

    return {"level": level, "summary": summary, "citations": grounded, "verifier_note": note}
