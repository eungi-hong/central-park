"""Unit tests for the follow-up agent and the NL->FHIR query agent's validation."""

from __future__ import annotations

from central_park import followup, query


def _ctx(obs):
    return {"observations": [{"display": d, "value": v, "unit": u} for d, v, u in obs]}


# --- abnormal-results follow-up (deterministic) -----------------------------


def test_followup_flags_high_systolic():
    f = followup.find_followups(_ctx([("Systolic blood pressure", 150, "mmHg")]))
    assert any("systolic" in x["concern"].lower() for x in f)


def test_followup_clean_when_normal():
    assert followup.find_followups(_ctx([("Heart rate", 72, "/min")])) == []


def test_followup_high_severity_is_urgent():
    f = followup.find_followups(_ctx([("Self-reported severity score", 9, "")]))
    assert f and f[0]["priority"] == "urgent"


# --- NL->FHIR query validation ----------------------------------------------


class FakeProvider:
    def __init__(self, payload):
        self._payload = payload

    def complete(self, system, messages):
        return self._payload

    def embed(self, texts):  # pragma: no cover
        return []


def test_query_rejects_non_queryable_resource(monkeypatch):
    monkeypatch.setattr(query, "get_provider", lambda: FakeProvider('{"resource_type":"Binary","params":{}}'))
    called = {"n": 0}
    monkeypatch.setattr(query, "fhir_search", lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    out = query.run_query("give me raw binaries")
    assert out["error"]
    assert called["n"] == 0  # never executed a disallowed search


def test_query_runs_valid_search(monkeypatch):
    monkeypatch.setattr(
        query,
        "get_provider",
        lambda: FakeProvider('{"resource_type":"Condition","params":{"clinical-status":"active"},"explanation":"active conditions"}'),
    )
    monkeypatch.setattr(
        query, "fhir_search", lambda rt, params, **k: {"total": 2, "results": [{"id": "1", "type": rt, "display": "Diabetes"}]}
    )
    out = query.run_query("active conditions")
    assert out.get("error") is None
    assert out["resource_type"] == "Condition"
    assert out["total"] == 2
