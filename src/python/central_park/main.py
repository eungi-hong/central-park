"""FastAPI wrapper for the triage agent.

The sidecar container runs `uvicorn central_park.main:app`. IRIS's
CentralPark.Operation.TriageAgent calls POST /run with a JSON body and
forwards the response straight back to the REST client.
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from central_park.agent import run

app = FastAPI(title="Central Park agent", version="0.1.0")


class RunRequest(BaseModel):
    patient_id: str
    message: str
    conversation_id: str | None = None


class RunResponse(BaseModel):
    level: str | None
    summary: str | None
    citations: list[dict]
    communication_id: str | None


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "central-park-agent"}


@app.post("/run", response_model=RunResponse)
def run_agent(req: RunRequest) -> dict:
    return run(
        patient_id=req.patient_id,
        message=req.message,
        conversation_id=req.conversation_id,
    )
