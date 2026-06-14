# Triage Park

**The pre-checkup, automated — with a safety floor that can only ever escalate.**

[![Live demo](https://img.shields.io/badge/live_demo-online-2ea44f)](https://triagepark.78-47-167-98.sslip.io/) [![Walkthrough](https://img.shields.io/badge/video-walkthrough-red)](https://youtu.be/3hqf62btWYQ) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) · Built for the [InterSystems Programming Contest: AI Agents for FHIR](https://openexchange.intersystems.com/contest/46)

Every visit starts with the same manual work — take the patient's history, cross-check their record, judge how urgent it is. **Triage Park does that first pass for you.** A patient answers a short intake interview; a LangGraph agent reads their FHIR record, retrieves matching triage guidelines by vector search, and a clinician opens a ready-made handoff — a triage level (self-care / see-GP / urgent-care / ED) with a cited rationale. Every interview and its outcome is written back to FHIR as standard R4 resources.

It implements the contest's suggested **Conversational FHIR Triage Assistant**, and the agent is called **inside a real IRIS Interoperability production** — a REST business service dispatches to a triage business operation that raises `Ens.AlertRequest` on escalation, so every triage is a traceable message in Visual Trace, not a side-channel API call.

---

## Why Triage Park

Triage is the most contested idea in this contest. Here is what sets this entry apart:

- **A deterministic safety gate that can only escalate.** Before the LLM runs, a hard-coded screen for can't-miss emergencies (stroke signs, airway compromise, anaphylaxis, major haemorrhage, syncope, suicidal ideation) short-circuits straight to ED. The probabilistic reasoner sits *on top of* this floor — a missed keyword can never lower a triage level below a matched emergency. Patient safety doesn't depend on an LLM getting it right.
- **The agent lives in the platform, not beside it.** It's a first-class Interoperability business operation. Every triage flows through `Ens.MessageHeader` and is visible in Visual Trace — exactly the "AI agent called in an interoperability FHIR solution" the contest asks for.
- **Embeddings run server-side in IRIS.** The agent sends *raw text*; IRIS computes embeddings via `%Embedding.OpenAI` (AI Hub) and runs HNSW-indexed `VECTOR_COSINE` search. That's the platform's intended AI-Hub pattern, not a bolt-on vector store.
- **Full FHIR write-back, not just reads.** Every interview persists five resource types (`QuestionnaireResponse`, `Encounter`, `ServiceRequest`, coded `Observation`s, `Communication`). The clinician console reconstructs an entire past case from FHIR alone — no LLM re-run.
- **One command, then a live URL.** `docker compose up --build` boots all three services; or skip the clone entirely and open the [hosted demo](https://triagepark.78-47-167-98.sslip.io/).

---

## See it

**▶ [Watch the 3-minute walkthrough](https://youtu.be/3hqf62btWYQ)** — the patient interviews, the agent triages, the clinician reviews. · **[Try the live demo](https://triagepark.78-47-167-98.sslip.io/)** ([patient intake](https://triagepark.78-47-167-98.sslip.io/intake))

| Patient intake interview (`/intake`) | Clinician console (`/`) |
| --- | --- |
| ![Patient intake interview — the 6-question structured intake chat](docs/images/intake-interview.png) | ![Clinician console — the triage worklist](docs/images/clinician-console.png) |

The clinician handoff — grounded on the patient's FHIR record, with cited guidelines and the IDs of every resource written back:

![Clinician handoff summary with triage level, cited guidelines, and written-back FHIR resource IDs](docs/images/handoff-summary.png)

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

Once seeding finishes, the console shows six example cases spanning all four triage levels — no interview needed. Then open `/intake`, run the demo patient `demo-patient-1` (Marcus Reeves, cardiac-risk-loaded) through the chest-tightness scenario, and watch a new case appear live in the worklist.

> Prefer not to install anything? The full app is hosted at **[triagepark.78-47-167-98.sslip.io](https://triagepark.78-47-167-98.sslip.io/)**.

---

## What it does

**Two front doors, one FHIR backend.**

- **Patient intake** (`/intake`) — a first-person interview: chief complaint, onset, a 1–10 severity scale, a symptom checklist, history, and self-treatment. Answers are saved to FHIR as a `QuestionnaireResponse`; the patient gets a plain-language next step.
- **Clinician console** (`/`) — a worklist of triaged cases, newest first, with urgent cases flagged. Opening a case shows the patient's standing record, the interview transcript, the agent's assessment and cited guidelines, and an **Acknowledge** action for escalated cases (written back to FHIR).

---

## The safety gate

Triage Park's flagship design choice is that **clinical safety is deterministic, not probabilistic.**

```
retrieve_guidelines
      │
      ▼
validate_red_flags   ── hard emergency phrase matched ──▶ escalate to ED  (no LLM call)
      │
      └── clear ──▶ reason (single structured LLM call) ──▶ escalate if urgent-care/ED
```

`validate_red_flags` runs *before* the LLM. A non-negated match on a can't-miss phrase (with a cheap negation guard, so "no slurred speech" doesn't fire) short-circuits straight to ED escalation, skipping the model entirely. The gate **can only ever escalate, never downgrade** — so the LLM missing a keyword cannot lower a triage level below a matched red flag.

The scope is deliberately narrow: only presentations that warrant the ED *regardless of context*. Nuanced complaints — chest tightness, for example — are intentionally **not** hard-coded; they need the patient's FHIR risk factors and guideline retrieval to triage correctly, and that reasoning is the LLM's job. The gate is the floor under the reasoner, not a replacement for it. Both paths are covered by unit tests (`src/python/tests/`).

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
   │   Interoperability production:                       │
   │     REST inbox (BS) → triage agent (BO) →            │
   │     Ens.AlertRequest on escalation                   │
   │   %Embedding.OpenAI (AI Hub)  ·  VECTOR_COSINE       │
   └───────────────────┼─────────────────────────────────┘
                        │ POST /run · /interview
        central-park-agent (FastAPI + LangGraph)
          gather_context → retrieve_guidelines →
          validate_red_flags → reason → escalate
                        │
                  OpenAI (chat)
```

Three services, one external dependency (OpenAI). The agent is invoked through the IRIS production — `CentralPark.REST.Dispatch` spawns the `RESTInbox` business service, which `SendRequestSync`s to the `TriageAgent` business operation, so every call lands in Visual Trace as an `Ens.MessageHeader`. The LangGraph reasoning itself executes in the Python sidecar over HTTP; see the note below on why.

> **Why a sidecar and not Embedded Python?** The production graph stays first-class either way — the agent is a real business operation in Visual Trace. But this image's ARM64 Embedded Python build is unstable (Callin `<SYSTEM>` aborts on `import`, broken `_uuid`), so running the LangGraph stack in-process would make the app fail to start on Apple-Silicon hosts. Keeping the reasoner in a sidecar trades the Embedded Python bonus for an app that boots reliably everywhere — the right call for a demo a judge has to run.

---

## InterSystems features used

| Capability | How Triage Park uses it |
| --- | --- |
| **FHIR R4** | Reads patient context; writes `QuestionnaireResponse`, `Encounter`, `ServiceRequest`, coded `Observation`s, and `Communication` |
| **Vector Search** | `VECTOR(float, 1536)` guideline corpus queried with HNSW-indexed `VECTOR_COSINE` |
| **AI Hub** | `%Embedding.Config` + `%Embedding.OpenAI` embed guidelines and queries *inside* IRIS; SSL config installed at boot |
| **Interoperability** | Production with a REST inbox business service, a triage agent business operation, and `Ens.AlertRequest` on urgent cases — every triage visible in Visual Trace |
| **LLM / LangGraph** | Five-node state machine (gather context → retrieve guidelines → red-flag gate → reason → escalate); single deterministic LLM call returning structured JSON |
| **Docker** | `docker compose up --build` boots all three services |
| **IPM / ZPM** | `module.xml` manifest for one-line deployment |

### FHIR resources written

| Resource | When | Carries |
| --- | --- | --- |
| `QuestionnaireResponse` | every interview | the patient's answers |
| `Encounter` | every triage | the virtual consultation |
| `ServiceRequest` | every triage | triage level (SNOMED), chief complaint, the agent's narrative (HPI, actions, red flags, cited guidelines), and clinician acknowledgement as notes |
| `Observation` | interview | LOINC severity score + SNOMED symptom flags parsed from answers |
| `Communication` | urgent/ED | the escalation alert |

Persisting the narrative on the `ServiceRequest` is what lets the console reconstruct a full past case from FHIR alone — no LLM re-run.

---

## Contest bonuses

The [contest bonuses](https://community.intersystems.com/post/technology-bonuses-intersystems-programming-contest-ai-agents-fhir) this submission earns, with where each lands.

| Bonus | Points | Where |
| --- | --- | --- |
| Implement a suggested task | 5 | **Conversational FHIR Triage Assistant** — suggested topic #10 |
| InterSystems FHIR Server usage | 2 | Native IRIS for Health FHIR R4 endpoint — reads context, writes 5 resource types |
| Vector Search usage | 4 | `VECTOR(float, 1536)` corpus queried with `VECTOR_COSINE` |
| LLM AI / LangChain usage | 3 | Five-node LangGraph state machine + structured LLM reasoning |
| Docker container usage | 2 | `docker compose up --build` boots all three services |
| ZPM (IPM) package deployment | 2 | `module.xml` manifest |
| Online Demo | 2 | [triagepark.78-47-167-98.sslip.io](https://triagepark.78-47-167-98.sslip.io/) |
| Implement a Community Idea | 4 | Implements [TTTC — *The Tool That Cares*](https://ideas.intersystems.com/ideas/DPI-I-283) |
| First Article on Developer Community | 2 | Build write-up on the Developer Community |
| Second Article on DC | 1 | Second write-up / translation |
| First Time Contribution | 3 | First InterSystems Open Exchange submission |
| Videos on YouTube (3 × 3) | 9 | [Walkthrough](https://youtu.be/3hqf62btWYQ) · [Deep dive](https://youtu.be/GeOe1DwS50I) · [Original demo](https://youtu.be/g6undsoEDms) |

**Total: 39 points.**

---

## Project layout

```
.
├─ ui/                      # React SPA — clinician console (/) + patient intake (/intake)
├─ agent/                   # Dockerfile for the FastAPI + LangGraph sidecar
├─ src/
│  ├─ python/central_park/  # Agent: LangGraph graph, tools (FHIR · vector · escalate), seeding
│  ├─ python/tests/         # Unit tests for the deterministic red-flag gate
│  └─ cls/CentralPark/      # ObjectScript: FHIR install, REST dispatch, interop production
├─ iris-config/             # Boot script + demo seed bundles (patients, questionnaire)
├─ web/                     # Static assets served by IRIS
├─ Dockerfile               # IRIS for Health image: namespace, FHIR R4 endpoint, classes
├─ docker-compose.yml       # iris + agent + ui  (+ optional ollama profile)
├─ docker-compose.prod.yml  # adds a Caddy HTTPS reverse proxy for the hosted demo
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
| **Liam Foster** | 5, parent-reported, prior ear infections | See-GP — fever and ear pain (otitis media) |
| **Eleanor Whitfield** | 72, type 2 diabetes | Urgent-care — dysuria with flank pain and fever (pyelonephritis) |
| **Daniel Osei** | 28, no chronic conditions | Urgent-care — migratory right-lower-quadrant pain (possible appendicitis) |
| **Sofia Marchetti** | 44, asthma | Emergency — acute breathlessness |

The seeded cases span all four triage levels across a range of ages and presentations. Marcus is deliberately cardiac-risk-loaded so a chest-tightness scenario exercises real reasoning over his FHIR record.

---

## Verify

```bash
curl http://localhost:8001/health                                    # agent
curl -u _SYSTEM:SYS http://localhost:52773/centralpark/health         # IRIS

# Vector search (no LLM chat cost — embeds + searches inside IRIS)
curl -X POST http://localhost:52773/centralpark/vector/search -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' -d '{"query":"chest tightness on exertion","k":3}'

# Direct triage (chat LLM); writes a Communication when urgent
curl -X POST http://localhost:52773/centralpark/triage -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' \
  -d '{"patient_id":"demo-patient-1","message":"My chest feels tight when I walk upstairs."}'

# Run the safety-gate unit tests
docker compose exec agent python -m pytest tests/ -q
```

Visual Trace shows every triage as an `Ens.MessageHeader`; the Embedding config lives under System Administration → Configuration → Connectivity → Embedding Configurations.

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

---

## Authors

**Hong Eungi** and **Antor Chowdhury** — first-time InterSystems Open Exchange contributors.

**License** — MIT, see [LICENSE](LICENSE).
