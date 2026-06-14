"""Care-plan agent: draft a structured care plan from the patient's record.

Synthesizes the FHIR record into a short, guideline-flavoured care plan and
writes it back as a FHIR CarePlan. The plan is a draft for clinician review (it
is written with status "active" / intent "plan" but never auto-actioned), and it
never names specific drugs or doses.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import get_provider
from central_park.tools import create_care_plan, get_patient_context

_log = logging.getLogger("central_park.careplan")

_PROMPT = (pathlib.Path(__file__).parent / "prompts" / "careplan.txt").read_text(encoding="utf-8")


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


def draft_care_plan(patient_id: str) -> dict:
    """Generate and persist a draft care plan. Returns {title, activities, care_plan_id}."""
    patient_context = get_patient_context(patient_id)
    payload = json.dumps({"patient_context": patient_context}, ensure_ascii=False)
    parsed = _loads(get_provider().complete(system=_PROMPT, messages=[{"role": "user", "content": payload}]))
    title = parsed.get("title", "Care plan")
    activities = [a for a in parsed.get("activities", []) if isinstance(a, str) and a.strip()]

    care_plan_id = ""
    if activities:
        try:
            care_plan_id = create_care_plan(patient_id, title, activities)
        except Exception as exc:
            _log.warning("draft_care_plan: CarePlan write failed (%s)", exc)
    return {"title": title, "activities": activities, "care_plan_id": care_plan_id}
