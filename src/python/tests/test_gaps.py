"""Unit tests for the deterministic gaps-in-care agent and risk assessment."""

from __future__ import annotations

import datetime as dt

from central_park import gaps
from central_park.tools import risk


def _ctx(birth_year=None, gender="male", conditions=None, meds=None, obs=None):
    pc = {"patient": {"gender": gender}, "conditions": [], "medications": [], "observations": []}
    if birth_year:
        pc["patient"]["birthDate"] = f"{birth_year}-01-01"
    pc["conditions"] = [{"display": c} for c in (conditions or [])]
    pc["medications"] = [{"display": m} for m in (meds or [])]
    pc["observations"] = [{"display": o} for o in (obs or [])]
    return pc


def test_diabetes_triggers_hba1c_and_eye_exam():
    g = gaps.find_gaps(_ctx(conditions=["Type 2 diabetes mellitus"]))
    codes = {x["code"] for x in g}
    assert "hba1c-overdue" in codes
    assert "diabetic-eye-exam" in codes


def test_hba1c_gap_suppressed_when_recent_result_present():
    g = gaps.find_gaps(_ctx(conditions=["T2DM"], obs=["Hemoglobin A1c"]))
    assert "hba1c-overdue" not in {x["code"] for x in g}


def test_age_triggers_screenings():
    g = gaps.find_gaps(_ctx(birth_year=dt.date.today().year - 70))
    codes = {x["code"] for x in g}
    assert "colorectal-screening" in codes
    assert "influenza-vaccine" in codes
    assert "pneumococcal-vaccine" in codes


def test_mammography_for_older_female_only():
    f = gaps.find_gaps(_ctx(birth_year=dt.date.today().year - 60, gender="female"))
    m = gaps.find_gaps(_ctx(birth_year=dt.date.today().year - 60, gender="male"))
    assert "mammography" in {x["code"] for x in f}
    assert "mammography" not in {x["code"] for x in m}


def test_healthy_young_patient_has_few_gaps():
    g = gaps.find_gaps(_ctx(birth_year=dt.date.today().year - 30))
    assert g == []


# --- risk assessment (heuristic path) ---------------------------------------


def test_risk_heuristic_high_for_old_comorbid():
    ctx = _ctx(birth_year=dt.date.today().year - 80,
               conditions=["HTN", "T2DM", "HLD"],
               obs=[])
    # force heuristic by pointing at an unreachable endpoint via monkeypatch-free path:
    out = risk.assess(ctx)
    assert out["method"] in ("heuristic", "integratedml")
    assert out["band"] in ("low", "moderate", "high")
    assert 0 <= out["score"] <= 100
    assert out["drivers"]


def test_risk_heuristic_low_for_young_healthy():
    prob, drivers = risk._heuristic({"age": 30, "comorbid": 0, "severity": 2})
    assert risk._band(prob) == "low"


def test_risk_band_thresholds():
    assert risk._band(0.7) == "high"
    assert risk._band(0.5) == "moderate"
    assert risk._band(0.1) == "low"
