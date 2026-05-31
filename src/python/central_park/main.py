"""FastAPI wrapper for the triage agent.

The sidecar container runs `uvicorn central_park.main:app`. IRIS's
CentralPark.Operation.TriageAgent calls POST /run with a JSON body and
forwards the response straight back to the REST client.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from central_park.agent import run, run_interview
from central_park.seed_module import seed_guidelines, seed_questionnaire

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the guideline corpus into IRIS on startup. Idempotent (upserts on
    # slug). All failures here are non-fatal so the agent still boots in
    # degraded states (no API key, IRIS not yet ready, etc.).
    try:
        seed_guidelines()
    except Exception:
        logging.getLogger("central_park.startup").exception("seed_guidelines failed (non-fatal)")
    try:
        seed_questionnaire()
    except Exception:
        logging.getLogger("central_park.startup").exception("seed_questionnaire failed (non-fatal)")
    yield


app = FastAPI(title="Central Park agent", version="0.1.0", lifespan=lifespan)


class RunRequest(BaseModel):
    patient_id: str
    message: str
    conversation_id: str | None = None


class RunResponse(BaseModel):
    level: str | None
    summary: str | None
    citations: list[dict]
    communication_id: str | None


class InterviewRequest(BaseModel):
    patient_id: str
    questionnaire_response_id: str


class HandoffResponse(BaseModel):
    triage_level: str | None
    chief_complaint: str | None
    hpi: str | None
    red_flags: list[str]
    recommended_actions: list[str]
    citations: list[dict]
    questionnaire_response_id: str | None


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


@app.post("/interview", response_model=HandoffResponse)
def run_interview_endpoint(req: InterviewRequest) -> dict:
    return run_interview(
        patient_id=req.patient_id,
        questionnaire_response_id=req.questionnaire_response_id,
    )
