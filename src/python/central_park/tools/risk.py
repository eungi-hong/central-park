"""IntegratedML risk tool: query the IRIS readmission/deterioration model.

Computes a small feature vector from the patient's FHIR context and asks the
IRIS IntegratedML model (CentralPark.ML) for an elevated-risk prediction.

Resilient by construction: a short timeout and broad except mean any failure
(model disabled on ARM64, AutoML hang, network) returns {"available": False},
so the triage agent treats the score as an optional signal and never blocks on
it. The model trains and serves on x86 IRIS with CP_ENABLE_ML=1.
"""

from __future__ import annotations

import datetime as _dt
import re

import httpx

from central_park.config import load

# Short timeout: if the model is disabled/unstable we want to fall back fast,
# not stall the triage on a hung PREDICT.
_TIMEOUT = 4.0


def _age(patient_context: dict) -> int:
    bd = (patient_context.get("patient") or {}).get("birthDate")
    if not bd:
        return 0
    try:
        born = _dt.date.fromisoformat(bd[:10])
    except ValueError:
        return 0
    today = _dt.date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _severity(patient_context: dict) -> int:
    """Best-effort symptom severity (0-10) from a recent survey Observation."""
    for o in patient_context.get("observations", []) or []:
        if "severity" in str(o.get("display", "")).lower():
            m = re.search(r"\b(\d+)\b", str(o.get("value", "")))
            if m:
                return min(10, max(0, int(m.group(1))))
    return 5


def get_risk_score(patient_context: dict) -> dict:
    """Return the model's risk prediction for this patient, or unavailable."""
    cfg = load()
    features = {
        "age": _age(patient_context),
        "comorbid": len(patient_context.get("conditions", []) or []),
        "severity": _severity(patient_context),
    }
    auth = (cfg.fhir_user, cfg.fhir_password) if cfg.fhir_user else None
    try:
        resp = httpx.post(
            f"{cfg.iris_rest_base_url}/risk/predict",
            json=features,
            auth=auth,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return {"available": False, "features": features}

    if not data.get("available"):
        return {"available": False, "features": features}
    return {
        "available": True,
        "elevated_risk": bool(data.get("elevated_risk")),
        "prediction": data.get("prediction"),
        "probability": data.get("probability"),
        "features": features,
    }
