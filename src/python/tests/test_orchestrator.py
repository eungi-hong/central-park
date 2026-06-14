"""Unit tests for the multi-agent orchestrator's routing/chaining loop."""

from __future__ import annotations

from central_park import orchestrator


class ScriptedProvider:
    """Returns queued raw responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)

    def complete(self, system, messages):
        return self._responses.pop(0)

    def embed(self, texts):  # pragma: no cover
        return []


def test_orchestrator_routes_and_finalizes(monkeypatch):
    # Supervisor: call risk, then finalize.
    monkeypatch.setattr(
        orchestrator,
        "get_provider",
        lambda: ScriptedProvider([
            '{"action":"risk","args":{}}',
            '{"action":"final","answer":"This patient is moderate risk."}',
        ]),
    )
    monkeypatch.setitem(orchestrator._AGENTS, "risk", lambda pid, args: {"band": "moderate", "score": 42})
    out = orchestrator.orchestrate("how risky is this patient?", patient_id="p1")
    assert out["answer"] == "This patient is moderate risk."
    assert len(out["steps"]) == 1
    assert out["steps"][0]["agent"] == "risk"
    assert out["steps"][0]["result"]["band"] == "moderate"


def test_orchestrator_chains_multiple_agents(monkeypatch):
    monkeypatch.setattr(
        orchestrator,
        "get_provider",
        lambda: ScriptedProvider([
            '{"action":"summary","args":{}}',
            '{"action":"careplan","args":{}}',
            '{"action":"final","answer":"Summary + plan done."}',
        ]),
    )
    monkeypatch.setitem(orchestrator._AGENTS, "summary", lambda pid, args: {"headline": "x"})
    monkeypatch.setitem(orchestrator._AGENTS, "careplan", lambda pid, args: {"care_plan_id": "9"})
    out = orchestrator.orchestrate("summarize and draft a plan", patient_id="p1")
    assert [s["agent"] for s in out["steps"]] == ["summary", "careplan"]


def test_orchestrator_blocks_patient_agent_without_id(monkeypatch):
    monkeypatch.setattr(
        orchestrator,
        "get_provider",
        lambda: ScriptedProvider(['{"action":"summary","args":{}}', '{"action":"final","answer":"n/a"}']),
    )
    out = orchestrator.orchestrate("summarize", patient_id=None)
    assert out["steps"][0]["result"].get("error")
