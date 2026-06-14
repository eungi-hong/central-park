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
from central_park.careplan import draft_care_plan
from central_park.cohort import assess_cohort
from central_park.copilot import answer_question
from central_park.followup import run_followup
from central_park.gaps import find_gaps
from central_park.interview import next_question
from central_park.labs import explain_labs
from central_park.orchestrator import orchestrate
from central_park.query import run_query
from central_park.summary import summarize
from central_park.tools import create_tasks, get_patient_context, risk
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
    detected_issues: list[dict] = []
    tool_trace: list[dict] = []
    verifier_note: str = ""
    communication_id: str | None
    encounter_id: str | None = None
    service_request_id: str | None = None
    observation_ids: list[str] = []
    detected_issue_ids: list[str] = []


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
    language: str = "English"


class NextQuestionResponse(BaseModel):
    done: bool
    question: dict | None = None


class CopilotRequest(BaseModel):
    patient_id: str
    question: str


class CopilotResponse(BaseModel):
    answer: str
    citations: list[dict] = []


class PatientRequest(BaseModel):
    patient_id: str


class QueryRequest(BaseModel):
    question: str


class OrchestrateRequest(BaseModel):
    message: str
    patient_id: str | None = None


class SummaryRequest(BaseModel):
    patient_id: str
    audience: str = "clinician"


class HandoffResponse(BaseModel):
    triage_level: str | None
    chief_complaint: str | None
    hpi: str | None
    red_flags: list[str]
    recommended_actions: list[str]
    citations: list[dict]
    detected_issues: list[dict] = []
    questionnaire_response_id: str | None
    encounter_id: str | None = None
    service_request_id: str | None = None
    observation_ids: list[str] = []
    detected_issue_ids: list[str] = []


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
        language=req.language,
    )


@app.post("/copilot", response_model=CopilotResponse)
def copilot_endpoint(req: CopilotRequest) -> dict:
    """Clinician copilot: read-only, grounded Q&A about one patient."""
    return answer_question(patient_id=req.patient_id, question=req.question)


@app.post("/summary")
def summary_endpoint(req: SummaryRequest) -> dict:
    """Patient summary agent: role-aware clinical summary from the FHIR record."""
    return summarize(patient_id=req.patient_id, audience=req.audience)


@app.post("/labs")
def labs_endpoint(req: PatientRequest) -> dict:
    """Lab explainer agent: plain-language explanation of recent results."""
    return explain_labs(patient_id=req.patient_id)


@app.post("/gaps")
def gaps_endpoint(req: PatientRequest) -> dict:
    """Gaps-in-care agent: open care gaps, written back as FHIR Tasks."""
    gaps = find_gaps(get_patient_context(req.patient_id))
    task_ids = create_tasks(req.patient_id, gaps) if gaps else []
    return {"gaps": gaps, "task_ids": task_ids}


@app.post("/risk")
def risk_endpoint(req: PatientRequest) -> dict:
    """Readmission/deterioration risk assessment (IntegratedML or heuristic)."""
    return risk.assess(get_patient_context(req.patient_id))


@app.post("/careplan")
def careplan_endpoint(req: PatientRequest) -> dict:
    """Care-plan agent: draft a care plan and write a FHIR CarePlan."""
    return draft_care_plan(patient_id=req.patient_id)


@app.post("/followup")
def followup_endpoint(req: PatientRequest) -> dict:
    """Abnormal-results follow-up agent: flag out-of-range results, write Tasks."""
    return run_followup(patient_id=req.patient_id)


@app.post("/query")
def query_endpoint(req: QueryRequest) -> dict:
    """NL->FHIR query agent: translate a question into a validated FHIR search."""
    return run_query(question=req.question)


@app.get("/cohort")
def cohort_endpoint() -> dict:
    """Cohort agent: population-level risk + care-gap aggregation, ranked."""
    return assess_cohort()


@app.post("/orchestrate")
def orchestrate_endpoint(req: OrchestrateRequest) -> dict:
    """Multi-agent orchestrator: route + chain specialist agents for one request."""
    return orchestrate(message=req.message, patient_id=req.patient_id)
