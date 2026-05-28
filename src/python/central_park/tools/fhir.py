"""FHIR retrieval tool.

Iteration 1: returns an empty context shaped correctly so the agent can be
exercised end to end without a populated FHIR store.

Iteration 2 will issue real GETs against the in-container FHIR R4 endpoint:
    GET /Patient/{id}
    GET /Condition?patient={id}&clinical-status=active
    GET /MedicationRequest?patient={id}&status=active
    GET /Observation?patient={id}&_sort=-date&_count=20
    GET /AllergyIntolerance?patient={id}
"""

from __future__ import annotations

from typing import TypedDict


class PatientContext(TypedDict):
    patient: dict
    conditions: list[dict]
    medications: list[dict]
    observations: list[dict]
    allergies: list[dict]


def get_patient_context(patient_id: str) -> PatientContext:
    # TODO(iteration-2): replace with real FHIR R4 search bundle.
    return {
        "patient": {"id": patient_id, "resourceType": "Patient"},
        "conditions": [],
        "medications": [],
        "observations": [],
        "allergies": [],
    }
