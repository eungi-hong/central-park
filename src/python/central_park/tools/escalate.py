"""Escalation tool.

When the agent decides the triage level is urgent-care or ED, it calls this
tool to (a) write a FHIR Communication resource against the IRIS-hosted FHIR
endpoint and (b) raise an Ens.AlertRequest so the production can notify
on-call humans through whatever channel the operator has wired in.

Iteration 1: stub returns an empty id.
"""

from __future__ import annotations


def create_alert(patient_id: str, level: str, summary: str) -> str:
    """Persist the escalation and return the FHIR Communication.id."""
    # TODO(iteration-2): POST Communication + raise Ens.AlertRequest.
    _ = patient_id, level, summary
    return ""
