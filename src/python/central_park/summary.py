"""Patient summary agent: a role-aware clinical summary from the FHIR record.

Read-only. Synthesizes the patient's standing record (problems, medications,
recent results, allergies) into a concise summary tuned for a clinician or a
patient audience. Grounded only on the supplied record.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import get_provider
from central_park.tools import get_patient_context

_log = logging.getLogger("central_park.summary")

_PROMPT = (pathlib.Path(__file__).parent / "prompts" / "summary.txt").read_text(encoding="utf-8")


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


def summarize(patient_id: str, audience: str = "clinician") -> dict:
    """Return a structured summary of the patient for the given audience."""
    patient_context = get_patient_context(patient_id)
    payload = json.dumps(
        {"patient_context": patient_context, "audience": audience}, ensure_ascii=False
    )
    parsed = _loads(get_provider().complete(system=_PROMPT, messages=[{"role": "user", "content": payload}]))
    return {
        "headline": parsed.get("headline", ""),
        "summary": parsed.get("summary", ""),
        "key_problems": parsed.get("key_problems", []),
        "active_medications": parsed.get("active_medications", []),
        "cautions": parsed.get("cautions", []),
        "audience": audience,
    }
