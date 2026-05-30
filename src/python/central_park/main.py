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

from central_park.agent import run
from central_park.seed_module import seed_guidelines

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
