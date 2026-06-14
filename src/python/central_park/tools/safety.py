"""Safety / interaction agent: deterministic medication and allergy screening.

This is a non-LLM agent. It cross-references the patient's active medications,
allergies, and conditions (from their FHIR record) against the presenting
complaint, and emits structured `DetectedIssue`-shaped findings. Like the
red-flag gate, it is one-directional: a finding can only raise acuity, never
lower it.

Keeping this deterministic is deliberate. Medication-interaction and
contraindication logic is exactly the kind of safety check that should not
depend on an LLM remembering a fact. The knowledge base below is small and
curated for the demo's clinical scenarios, not a pharmacopoeia; it is structured
so adding rules is a one-line change.

Output findings carry a severity that maps to a triage floor:
    high     -> ed
    moderate -> urgent-care
    low      -> (no escalation; informational, still surfaced to the clinician)
"""

from __future__ import annotations

from typing import TypedDict

# Severity -> triage floor it imposes. None means informational only.
_SEVERITY_FLOOR: dict[str, str | None] = {
    "high": "ed",
    "moderate": "urgent-care",
    "low": None,
}


class DetectedIssue(TypedDict):
    code: str          # short machine-ish label, e.g. "anticoagulant-bleeding"
    severity: str      # high | moderate | low
    detail: str        # human-readable explanation for the clinician
    medication: str    # the implicated drug/class (may be "")


class _Rule(TypedDict):
    code: str
    severity: str
    drugs: tuple[str, ...]     # lowercase substrings matched against medication display
    symptoms: tuple[str, ...]  # lowercase substrings matched against the complaint
    detail: str


# Curated interaction / contraindication rules. Each fires when the patient is
# on one of `drugs` AND the complaint mentions one of `symptoms`.
_RULES: tuple[_Rule, ...] = (
    {
        "code": "anticoagulant-bleeding",
        "severity": "high",
        "drugs": ("warfarin", "apixaban", "rivaroxaban", "dabigatran", "heparin", "enoxaparin"),
        "symptoms": (
            "bleed", "blood in", "coughing up blood", "vomiting blood", "black stool",
            "blood in stool", "blood in urine", "nosebleed", "bruis", "blood when",
        ),
        "detail": "Patient is on an anticoagulant and reports bleeding-type symptoms; "
        "elevated haemorrhage risk warrants urgent assessment.",
    },
    {
        "code": "nsaid-gi-bleed",
        "severity": "moderate",
        "drugs": ("ibuprofen", "naproxen", "aspirin", "diclofenac", "ketorolac"),
        "symptoms": ("black stool", "vomiting blood", "stomach pain", "abdominal pain", "blood in stool"),
        "detail": "NSAID use with GI bleeding symptoms; possible gastrointestinal haemorrhage.",
    },
    {
        "code": "ace-inhibitor-angioedema",
        "severity": "high",
        "drugs": ("lisinopril", "ramipril", "enalapril", "perindopril", "captopril"),
        "symptoms": ("swelling", "swollen", "lip swelling", "tongue", "throat tight", "face swelling"),
        "detail": "ACE-inhibitor use with swelling of lips/tongue/face; possible angioedema, "
        "a recognised ACE-inhibitor adverse effect.",
    },
    {
        "code": "betablocker-bronchospasm",
        "severity": "moderate",
        "drugs": ("propranolol", "atenolol", "metoprolol", "bisoprolol", "carvedilol"),
        "symptoms": ("wheez", "shortness of breath", "can't breathe", "breathing"),
        "detail": "Non-selective beta-blocker with respiratory symptoms; beta-blockers can "
        "precipitate bronchospasm, especially in asthma.",
    },
    {
        "code": "hypoglycaemia-risk",
        "severity": "moderate",
        "drugs": ("insulin", "gliclazide", "glipizide", "glimepiride", "glyburide"),
        "symptoms": ("shaky", "sweating", "sweaty", "confused", "dizzy", "dizziness", "tremor"),
        "detail": "Patient on insulin or a sulfonylurea with symptoms suggestive of "
        "hypoglycaemia; check blood glucose.",
    },
)


def _med_displays(patient_context: dict) -> list[str]:
    return [str(m.get("display", "")).lower() for m in patient_context.get("medications", []) or []]


def _allergy_displays(patient_context: dict) -> list[str]:
    return [str(a.get("display", "")).lower() for a in patient_context.get("allergies", []) or []]


def screen(patient_context: dict, message: str) -> list[DetectedIssue]:
    """Return all detected medication/allergy issues for this presentation."""
    text = (message or "").lower()
    meds = _med_displays(patient_context)
    issues: list[DetectedIssue] = []

    for rule in _RULES:
        on_drug = next((m for m in meds if any(d in m for d in rule["drugs"])), None)
        if not on_drug:
            continue
        if not any(sym in text for sym in rule["symptoms"]):
            continue
        issues.append(
            {
                "code": rule["code"],
                "severity": rule["severity"],
                "detail": rule["detail"],
                "medication": on_drug,
            }
        )

    # Allergy cross-check: the patient mentions taking / wanting something they
    # are documented allergic to. We match the allergy substance token against
    # the complaint text (covers "took some penicillin", "given amoxicillin").
    for allergy in _allergy_displays(patient_context):
        token = allergy.split()[0] if allergy else ""
        if len(token) >= 4 and token in text:
            issues.append(
                {
                    "code": "allergy-exposure",
                    "severity": "high",
                    "detail": f"Complaint references '{token}', which the record lists as an "
                    f"allergy ({allergy}); possible allergic exposure.",
                    "medication": allergy,
                }
            )

    return issues


def safety_floor(issues: list[DetectedIssue]) -> str:
    """The highest triage floor imposed by the findings ('' if none escalate)."""
    floor = ""
    order = ("self-care", "see-gp", "urgent-care", "ed")
    for issue in issues:
        level = _SEVERITY_FLOOR.get(issue["severity"])
        if level and (not floor or order.index(level) > order.index(floor)):
            floor = level
    return floor
