"""Lab explainer agent: plain-language explanation of recent lab results.

Read-only and patient-facing. Takes the patient's recent numeric Observations
and explains what each means in plain, non-alarming language, with a clear note
to follow up with their clinician. Grounded on the supplied results only.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import get_provider
from central_park.tools import get_patient_context

_log = logging.getLogger("central_park.labs")

_PROMPT = (pathlib.Path(__file__).parent / "prompts" / "labs.txt").read_text(encoding="utf-8")


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


def _numeric_observations(patient_context: dict) -> list[dict]:
    """Observations that carry a value worth explaining."""
    out = []
    for o in patient_context.get("observations", []) or []:
        if o.get("value") is not None and str(o.get("display", "")).strip():
            out.append({"display": o["display"], "value": o.get("value"), "unit": o.get("unit", "")})
    return out


def explain_labs(patient_id: str) -> dict:
    """Return plain-language explanations of the patient's recent results."""
    patient_context = get_patient_context(patient_id)
    results = _numeric_observations(patient_context)
    if not results:
        return {"explanations": [], "overall": "No recent test results are on file to explain."}
    payload = json.dumps({"results": results}, ensure_ascii=False)
    parsed = _loads(get_provider().complete(system=_PROMPT, messages=[{"role": "user", "content": payload}]))
    return {
        "explanations": parsed.get("explanations", []),
        "overall": parsed.get("overall", ""),
    }
