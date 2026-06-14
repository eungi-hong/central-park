"""Adaptive intake interview.

The v1 intake was a fixed six-question form. This module makes it agentic: after
the patient states their complaint, the model chooses the *next* question to ask
from what it has already heard plus the patient's FHIR risk factors, and stops
once it has enough to triage confidently.

The contract is one question at a time:

    next_question(patient_id, answers) -> {"done": bool, "question": {...} | None}

The frontend renders `question` (text / scale / choices), collects the answer,
appends it to `answers`, and calls again until `done`. A hard cap bounds the
interview so it always terminates, and any model/parse failure resolves to
`done` so a flaky call ends the interview gracefully rather than trapping the
patient in a loop.

Two link ids are reserved so the downstream FHIR Observation coding keeps
working (tools/fhir.py): `severity` (a 1-10 scale) and `associated-symptoms`
(the SNOMED-mapped checklist). The model is told to reuse them when it asks
those canonical questions; everything else gets a free-form link id.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import get_provider
from central_park.tools import get_patient_context, search_guidelines

_log = logging.getLogger("central_park.interview")

_PROMPT = (pathlib.Path(__file__).parent / "prompts" / "next_question.txt").read_text(encoding="utf-8")

# The interview always terminates: at most this many questions including the
# fixed opening complaint the client asks before the first /next call.
MAX_QUESTIONS = 7
# Don't stop before we have at least the complaint plus a couple of follow-ups.
MIN_QUESTIONS = 3

_VALID_KINDS = {"text", "scale", "choices"}


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


def _normalize_question(q: dict, asked_link_ids: set[str]) -> dict | None:
    """Validate and coerce a model-proposed question into the UI contract.

    Returns None if the question is malformed or duplicates one already asked,
    which the caller treats as "stop".
    """
    kind = q.get("kind")
    link_id = (q.get("link_id") or "").strip()
    prompt = (q.get("prompt") or "").strip()
    if kind not in _VALID_KINDS or not link_id or not prompt or link_id in asked_link_ids:
        return None

    out: dict = {
        "link_id": link_id,
        "kind": kind,
        "short": (q.get("short") or prompt)[:40],
        "prompt": prompt,
        "help": (q.get("help") or "").strip() or None,
    }
    if kind == "text":
        out["placeholder"] = (q.get("placeholder") or "").strip() or None
    elif kind == "scale":
        out["min"] = int(q.get("min", 1) or 1)
        out["max"] = int(q.get("max", 10) or 10)
        out["min_label"] = (q.get("min_label") or "Barely noticeable").strip()
        out["max_label"] = (q.get("max_label") or "Worst imaginable").strip()
    elif kind == "choices":
        none_option = (q.get("none_option") or "None of these").strip()
        # The UI appends none_option itself, so drop any echo of it from the
        # model's options (case-insensitive) and de-duplicate, otherwise the
        # patient sees two "None of these" rows.
        options: list[str] = []
        for o in q.get("options") or []:
            label = str(o).strip()
            if not label or label.casefold() == none_option.casefold():
                continue
            if any(label.casefold() == seen.casefold() for seen in options):
                continue
            options.append(label)
        if not options:
            return None
        out["options"] = options
        out["none_option"] = none_option
    return out


def next_question(patient_id: str, answers: list[dict]) -> dict:
    """Decide the next intake question, or that the interview is complete.

    `answers` is the list of {link_id, question, answer} gathered so far (the
    client sends the fixed opening complaint as the first entry). Returns
    {"done": True, "question": None} or {"done": False, "question": {...}}.
    """
    asked = {a.get("link_id", "") for a in answers}

    # Hard stop once the budget is spent.
    if len(answers) >= MAX_QUESTIONS:
        return {"done": True, "question": None}

    patient_context = get_patient_context(patient_id)
    # Seed retrieval from the complaint + earliest answers so the model sees the
    # guidelines relevant to what the patient has said so far.
    query = " ".join(a.get("answer", "") for a in answers[:3] if a.get("answer"))
    guidelines = search_guidelines(query, k=5) if query else []

    payload = json.dumps(
        {
            "patient_context": patient_context,
            "guidelines": guidelines,
            "answers_so_far": answers,
            "asked_link_ids": sorted(asked),
            "questions_asked": len(answers),
            "min_questions": MIN_QUESTIONS,
            "max_questions": MAX_QUESTIONS,
        },
        ensure_ascii=False,
    )
    try:
        parsed = _loads(get_provider().complete(system=_PROMPT, messages=[{"role": "user", "content": payload}]))
    except Exception as exc:
        _log.warning("next_question: provider call failed (%s); ending interview", exc)
        return {"done": True, "question": None}

    # The model may only declare itself done once the minimum is met; before that
    # we keep its proposed question even if it tried to stop early.
    wants_done = bool(parsed.get("done")) and len(answers) >= MIN_QUESTIONS
    if wants_done:
        return {"done": True, "question": None}

    question = _normalize_question(parsed.get("question") or {}, asked)
    if question is None:
        # No usable question proposed: end if we have the minimum, else fall back
        # to a safe generic follow-up so the interview still progresses.
        if len(answers) >= MIN_QUESTIONS:
            return {"done": True, "question": None}
        return {"done": False, "question": _FALLBACK_QUESTION}
    return {"done": False, "question": question}


# Used only when the model fails to produce a usable question before the minimum
# is reached. Keeps the interview moving without inventing clinical content.
_FALLBACK_QUESTION = {
    "link_id": "additional-detail",
    "kind": "text",
    "short": "Anything else",
    "prompt": "Is there anything else about how you're feeling that you think we should know?",
    "help": "Anything at all, in your own words.",
    "placeholder": None,
}
