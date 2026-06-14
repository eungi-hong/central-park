"""Unit tests for the IntegratedML risk tool's feature extraction and fallback."""

from __future__ import annotations

import datetime as dt

import httpx

from central_park.tools import risk


def test_age_from_birthdate():
    year = dt.date.today().year
    ctx = {"patient": {"birthDate": f"{year - 53}-01-01"}}
    assert risk._age(ctx) in (52, 53)  # depends on month/day


def test_age_missing_is_zero():
    assert risk._age({"patient": {}}) == 0


def test_severity_from_observation():
    ctx = {"observations": [{"display": "Self-reported severity score", "value": "7"}]}
    assert risk._severity(ctx) == 7


def test_severity_default_when_absent():
    assert risk._severity({"observations": []}) == 5


def test_get_risk_score_falls_back_on_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("no model")

    monkeypatch.setattr(risk.httpx, "post", boom)
    out = risk.get_risk_score({"patient": {}, "conditions": [{"display": "x"}]})
    assert out["available"] is False
    assert out["features"]["comorbid"] == 1


def test_get_risk_score_unavailable_payload(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"available": 0}

    monkeypatch.setattr(risk.httpx, "post", lambda *a, **k: FakeResp())
    out = risk.get_risk_score({"patient": {}, "conditions": []})
    assert out["available"] is False
