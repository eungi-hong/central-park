"""Unit tests for the agentic reasoning loop and the self-critique verifier.

These cover the safety-critical invariants without any network or real LLM:
  1. Citation grounding is deterministic and drops hallucinated sources.
  2. The verifier may escalate but can NEVER downgrade a triage level.
  3. The reason loop executes tool calls and always resolves to a final answer,
     even when its step budget is exhausted.
"""

from __future__ import annotations

import pytest

from central_park import reasoning
from central_park.reasoning import _higher, ground_citations, reason_loop, verify


class FakeProvider:
    """A scripted provider: complete() returns the next queued string."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def complete(self, system, messages):
        self.calls += 1
        return self._responses.pop(0)

    def embed(self, texts):  # pragma: no cover - unused
        return []


class BrokenProvider:
    def complete(self, system, messages):
        raise RuntimeError("provider down")

    def embed(self, texts):  # pragma: no cover - unused
        return []


# --- citation grounding -----------------------------------------------------


def test_ground_citations_drops_unretrieved():
    cites = [{"source": "Real", "snippet": "x"}, {"source": "Hallucinated"}]
    assert ground_citations(cites, ["Real"]) == [{"source": "Real", "snippet": "x"}]


def test_ground_citations_empty_when_nothing_retrieved():
    assert ground_citations([{"source": "A"}], []) == []


# --- escalate-only ladder ---------------------------------------------------


def test_higher_picks_more_acute():
    assert _higher("see-gp", "ed") == "ed"
    assert _higher("ed", "self-care") == "ed"
    assert _higher("urgent-care", "see-gp") == "urgent-care"


# --- verifier ---------------------------------------------------------------


def test_verify_never_downgrades():
    # Critic tries to lower an ED triage to self-care; the floor must hold.
    prov = FakeProvider(['{"verdict": "escalate", "level": "self-care", "note": "calm down"}'])
    res = verify(
        prov,
        level="ed",
        summary="Go to ED.",
        citations=[],
        patient_context={},
        guidelines=[],
        message="m",
        retrieved_sources=[],
    )
    assert res["level"] == "ed"


def test_verify_escalates_up_and_annotates():
    prov = FakeProvider(['{"verdict": "escalate", "level": "urgent-care", "note": "cardiac risk"}'])
    res = verify(
        prov,
        level="see-gp",
        summary="Base summary.",
        citations=[{"source": "G1"}],
        patient_context={},
        guidelines=[],
        message="m",
        retrieved_sources=["G1"],
    )
    assert res["level"] == "urgent-care"
    assert "Verifier escalated" in res["summary"]
    assert res["citations"] == [{"source": "G1"}]


def test_verify_confirm_passes_through():
    prov = FakeProvider(['{"verdict": "confirm", "level": "see-gp", "note": ""}'])
    res = verify(
        prov,
        level="see-gp",
        summary="Base.",
        citations=[{"source": "G1"}, {"source": "ghost"}],
        patient_context={},
        guidelines=[],
        message="m",
        retrieved_sources=["G1"],
    )
    assert res["level"] == "see-gp"
    assert res["summary"] == "Base."
    # grounding still runs even on confirm
    assert res["citations"] == [{"source": "G1"}]


def test_verify_provider_error_passes_answer_through():
    res = verify(
        BrokenProvider(),
        level="urgent-care",
        summary="S",
        citations=[{"source": "G1"}],
        patient_context={},
        guidelines=[],
        message="m",
        retrieved_sources=["G1"],
    )
    assert res["level"] == "urgent-care"
    assert res["citations"] == [{"source": "G1"}]


# --- reason loop ------------------------------------------------------------


def test_reason_loop_runs_tool_then_commits():
    prov = FakeProvider(
        [
            '{"action": "get_observations", "args": {"contains": "pressure"}}',
            '{"action": "final", "level": "urgent-care", "summary": "S", "citations": [{"source": "G1"}]}',
        ]
    )
    res = reason_loop(
        prov,
        patient_context={"observations": [{"display": "Blood pressure", "value": "150/95"}]},
        guidelines=[{"source": "G1", "snippet": "x", "score": 1.0}],
        message="chest tightness",
        max_steps=4,
    )
    assert res["level"] == "urgent-care"
    assert res["tool_trace"][0]["action"] == "get_observations"
    assert "G1" in res["retrieved_sources"]


def test_reason_loop_budget_exhausted_falls_back_to_single_shot():
    # Four tool calls burn the budget, then the forced single-shot returns final.
    prov = FakeProvider(
        ['{"action": "get_observations", "args": {}}'] * 4
        + ['{"action": "final", "level": "see-gp", "summary": "fallback", "citations": []}']
    )
    res = reason_loop(
        prov,
        patient_context={"observations": []},
        guidelines=[],
        message="m",
        max_steps=4,
    )
    assert res["level"] == "see-gp"
    assert res["summary"] == "fallback"


def test_reason_loop_treats_missing_action_as_final():
    prov = FakeProvider(['{"level": "self-care", "summary": "ok", "citations": []}'])
    res = reason_loop(prov, patient_context={}, guidelines=[], message="m")
    assert res["level"] == "self-care"
