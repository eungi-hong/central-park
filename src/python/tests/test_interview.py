"""Unit tests for the adaptive intake interview's pure logic.

No network: these cover the question-normalization contract and the hard
termination bound that guarantees the interview always ends.
"""

from __future__ import annotations

from central_park.interview import MAX_QUESTIONS, _normalize_question, next_question


def test_hard_stop_at_max_questions():
    answers = [
        {"link_id": f"q{i}", "question": "?", "answer": "a"} for i in range(MAX_QUESTIONS)
    ]
    # At the cap, next_question returns done without touching the network/LLM.
    assert next_question("patient-1", answers) == {"done": True, "question": None}


def test_normalize_scale_question():
    q = _normalize_question(
        {"kind": "scale", "link_id": "severity", "prompt": "How bad is it?"}, set()
    )
    assert q is not None
    assert q["kind"] == "scale"
    assert q["min"] == 1 and q["max"] == 10
    assert q["min_label"] and q["max_label"]


def test_normalize_choices_requires_options():
    assert (
        _normalize_question({"kind": "choices", "link_id": "s", "prompt": "p", "options": []}, set())
        is None
    )
    q = _normalize_question(
        {"kind": "choices", "link_id": "s", "prompt": "p", "options": ["A", "B"]}, set()
    )
    assert q is not None and q["options"] == ["A", "B"]


def test_normalize_rejects_empty_prompt_and_bad_kind():
    assert _normalize_question({"kind": "text", "link_id": "x", "prompt": ""}, set()) is None
    assert _normalize_question({"kind": "slider", "link_id": "x", "prompt": "p"}, set()) is None


def test_normalize_rejects_duplicate_link_id():
    assert (
        _normalize_question({"kind": "text", "link_id": "dup", "prompt": "p"}, {"dup"}) is None
    )


def test_normalize_strips_echoed_none_option_and_dedupes():
    # The model sometimes echoes the none-option into options, and repeats
    # choices. Both must be removed so the UI never double-renders them.
    q = _normalize_question(
        {
            "kind": "choices",
            "link_id": "associated-symptoms",
            "prompt": "Any of these?",
            "options": ["Fever", "Fever", "none of these", "Nausea"],
            "none_option": "None of these",
        },
        set(),
    )
    assert q is not None
    assert q["options"] == ["Fever", "Nausea"]
    assert q["none_option"] == "None of these"
