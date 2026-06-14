"""Gaps-in-care agent: deterministic preventive-care and monitoring checks.

A non-LLM agent that reads the patient's FHIR record (age, sex, active
conditions, recent observations) and flags overdue screenings, vaccinations,
and chronic-disease monitoring against simple, guideline-aligned rules. Each gap
can be written back to FHIR as a `Task` so it shows up as actionable work.

Deterministic by design: preventive-care rules are exactly the kind of logic
that should be auditable and not left to an LLM. The rule set is intentionally
small and demo-oriented, structured so adding a rule is a one-line change.
"""

from __future__ import annotations

import datetime as _dt
from typing import TypedDict


class CareGap(TypedDict):
    code: str
    title: str
    detail: str
    priority: str  # routine | urgent


def _age(patient_context: dict) -> int:
    bd = (patient_context.get("patient") or {}).get("birthDate")
    if not bd:
        return 0
    try:
        born = _dt.date.fromisoformat(bd[:10])
    except ValueError:
        return 0
    t = _dt.date.today()
    return t.year - born.year - ((t.month, t.day) < (born.month, born.day))


def _sex(patient_context: dict) -> str:
    return str((patient_context.get("patient") or {}).get("gender", "")).lower()


def _conditions_text(patient_context: dict) -> str:
    return " ".join(
        str(c.get("display", "")).lower() for c in patient_context.get("conditions", []) or []
    )


def _meds_text(patient_context: dict) -> str:
    return " ".join(
        str(m.get("display", "")).lower() for m in patient_context.get("medications", []) or []
    )


def _has_observation(patient_context: dict, *keywords: str) -> bool:
    obs = " ".join(
        str(o.get("display", "")).lower() for o in patient_context.get("observations", []) or []
    )
    return any(k in obs for k in keywords)


def find_gaps(patient_context: dict) -> list[CareGap]:
    """Return open care gaps for this patient."""
    age = _age(patient_context)
    sex = _sex(patient_context)
    conditions = _conditions_text(patient_context)
    meds = _meds_text(patient_context)
    gaps: list[CareGap] = []

    diabetes = "diabetes" in conditions or "t2dm" in conditions or "diabetic" in conditions
    hypertension = "hypertension" in conditions or "htn" in conditions
    respiratory = "copd" in conditions or "asthma" in conditions
    on_statin = any(s in meds for s in ("atorvastatin", "simvastatin", "rosuvastatin", "statin"))

    if diabetes and not _has_observation(patient_context, "a1c", "hba1c", "glycated"):
        gaps.append({
            "code": "hba1c-overdue",
            "title": "HbA1c monitoring",
            "detail": "Diabetic patient with no recent HbA1c on file; recommend testing (target every 3-6 months).",
            "priority": "routine",
        })
    if diabetes:
        gaps.append({
            "code": "diabetic-eye-exam",
            "title": "Annual diabetic eye exam",
            "detail": "Diabetes on the problem list; confirm an annual retinal screening is scheduled.",
            "priority": "routine",
        })
    if hypertension and not _has_observation(patient_context, "blood pressure", "systolic"):
        gaps.append({
            "code": "bp-monitoring",
            "title": "Blood-pressure monitoring",
            "detail": "Hypertension on the problem list with no recent BP reading recorded.",
            "priority": "routine",
        })
    if (diabetes or hypertension or on_statin) and not _has_observation(
        patient_context, "cholesterol", "lipid", "ldl"
    ):
        gaps.append({
            "code": "lipid-panel",
            "title": "Lipid panel",
            "detail": "Cardiovascular risk factors present with no recent lipid panel on file.",
            "priority": "routine",
        })
    if age >= 50:
        gaps.append({
            "code": "colorectal-screening",
            "title": "Colorectal cancer screening",
            "detail": f"Age {age}: confirm colorectal cancer screening is up to date.",
            "priority": "routine",
        })
    if (age >= 65) or respiratory:
        gaps.append({
            "code": "influenza-vaccine",
            "title": "Seasonal influenza vaccination",
            "detail": "Higher-risk group; confirm this season's influenza vaccination.",
            "priority": "routine",
        })
    if age >= 65:
        gaps.append({
            "code": "pneumococcal-vaccine",
            "title": "Pneumococcal vaccination",
            "detail": f"Age {age}: confirm pneumococcal vaccination status.",
            "priority": "routine",
        })
    if sex == "female" and 50 <= age <= 74:
        gaps.append({
            "code": "mammography",
            "title": "Mammography screening",
            "detail": f"Female, age {age}: confirm mammography is up to date (every 2 years).",
            "priority": "routine",
        })

    return gaps
