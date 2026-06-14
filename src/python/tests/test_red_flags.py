"""Unit tests for the deterministic red-flag safety gate.

The gate is the one part of triage that must never depend on an LLM, so it is
the part that most warrants tests. These exercise pure functions only — no
network, no model calls — covering three properties:

  1. Can't-miss emergency phrases are detected and routed straight to ED.
  2. Negated phrases ("no slurred speech") do NOT fire.
  3. Nuanced complaints (chest tightness) are deliberately NOT hard-coded, so
     they fall through to the LLM rather than being force-escalated.
"""

from __future__ import annotations

from central_park.agent import (
    _detect_red_flags,
    _route,
    _route_red_flags,
    _validate_red_flags,
)


# --- _detect_red_flags ------------------------------------------------------


def test_detects_stroke_sign():
    assert _detect_red_flags("his speech is slurred and one-sided weakness") == [
        "slurred speech",
        "unilateral weakness",
    ]


def test_detects_airway_compromise():
    assert "difficulty breathing" in _detect_red_flags("I can't breathe")


def test_negation_voids_match():
    assert _detect_red_flags("no slurred speech, denies passing out") == []


def test_clear_text_has_no_flags():
    assert _detect_red_flags("I have a mild sore throat and a runny nose") == []


def test_chest_tightness_is_not_hardcoded():
    # Nuanced cardiac complaints are intentionally left to the LLM + FHIR
    # context, not the deterministic gate. If this ever fires, the flagship
    # chest-tightness demo would skip the reasoner entirely.
    assert _detect_red_flags("my chest feels tight when I walk upstairs") == []


def test_duplicate_reasons_are_deduped():
    flags = _detect_red_flags("face is drooping and the face drooping is obvious")
    assert flags == ["facial droop"]


# --- _validate_red_flags ----------------------------------------------------


def test_validate_escalates_on_hit():
    out = _validate_red_flags({"message": "I think I'm having anaphylaxis"})
    assert out["level"] == "ed"
    assert out["red_flags"] == ["anaphylaxis"]
    assert "anaphylaxis" in out["summary"]


def test_validate_clear_returns_empty_flags():
    out = _validate_red_flags({"message": "sore throat for two days"})
    assert out == {"red_flags": []}


# --- routers ----------------------------------------------------------------


def test_route_red_flags_branches_to_escalate_on_hit():
    assert _route_red_flags({"red_flags": ["syncope"]}) == "escalate"


def test_route_red_flags_branches_to_reason_when_clear():
    assert _route_red_flags({"red_flags": []}) == "reason"


def test_route_escalates_urgent_levels():
    assert _route({"level": "ed"}) == "escalate"
    assert _route({"level": "urgent-care"}) == "escalate"


def test_route_ends_on_non_urgent_levels():
    assert _route({"level": "self-care"}) == "end"
    assert _route({"level": "see-gp"}) == "end"
