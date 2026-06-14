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
from central_park.interview import next_question
from central_park.seed_module import (
    seed_demo_patients,
    seed_guidelines,
    seed_questionnaire,
    wait_for_fhir,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed IRIS on startup. All steps are idempotent and non-fatal so the agent
    # still boots in degraded states (no API key, IRIS not yet ready, etc.).
    #
    # Wait for the FHIR endpoint first so a single `docker compose up` seeds
    # cleanly even when the agent wins the boot race against IRIS's ~90s start.
    #
    # The fast FHIR seeds (Questionnaire, demo patients) run first so the intake
    # form and clinician worklist populate quickly; seed_guidelines() embeds 30
    # snippets serially via OpenAI and can take 30-60s, so it goes last.
    try:
        wait_for_fhir()
    except Exception:
        logging.getLogger("central_park.startup").exception("wait_for_fhir failed (non-fatal)")
    try:
        seed_questionnaire()
    except Exception:
        logging.getLogger("central_park.startup").exception("seed_questionnaire failed (non-fatal)")
    try:
        seed_demo_patients()
    except Exception:
        logging.getLogger("central_park.startup").exception("seed_demo_patients failed (non-fatal)")
    try:
        seed_guidelines()
    except Exception:
        logging.getLogger("central_park.startup").exception("seed_guidelines failed (non-fatal)")
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
    red_flags: list[str] = []
    communication_id: str | None
    encounter_id: str | None = None
    service_request_id: str | None = None
    observation_ids: list[str] = []


class InterviewRequest(BaseModel):
    patient_id: str
    questionnaire_response_id: str


class QAItem(BaseModel):
    link_id: str
    question: str
    answer: str


class NextQuestionRequest(BaseModel):
    patient_id: str
    answers: list[QAItem] = []


class NextQuestionResponse(BaseModel):
    done: bool
    question: dict | None = None


class HandoffResponse(BaseModel):
    triage_level: str | None
    chief_complaint: str | None
    hpi: str | None
    red_flags: list[str]
    recommended_actions: list[str]
    citations: list[dict]
    questionnaire_response_id: str | None
    encounter_id: str | None = None
    service_request_id: str | None = None
    observation_ids: list[str] = []


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


@app.post("/interview/next", response_model=NextQuestionResponse)
def next_question_endpoint(req: NextQuestionRequest) -> dict:
    """Adaptive intake: return the next question to ask, or that we're done."""
    return next_question(
        patient_id=req.patient_id,
        answers=[a.model_dump() for a in req.answers],
    )
