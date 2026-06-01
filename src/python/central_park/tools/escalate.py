"""Escalation tool.

When the triage level is urgent-care or ed, this tool writes a FHIR
Communication resource against the IRIS-hosted FHIR endpoint, marking the
patient's record with the agent's recommendation. Downstream systems can
subscribe to the FHIR Communication resource for alerting.

The companion piece on the IRIS side (CentralPark.Operation.TriageAgent)
raises an Ens.AlertRequest after the sidecar returns, so the same escalation
also flows through the production's alert path.

Failures here are logged and swallowed so an escalation write failure does
not block the triage response — the patient still gets the LLM's reply.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from central_park.config import load

log = logging.getLogger("central_park.escalate")


def _auth(cfg) -> tuple[str, str] | None:
    if cfg.fhir_user and cfg.fhir_password:
        return (cfg.fhir_user, cfg.fhir_password)
    return None


def create_alert(patient_id: str, level: str, summary: str) -> str:
    """Persist the escalation as a FHIR Communication and return the new id."""
    cfg = load()
    body = {
        "resourceType": "Communication",
        "status": "in-progress",
        "priority": "urgent" if level == "ed" else "routine",
        "category": [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/communication-category",
                "code": "notification",
                "display": "Notification",
            }],
            "text": f"Triage escalation: {level}",
        }],
        "subject": {"reference": f"Patient/{patient_id}"},
        "sent": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "topic": {"text": f"Central Park triage: {level}"},
        "payload": [{"contentString": summary}],
    }

    try:
        resp = httpx.post(
            f"{cfg.fhir_base_url}/Communication",
            json=body,
            auth=_auth(cfg),
            headers={
                "Content-Type": "application/fhir+json",
                "Accept": "application/fhir+json",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as e:
        log.warning("Communication write failed for patient %s: %s", patient_id, e)
        return ""

    # The FHIR server may return the created resource as JSON or an empty body
    # with the Location header (.../Communication/{id}/_history/{ver}).
    new_id = ""
    if resp.content:
        try:
            new_id = resp.json().get("id", "")
        except ValueError:
            pass
    if not new_id:
        location = resp.headers.get("Location") or resp.headers.get("Content-Location") or ""
        parts = [p for p in location.split("/") if p]
        if "Communication" in parts:
            idx = parts.index("Communication")
            if idx + 1 < len(parts):
                new_id = parts[idx + 1]
    log.info("Escalation Communication/%s written for patient %s (level=%s).", new_id, patient_id, level)
    return new_id
