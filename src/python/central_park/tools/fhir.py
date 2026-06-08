"""FHIR retrieval tool.

Issues a fan-out of FHIR R4 searches against the IRIS-hosted endpoint to
build a snapshot of the patient's clinically-relevant context. Five parallel
queries: the Patient resource itself plus four searches for active
Conditions, active MedicationRequests, the 20 most recent Observations,
and all AllergyIntolerances.

We hold the results to the fields the agent actually needs. Full FHIR
resources are noisy and would blow up the prompt budget; the agent only
cares about display strings, codes, and dates.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import TypedDict

import httpx

_log = logging.getLogger("central_park.fhir")

from central_park.config import load

QUESTIONNAIRE_REF = "Questionnaire/triage-intake"

_SYMPTOM_CODES: dict[str, tuple[str, str]] = {
    "shortness of breath": ("267036007", "Dyspnea"),
    "chest tightness":     ("23924001",  "Chest tightness"),
    "chest pain":          ("29857009",  "Chest pain"),
    "fever":               ("386661006", "Fever"),
    "nausea":              ("422587007", "Nausea"),
    "dizziness":           ("404640003", "Dizziness"),
    "weakness":            ("299377003", "Unilateral weakness"),
}

_TRIAGE_LEVEL_SR = {
    "self-care":   ("routine", "243958005", "Self-care"),
    "see-gp":      ("routine", "306206005", "Referral to general practitioner"),
    "urgent-care": ("urgent",  "310861008", "Referral to urgent care clinic"),
    "ed":          ("stat",    "182813001", "Emergency hospital admission"),
}


class PatientContext(TypedDict):
    patient: dict
    conditions: list[dict]
    medications: list[dict]
    observations: list[dict]
    allergies: list[dict]


def _auth() -> tuple[str, str] | None:
    cfg = load()
    if cfg.fhir_user and cfg.fhir_password:
        return (cfg.fhir_user, cfg.fhir_password)
    return None


def _client() -> httpx.Client:
    cfg = load()
    return httpx.Client(
        base_url=cfg.fhir_base_url,
        auth=_auth(),
        headers={"Accept": "application/fhir+json"},
        timeout=10.0,
    )


def _coding_display(codeable: dict | None) -> str:
    """Pick the best human-readable string out of a CodeableConcept."""
    if not codeable:
        return ""
    if text := codeable.get("text"):
        return text
    for coding in codeable.get("coding", []):
        if display := coding.get("display"):
            return display
    return ""


def _entries(bundle: dict) -> list[dict]:
    return [e["resource"] for e in bundle.get("entry", []) if "resource" in e]


def _trim_patient(p: dict) -> dict:
    name = ""
    for n in p.get("name", []):
        if family := n.get("family"):
            given = " ".join(n.get("given", []))
            name = f"{given} {family}".strip()
            break
    return {
        "id": p.get("id"),
        "name": name,
        "gender": p.get("gender"),
        "birthDate": p.get("birthDate"),
    }


def _trim_condition(r: dict) -> dict:
    return {
        "display": _coding_display(r.get("code")),
        "clinical_status": _coding_display(r.get("clinicalStatus")),
        "onset": r.get("onsetDateTime") or r.get("onsetPeriod", {}).get("start"),
    }


def _trim_medication(r: dict) -> dict:
    med = r.get("medicationCodeableConcept") or {}
    return {
        "display": _coding_display(med),
        "status": r.get("status"),
        "authored_on": r.get("authoredOn"),
        "dosage": (r.get("dosageInstruction") or [{}])[0].get("text"),
    }


def _trim_observation(r: dict) -> dict:
    base = {
        "display": _coding_display(r.get("code")),
        "effective": r.get("effectiveDateTime"),
        "status": r.get("status"),
    }
    if "valueQuantity" in r:
        vq = r["valueQuantity"]
        base["value"] = vq.get("value")
        base["unit"] = vq.get("unit")
    elif "component" in r:
        # Multi-part observations like BP. Flatten to "Systolic 148 mmHg, Diastolic 94 mmHg".
        parts = []
        for c in r["component"]:
            label = _coding_display(c.get("code"))
            vq = c.get("valueQuantity") or {}
            v, u = vq.get("value"), vq.get("unit")
            if v is not None:
                parts.append(f"{label} {v} {u or ''}".strip())
        base["value"] = ", ".join(parts) or None
    return base


def _trim_allergy(r: dict) -> dict:
    return {
        "display": _coding_display(r.get("code")),
        "clinical_status": _coding_display(r.get("clinicalStatus")),
        "criticality": r.get("criticality"),
        "reactions": [
            _coding_display(m)
            for reaction in r.get("reaction", [])
            for m in reaction.get("manifestation", [])
        ],
    }


def _extract_id(resp: httpx.Response, resource_type: str) -> str:
    """Extract the server-assigned id from a FHIR create response.

    IRIS returns HTTP 201 with an empty body; the id lives in Location header.
    """
    new_id = ""
    if resp.content:
        try:
            new_id = resp.json().get("id", "")
        except ValueError:
            pass
    if not new_id:
        location = resp.headers.get("Location") or resp.headers.get("Content-Location") or ""
        parts = [p for p in location.split("/") if p]
        if resource_type in parts:
            idx = parts.index(resource_type)
            if idx + 1 < len(parts):
                new_id = parts[idx + 1]
    return new_id


def post_questionnaire_response(patient_id: str, qa_items: list[dict]) -> str:
    """POST a QuestionnaireResponse to FHIR and return the server-assigned id.

    Each item in qa_items must have keys: link_id, question, answer.
    """
    authored = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "resourceType": "QuestionnaireResponse",
        "questionnaire": QUESTIONNAIRE_REF,
        "status": "completed",
        "subject": {"reference": f"Patient/{patient_id}"},
        "authored": authored,
        "item": [
            {
                "linkId": item["link_id"],
                "text": item["question"],
                "answer": [{"valueString": item["answer"]}],
            }
            for item in qa_items
        ],
    }
    with _client() as c:
        resp = c.post(
            "/QuestionnaireResponse",
            json=payload,
            headers={"Content-Type": "application/fhir+json"},
        )
        resp.raise_for_status()
    return _extract_id(resp, "QuestionnaireResponse")


def get_questionnaire_response(qr_id: str) -> list[dict]:
    """Fetch a QuestionnaireResponse and return items as [{link_id, question, answer}]."""
    with _client() as c:
        resp = c.get(f"/QuestionnaireResponse/{qr_id}")
        resp.raise_for_status()
    items = []
    for item in resp.json().get("item", []):
        answers = item.get("answer") or []
        items.append({
            "link_id": item.get("linkId", ""),
            "question": item.get("text", ""),
            "answer": answers[0].get("valueString", "") if answers else "",
        })
    return items


def create_encounter(patient_id: str, qr_id: str | None = None) -> str:
    """Create a finished virtual triage Encounter and return its id."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload: dict = {
        "resourceType": "Encounter",
        "status": "finished",
        "class": {
            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code": "VR",
            "display": "virtual",
        },
        "type": [
            {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "11429006",
                        "display": "Consultation",
                    }
                ],
                "text": "Triage consultation",
            }
        ],
        "subject": {"reference": f"Patient/{patient_id}"},
        "period": {"start": now, "end": now},
    }
    # IRIS restricts reasonReference to Condition/Procedure/Observation/ImmunizationRecommendation
    # so we link the QR via reasonCode text instead
    if qr_id:
        payload["reasonCode"] = [{"text": f"Triage intake QuestionnaireResponse/{qr_id}"}]
    with _client() as c:
        resp = c.post("/Encounter", json=payload, headers={"Content-Type": "application/fhir+json"})
        resp.raise_for_status()
    return _extract_id(resp, "Encounter")


def _handoff_notes(handoff: dict) -> list[dict]:
    """Flatten the agent's narrative into ServiceRequest.note annotations.

    Each note is human-readable in the Management Portal and carries a stable
    label prefix the clinician dashboard parses back out (see ui/src/api.ts).
    The narrative is otherwise not persisted anywhere in FHIR, so a clinician
    reviewing a past case would lose the reasoning without this.
    """
    notes: list[dict] = []
    if hpi := handoff.get("hpi"):
        notes.append({"text": f"HPI: {hpi}"})
    for action in handoff.get("recommended_actions") or []:
        notes.append({"text": f"Action: {action}"})
    for flag in handoff.get("red_flags") or []:
        notes.append({"text": f"Red flag: {flag}"})
    for c in handoff.get("citations") or []:
        source = c.get("source") or c.get("slug") or ""
        snippet = c.get("snippet") or ""
        # source|snippet — source is a single token, snippet is last.
        notes.append({"text": f"Guideline: {source}|{snippet}"})
    if qr_id := handoff.get("qr_id"):
        notes.append({"text": f"QR: {qr_id}"})
    return notes


def create_service_request(
    patient_id: str,
    encounter_id: str,
    triage_level: str,
    chief_complaint: str,
    handoff: dict | None = None,
) -> str:
    """Create a ServiceRequest from triage outcome and return its id.

    When `handoff` is supplied, the agent's narrative (HPI, recommended
    actions, red flags, cited guidelines, source QuestionnaireResponse id) is
    persisted as note annotations so the clinician dashboard can reconstruct
    the full case later without re-running the LLM.
    """
    priority, code, display = _TRIAGE_LEVEL_SR.get(
        triage_level, ("routine", "306206005", "Referral to general practitioner")
    )
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "resourceType": "ServiceRequest",
        "status": "active",
        "intent": "proposal",
        "priority": priority,
        "code": {
            "coding": [
                {"system": "http://snomed.info/sct", "code": code, "display": display}
            ],
            "text": display,
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "authoredOn": now,
        "reasonCode": [{"text": chief_complaint}],
    }
    if handoff and (notes := _handoff_notes(handoff)):
        payload["note"] = notes
    with _client() as c:
        resp = c.post(
            "/ServiceRequest", json=payload, headers={"Content-Type": "application/fhir+json"}
        )
        resp.raise_for_status()
    return _extract_id(resp, "ServiceRequest")


def create_observations(
    patient_id: str,
    encounter_id: str,
    qa_items: list[dict],
) -> list[str]:
    """Create coded Observations from interview answers and return their ids.

    Creates a severity-score Observation (LOINC 72514-3) and one SNOMED-coded
    Observation per symptom keyword detected in the patient's answers.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    base = {
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "survey",
                        "display": "Survey",
                    }
                ]
            }
        ],
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "effectiveDateTime": now,
    }

    by_link = {item["link_id"]: item["answer"] for item in qa_items}
    payloads = []

    # Severity score → LOINC 72514-3
    # Extract the first integer in the answer and clamp to [1, 10]
    severity_text = by_link.get("severity", "")
    m = re.search(r"\b(\d+)\b", severity_text)
    if m:
        score = min(10, max(1, int(m.group(1))))
        payloads.append({
            **base,
            "resourceType": "Observation",
            "status": "preliminary",
            "code": {
                "coding": [
                    {
                        "system": "http://loinc.org",
                        "code": "72514-3",
                        "display": "Pain severity - 0-10 verbal numeric rating [Score] - Reported",
                    }
                ],
                "text": "Self-reported severity score",
            },
            "valueInteger": score,
        })

    # Symptom flags → SNOMED codes
    symptom_text = (
        by_link.get("associated-symptoms", "") + " " + by_link.get("chief-complaint", "")
    ).lower()
    for keyword, (code, display) in _SYMPTOM_CODES.items():
        if keyword in symptom_text:
            payloads.append({
                **base,
                "resourceType": "Observation",
                "status": "preliminary",
                "code": {
                    "coding": [
                        {"system": "http://snomed.info/sct", "code": code, "display": display}
                    ],
                    "text": display,
                },
                "valueBoolean": True,
            })

    ids: list[str] = []
    with _client() as c:
        for payload in payloads:
            try:
                resp = c.post(
                    "/Observation",
                    json=payload,
                    headers={"Content-Type": "application/fhir+json"},
                )
                resp.raise_for_status()
                ids.append(_extract_id(resp, "Observation"))
            except Exception as exc:
                _log.warning(
                    "create_observation failed for %s: %s",
                    payload.get("code", {}).get("text"),
                    exc,
                )
    return ids


def get_patient_context(patient_id: str) -> PatientContext:
    with _client() as c:
        patient_resp = c.get(f"/Patient/{patient_id}")
        conditions_resp = c.get(
            "/Condition",
            params={"patient": patient_id, "clinical-status": "active"},
        )
        meds_resp = c.get(
            "/MedicationRequest",
            params={"patient": patient_id, "status": "active"},
        )
        obs_resp = c.get(
            "/Observation",
            params={"patient": patient_id, "_sort": "-date", "_count": "20"},
        )
        allergies_resp = c.get("/AllergyIntolerance", params={"patient": patient_id})

    return {
        "patient": _trim_patient(patient_resp.json()) if patient_resp.is_success else {"id": patient_id},
        "conditions": [_trim_condition(r) for r in _entries(conditions_resp.json())]
        if conditions_resp.is_success
        else [],
        "medications": [_trim_medication(r) for r in _entries(meds_resp.json())]
        if meds_resp.is_success
        else [],
        "observations": [_trim_observation(r) for r in _entries(obs_resp.json())]
        if obs_resp.is_success
        else [],
        "allergies": [_trim_allergy(r) for r in _entries(allergies_resp.json())]
        if allergies_resp.is_success
        else [],
    }
