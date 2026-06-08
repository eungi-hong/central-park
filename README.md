# Triage Park

**A conversational FHIR triage assistant.** A patient answers a short intake interview; an LLM-backed agent reads their FHIR record, retrieves matching triage guidelines by vector search, and produces a clinician handoff — a triage level (self-care / see-GP / urgent-care / ED) with a cited rationale. Every interview and its outcome are written back to FHIR, and a clinician reviews them in a worklist.

Built for the [InterSystems Programming Contest: AI Agents for FHIR](https://openexchange.intersystems.com/contest/46).

---

## Quickstart

```bash
git clone https://github.com/eungi-hong/central-park.git
cd central-park
cp .env.example .env          # then set OPENAI_API_KEY=sk-...
docker compose up --build      # IRIS cold start ~90s
```

Then open:

| URL | For |
| --- | --- |
| **http://localhost:8501** | Clinician console — the triage worklist |
| **http://localhost:8501/intake** | Patient self-intake — the interview |
| http://localhost:52773/csp/sys/UtilHome.csp | IRIS Management Portal (`_SYSTEM` / `SYS`) |

Once seeding finishes, the console shows three example cases (self-care, see-GP, and an emergency) — no interview needed. Then open `/intake`, run the demo patient `demo-patient-1` through the chest-tightness scenario, and watch a new case appear live in the worklist.

---

## What it does

**Two front doors, one FHIR backend.**

- **Patient intake** (`/intake`) — a first-person interview: chief complaint, onset, a 1–10 severity scale, a symptom checklist, history, and self-treatment. Answers are saved to FHIR as a `QuestionnaireResponse`; the patient gets a plain-language next step.
- **Clinician console** (`/`) — a worklist of triaged cases, newest first, with urgent cases flagged. Opening a case shows the patient's standing record, the interview transcript, the agent's assessment and cited guidelines, and an **Acknowledge** action for escalated cases (written back to FHIR).

---

## Architecture

```
            browser
   ┌───────────┴────────────┐
   /intake (patient)   /  (clinician)
   └───────────┬────────────┘
        central-park-ui  (React SPA + nginx :8501)
        ├─ /fhir/* → IRIS FHIR R4   (Basic auth injected server-side)
        └─ /api/*  → agent
                       │
   ┌───────────────────┼─────────────────────────────────┐
   │ central-park-iris (IRIS for Health)                 │
   │   FHIR R4 endpoint  ·  REST dispatch (/triage …)    │
   │   Interoperability production (REST inbox → agent   │
   │     business operation → Ens alerts on escalation)  │
   │   %Embedding.OpenAI config  ·  VECTOR_COSINE search │
   └───────────────────┼─────────────────────────────────┘
                        │ POST /run · /interview
        central-park-agent (FastAPI + LangGraph)
          gather_context → retrieve_guidelines →
          red-flag gate → reason → escalate
                        │
                  OpenAI (chat)
```

Three services, one external dependency (OpenAI). The agent sends **raw text** to IRIS, which computes embeddings server-side via `%Embedding.OpenAI` — the platform's intended AI Hub pattern. A LangGraph state machine wraps the five-node flow; a deterministic red-flag gate can only ever *escalate*, never downgrade, so a missed keyword can't lower a triage level below a matched emergency phrase.

> The agent runs as a sidecar rather than Embedded Python: the image's ARM64 Embedded Python build is unstable (Callin SEGVs, broken `_uuid`). The IRIS production graph stays first-class — every triage is an `Ens.MessageHeader` visible in Visual Trace.

---

## InterSystems features used

| Capability | How Triage Park uses it |
| --- | --- |
| **FHIR R4** | Reads patient context; writes `QuestionnaireResponse`, `Encounter`, `ServiceRequest`, coded `Observation`s, and `Communication` |
| **Vector Search** | `VECTOR(float, 1536)` guideline corpus queried with `VECTOR_COSINE` |
| **AI Hub** | `%Embedding.Config` + `%Embedding.OpenAI` embed guidelines and queries inside IRIS; SSL config installed at boot |
| **Interoperability** | Production with a REST inbox business service, triage agent business operation (HTTP outbound), and `Ens.AlertRequest` on urgent cases |
| **LLM / LangGraph** | Five-node state machine in the sidecar (gather context → retrieve guidelines → red-flag gate → reason → escalate); single deterministic LLM call returning structured JSON |
| **Docker** | `docker compose up --build` boots all three services |

### FHIR resources written

| Resource | When | Carries |
| --- | --- | --- |
| `QuestionnaireResponse` | every interview | the patient's answers |
| `Encounter` | every triage | the virtual consultation |
| `ServiceRequest` | every triage | triage level (SNOMED), chief complaint, and the agent's narrative (HPI, actions, red flags, cited guidelines) + clinician acknowledgement as notes |
| `Observation` | interview | LOINC severity score + SNOMED symptom flags parsed from answers |
| `Communication` | urgent/ED | the escalation alert |

Persisting the narrative on the `ServiceRequest` is what lets the console reconstruct a full past case from FHIR alone — no LLM re-run.

---

## Project layout

```
.
├─ ui/                      # React SPA — clinician console (/) + patient intake (/intake)
├─ agent/                   # Dockerfile for the FastAPI + LangGraph sidecar
├─ src/
│  ├─ python/central_park/  # Agent: LangGraph graph, tools (FHIR · vector · escalate), seeding
│  └─ cls/CentralPark/      # ObjectScript: FHIR install, REST dispatch, interop production
├─ iris-config/             # Boot script + demo seed bundles (patients, questionnaire)
├─ web/                     # Static assets served by IRIS
├─ Dockerfile               # IRIS for Health image: namespace, FHIR R4 endpoint, classes
├─ docker-compose.yml       # iris + agent + ui  (+ optional ollama profile)
└─ module.xml               # OpenExchange / IPM manifest
```

> Internal identifiers keep the original `central-park` / `CentralPark` / `/centralpark` names (package, classes, REST path, containers); "Triage Park" is the product/display name.

---

## Demo data

Seeded automatically at agent startup: the agent waits for the FHIR endpoint, then loads the bundles in `iris-config/seed/` (and the guideline corpus). Every seed is idempotent, so it re-runs safely on each restart and a single `docker compose up` needs no manual seed step.

| Patient | Profile | Seeded case |
| --- | --- | --- |
| **Marcus Reeves** (`demo-patient-1`) | 53, HTN / hyperlipidemia / T2DM, cardiac-risk-loaded | — (run the chest-tightness interview) |
| **Priya Nair** | 34, no chronic conditions | Self-care — sore throat |
| **Walter Boateng** | 70, COPD | See-GP — productive cough |
| **Sofia Marchetti** | 44, asthma | Emergency — acute breathlessness |

Marcus is deliberately cardiac-risk-loaded so a chest-tightness scenario exercises real reasoning over his FHIR record.

---

## Verify

```bash
curl http://localhost:8001/health                                   # agent
curl -u _SYSTEM:SYS http://localhost:52773/centralpark/health        # IRIS

# Vector search (no LLM cost)
curl -X POST http://localhost:52773/centralpark/vector/search -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' -d '{"query":"chest tightness on exertion","k":3}'

# Direct triage (chat LLM); writes a Communication when urgent
curl -X POST http://localhost:52773/centralpark/triage -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' \
  -d '{"patient_id":"demo-patient-1","message":"My chest feels tight when I walk upstairs."}'
```

Visual Trace shows every triage as an Ens message; the Embedding config lives under System Administration → Configuration → Connectivity → Embedding Configurations.

---

## Configuration

Defaults are baked into `docker-compose.yml`; `.env` overrides them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | *(required)* | Embeddings (IRIS) and chat (sidecar) |
| `CP_LLM_PROVIDER` | `openai` | `openai`, `anthropic`, or `ollama` for chat |
| `CP_OPENAI_MODEL` | `gpt-4o-mini` | Sidecar chat model |

Switch chat to Anthropic (`CP_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) or offline Ollama (`docker compose --profile ollama up --build`); OpenAI is still required for embeddings. Run `docker compose restart agent` after changing `.env`.

---

## Notes

- **Iterate** — Python under `src/python/` is bind-mounted: `docker compose restart agent`. ObjectScript and boot config need `docker compose up --build`.
- **Seeding** runs automatically at agent startup and is idempotent. If the worklist ever looks empty (e.g. IRIS was unusually slow to start), `docker compose restart agent` re-runs the seed safely.
- **Data** persists in the `iris-data` volume across restarts. `docker compose down -v` wipes it and re-seeds on next boot.
- **License** — MIT, see `LICENSE`.
