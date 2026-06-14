"""Cohort agent: population-level risk and care-gap aggregation.

Runs the deterministic risk and gaps agents across every patient in the FHIR
repository and returns a ranked roster plus aggregate counts, so a clinician can
see the whole panel at a glance (the population-dashboard pattern). Both
underlying agents are non-LLM, so this stays cheap even across the cohort.
"""

from __future__ import annotations

import logging

from central_park import gaps as gaps_agent
from central_park.tools import fhir_search, get_patient_context, risk

_log = logging.getLogger("central_park.cohort")

_BAND_RANK = {"high": 0, "moderate": 1, "low": 2}


def assess_cohort(limit: int = 50) -> dict:
    """Return {patients (ranked, highest risk first), aggregates}."""
    try:
        found = fhir_search("Patient", {}, count=limit)
    except Exception as exc:
        _log.warning("assess_cohort: patient search failed (%s)", exc)
        return {"patients": [], "aggregates": {"total": 0, "high": 0, "moderate": 0, "low": 0, "open_gaps": 0}}

    patients: list[dict] = []
    bands = {"high": 0, "moderate": 0, "low": 0}
    open_gaps = 0

    for row in found["results"]:
        pid = row["id"]
        if not pid:
            continue
        try:
            ctx = get_patient_context(pid)
        except Exception:
            continue
        assessment = risk.assess(ctx)
        gaps = gaps_agent.find_gaps(ctx)
        bands[assessment["band"]] = bands.get(assessment["band"], 0) + 1
        open_gaps += len(gaps)
        patients.append({
            "patient_id": pid,
            "name": row["display"] or pid,
            "risk_band": assessment["band"],
            "risk_score": assessment["score"],
            "risk_method": assessment["method"],
            "gaps": len(gaps),
        })

    patients.sort(key=lambda p: (_BAND_RANK.get(p["risk_band"], 9), -p["risk_score"]))
    return {
        "patients": patients,
        "aggregates": {
            "total": len(patients),
            "high": bands["high"],
            "moderate": bands["moderate"],
            "low": bands["low"],
            "open_gaps": open_gaps,
        },
    }
