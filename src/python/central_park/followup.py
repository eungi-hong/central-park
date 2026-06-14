"""Abnormal-results follow-up agent: deterministic flagging of out-of-range results.

Scans the patient's recent Observations and flags values that fall outside
simple, well-known thresholds (blood pressure, heart rate, temperature, glucose,
HbA1c, severity). Each flagged result becomes a follow-up item, written back as a
FHIR Task. Deterministic on purpose: "is this value abnormal" should not depend
on an LLM. Thresholds are intentionally conservative and demo-oriented.
"""

from __future__ import annotations

import re
from typing import TypedDict

from central_park.tools import create_tasks, get_patient_context


class FollowUp(TypedDict):
    observation: str
    value: str
    concern: str
    priority: str


# (keyword in observation display, comparison, threshold, concern, priority)
_RULES: tuple[tuple[str, str, float, str, str], ...] = (
    ("systolic", ">=", 140, "Elevated systolic blood pressure", "routine"),
    ("diastolic", ">=", 90, "Elevated diastolic blood pressure", "routine"),
    ("blood pressure", ">=", 140, "Elevated blood pressure", "routine"),
    ("heart rate", ">=", 100, "Tachycardia", "routine"),
    ("temperature", ">=", 38, "Fever", "routine"),
    ("glucose", ">=", 126, "Elevated blood glucose", "routine"),
    ("a1c", ">=", 6.5, "Elevated HbA1c", "routine"),
    ("severity", ">=", 8, "High self-reported symptom severity", "urgent"),
)


def _first_number(value: object) -> float | None:
    m = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(m.group()) if m else None


def find_followups(patient_context: dict) -> list[FollowUp]:
    """Return follow-up items for out-of-range recent results."""
    findings: list[FollowUp] = []
    seen: set[str] = set()
    for obs in patient_context.get("observations", []) or []:
        display = str(obs.get("display", ""))
        low = display.lower()
        num = _first_number(obs.get("value"))
        if num is None:
            continue
        for keyword, _cmp, threshold, concern, priority in _RULES:
            if keyword in low and num >= threshold and concern not in seen:
                seen.add(concern)
                findings.append({
                    "observation": display,
                    "value": f"{obs.get('value')} {obs.get('unit', '')}".strip(),
                    "concern": concern,
                    "priority": priority,
                })
                break
    return findings


def run_followup(patient_id: str) -> dict:
    """Flag abnormal results and write a Task per finding."""
    findings = find_followups(get_patient_context(patient_id))
    tasks = [
        {
            "code": "result-followup",
            "title": f"Follow up: {f['concern']}",
            "detail": f"{f['observation']} = {f['value']}. {f['concern']}; review and follow up.",
            "priority": f["priority"],
        }
        for f in findings
    ]
    task_ids = create_tasks(patient_id, tasks) if tasks else []
    return {"findings": findings, "task_ids": task_ids}
