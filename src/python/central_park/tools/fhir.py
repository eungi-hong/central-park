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

from datetime import datetime, timezone
from typing import TypedDict

import httpx

from central_park.config import load

QUESTIONNAIRE_REF = "Questionnaire/triage-intake"


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
    new_id = ""
    if resp.content:
        try:
            new_id = resp.json().get("id", "")
        except ValueError:
            pass
    if not new_id:
        location = resp.headers.get("Location") or resp.headers.get("Content-Location") or ""
        parts = [p for p in location.split("/") if p]
        if "QuestionnaireResponse" in parts:
            idx = parts.index("QuestionnaireResponse")
            if idx + 1 < len(parts):
                new_id = parts[idx + 1]
    return new_id


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
