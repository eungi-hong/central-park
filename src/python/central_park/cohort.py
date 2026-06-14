"""Cohort agent: population-level risk and care-gap aggregation.

Runs the deterministic risk and gaps agents across every patient in the FHIR
repository and returns a ranked roster plus aggregate counts, so a clinician can
see the whole panel at a glance (the population-dashboard pattern). Both
underlying agents are non-LLM, so this stays cheap even across the cohort.
"""

from __future__ import annotations

import logging
from collections import Counter

from central_park import gaps as gaps_agent
from central_park.tools import fhir_search, get_patient_context, risk

_log = logging.getLogger("central_park.cohort")

_BAND_RANK = {"high": 0, "moderate": 1, "low": 2}


def _empty() -> dict:
    return {
        "aggregates": {"total": 0, "high": 0, "moderate": 0, "low": 0, "open_gaps": 0, "avg_score": 0},
        "risk_distribution": [],
        "gaps_by_type": [],
        "top_conditions": [],
        "highest_risk": [],
    }


def assess_cohort(limit: int = 50) -> dict:
    """Population-level aggregates across the panel.

    Returns risk-band distribution, care gaps grouped by type, the most common
    conditions, and a short highest-risk list — designed for charts, not a
    patient roster.
    """
    try:
        found = fhir_search("Patient", {}, count=limit)
    except Exception as exc:
        _log.warning("assess_cohort: patient search failed (%s)", exc)
        return _empty()

    bands = {"high": 0, "moderate": 0, "low": 0}
    gap_counter: Counter[str] = Counter()
    condition_counter: Counter[str] = Counter()
    scores: list[int] = []
    ranked: list[dict] = []

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
        scores.append(assessment["score"])
        for g in gaps:
            gap_counter[g["title"]] += 1
        for c in ctx.get("conditions", []) or []:
            disp = str(c.get("display", "")).strip()
            if disp:
                condition_counter[disp] += 1
        ranked.append({
            "patient_id": pid,
            "name": row["display"] or pid,
            "risk_band": assessment["band"],
            "risk_score": assessment["score"],
        })

    total = len(ranked)
    ranked.sort(key=lambda p: (_BAND_RANK.get(p["risk_band"], 9), -p["risk_score"]))
    return {
        "aggregates": {
            "total": total,
            "high": bands["high"],
            "moderate": bands["moderate"],
            "low": bands["low"],
            "open_gaps": sum(gap_counter.values()),
            "avg_score": round(sum(scores) / total) if total else 0,
        },
        "risk_distribution": [
            {"band": b, "count": bands[b]} for b in ("high", "moderate", "low")
        ],
        "gaps_by_type": [
            {"title": title, "count": n} for title, n in gap_counter.most_common()
        ],
        "top_conditions": [
            {"display": disp, "count": n} for disp, n in condition_counter.most_common(6)
        ],
        "highest_risk": ranked[:5],
    }
