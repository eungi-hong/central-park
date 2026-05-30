# Central Park

A conversational FHIR triage assistant. A patient asks a question in plain language. An LLM-backed agent reads the patient's own FHIR record, retrieves matching triage guidelines via **IRIS-native Vector Search backed by the AI Hub `%Embedding.OpenAI` provider**, and answers with a structured triage level (self-care, see-GP, urgent-care, ED) plus citations. When the level is urgent-care or ED, the agent writes a `Communication` resource to the FHIR endpoint and raises an `Ens.AlertRequest` through the IRIS Interoperability production.

Built for the [InterSystems Programming Contest: AI Agents for FHIR](https://openexchange.intersystems.com/contest/46), May to June 2026.

## Quickstart

```bash
git clone https://github.com/eungi-h/central-park.git
cd central-park
cp .env.example .env
# in .env: set OPENAI_API_KEY=sk-...
docker compose up --build
```

Two containers boot. IRIS for Health takes about 90 seconds on a cold start; the agent sidecar boots in seconds. Once the logs show `Production started`, try the demo patient (Marcus Reeves, 53 male, hypertension + hyperlipidemia + type 2 diabetes, BP 148/94, HbA1c 7.8, on lisinopril / atorvastatin / metformin, penicillin allergy):

```bash
curl -X POST http://localhost:52773/centralpark/triage \
  -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' \
  -d '{"patient_id":"demo-patient-1","message":"My chest feels tight when I walk upstairs."}'
```

Expected: structured JSON with `level`, `summary`, `citations` sourced from the seeded triage corpus, and `communication_id` (id of the Communication resource written back to FHIR if the level is urgent).

## Architecture

```
patient browser
      │  POST /centralpark/triage  { patient_id, message }
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  central-park-iris   (IRIS for Health Community Edition)             │
│                                                                      │
│   CentralPark.REST.Dispatch   (%CSP.REST)                            │
│     /health  /triage  /vector/seed  /vector/search                   │
│                                                                      │
│   CentralPark.Production  (Ens.Production)                           │
│     - REST Inbox  (Ens.BusinessService)                              │
│     - Triage Agent  (Ens.BusinessOperation + HTTP OutboundAdapter)   │
│       ├── HTTP POST → http://agent:8000/run                          │
│       └── raises Ens.AlertRequest when level is urgent-care or ED    │
│                                                                      │
│   FHIR R4 endpoint at /csp/healthshare/centralpark/fhir/r4           │
│                                                                      │
│   AI Hub native embedding:                                           │
│     %Embedding.Config row "central-park-openai"                      │
│       → %Embedding.OpenAI                                            │
│       → text-embedding-3-small (1536-dim)                            │
│                                                                      │
│   Vector Search:                                                     │
│     CentralPark.Data.Guideline  (VECTOR DOUBLE(1536) + VECTOR_COSINE)│
│     queried via VECTOR_COSINE                                        │
└────────────┼─────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  central-park-agent   (python:3.12-slim + FastAPI + LangGraph)       │
│                                                                      │
│   POST /run  →  central_park.agent.run()                             │
│     ┌──────────────┐    ┌──────────────────┐    ┌────────┐    ┌─────┐│
│     │gather_context│──▶│retrieve_guidelines│──▶│ reason │──▶│esc. ││
│     └──────────────┘    └──────────────────┘    └────────┘    └─────┘│
│            │                     │                  │           │   │
│       FHIR R4              IRIS vector/search       LLM      FHIR    │
│       (back to iris)       (back to iris)           chat      write  │
└──────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
                                                  OpenAI Chat Completions
                                                  (gpt-4o-mini by default)
```

Two services, one external dependency (OpenAI). The agent never embeds in Python; it sends raw text to IRIS, which embeds via `%Embedding.OpenAI` server-side. This is the contest's recommended pattern for AI Hub usage.

### Why IRIS embeds, not the sidecar

The first iteration of the sidecar pulled embeddings via the OpenAI Python SDK and POSTed pre-computed vectors into IRIS. After researching the platform's native surface (`%Embedding.Interface`, `%Embedding.OpenAI`, `%Embedding.Config`), we moved the embedding call into IRIS itself, so:

- Embeddings are configured once via a `%Embedding.Config` row, visible and editable in the Management Portal
- The sidecar's payload to `/vector/seed` and `/vector/search` is just text, not 1536-float arrays
- The HNSW vector index lives next to the data and is updated automatically on insert
- The architecture matches the platform's intended pattern, which the contest explicitly calls out as a feature to use

The LLM **chat** call stays in the sidecar because the platform does not ship a native chat-completion class in `irishealth-community:latest-cd`. Chat goes directly from Python to OpenAI's Chat Completions endpoint. The LangGraph state machine wraps the four-step flow.

### Why a sidecar at all (vs. Embedded Python in IRIS)

We tried. The image's ARM64 build of Embedded Python has multiple instabilities: class methods with `[Language = python]` SIGSEGV the work-queue compiler, the bundled `_uuid` built-in is missing `has_uuid_generate_time_safe` so any stdlib `uuid` import fails, and Callin worker processes SEGV intermittently. The sidecar sidesteps all of it. On x86 Linux these bugs may not reproduce; the architecture is still defensible because the IRIS production graph stays first-class (every triage is an `Ens.MessageHeader`, visible in Visual Trace).

## Contest bonus categories hit

- **FHIR integration**: native IRIS for Health FHIR R4 endpoint; the agent reads patient context and writes `Communication` resources
- **Digital Health Interoperability**: production graph with REST Inbox business service, Triage Agent business operation, HTTP outbound adapter, Ens alert raising
- **AI Hub**: `%Embedding.Config` + `%Embedding.OpenAI` used directly for guideline and query embedding; SSL config installed programmatically at boot
- **Vector Search**: `VECTOR(double, 1536)` column on `CentralPark.Data.Guideline`, queried via `VECTOR_COSINE` (HNSW index left for iteration 4 — DDL syntax wouldn't compile in this image)
- **LLM AI / LangGraph**: explicit four-node state machine (`langgraph` + `langchain-core`) in the sidecar
- **Embedded Python**: in iteration 2 we documented the ARM64 stability issues and chose a sidecar instead (transparent rationale in README)
- **Docker**: full `docker compose up --build` boot, two services
- **Idea implementation**: Conversational FHIR Triage Assistant (idea #10 of 12 suggested)
- **Demo video**: planned for iteration 3

## Configuration

Defaults are baked into `docker-compose.yml`; `.env` overrides anything you want. Copy `.env.example` to `.env` and fill in `OPENAI_API_KEY`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | (required) | Used by IRIS for embeddings and by the sidecar for chat |
| `CP_LLM_PROVIDER` | `openai` | One of `openai`, `anthropic`, `ollama` for the chat path |
| `CP_OPENAI_MODEL` | `gpt-4o-mini` | Sidecar chat model |
| `CP_FHIR_BASE_URL` | `http://iris:52773/.../fhir/r4` | In-container FHIR endpoint |
| `CP_IRIS_REST_BASE_URL` | `http://iris:52773/centralpark` | Internal REST for vector seed/search and triage |

### Optional: Anthropic for chat

```bash
# in .env
CP_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...   # still required, for embeddings via AI Hub
docker compose restart agent
```

### Optional: Ollama for offline chat (experimental)

```bash
# in .env
CP_LLM_PROVIDER=ollama
docker compose --profile ollama up --build
```

The bundled Ollama service pulls `llama3.2:3b` on first start (about 2 GB). Known issue: on Apple Silicon Docker Desktop the llama.cpp runner has crashed mid-inference for us; on x86 Linux this path is stable. OpenAI is still required for embeddings.

## Repository layout

```
central-park/
├── docker-compose.yml          IRIS + agent (Ollama optional via --profile ollama)
├── Dockerfile                   IRIS for Health image
├── agent/Dockerfile             Python sidecar image
├── module.xml                   IPM manifest
├── iris-config/
│   ├── iris.script              boot-time setup (namespace, FHIR, REST, SSL, embedding config)
│   └── seed/
│       └── demo-patient-1.json  Marcus Reeves seed bundle
└── src/
    ├── cls/CentralPark/         ObjectScript: production, REST, operation, data, install
    └── python/central_park/     Python: FastAPI app, LangGraph, FHIR/vector/escalate tools
```

## The demo patient

`Patient/demo-patient-1` is auto-seeded on first IRIS boot via `Install.cls`:

- 53 year old male, Marcus Reeves
- Active conditions: essential hypertension, hyperlipidemia, type 2 diabetes
- Active medications: lisinopril 20 mg, atorvastatin 40 mg, metformin 1000 mg twice daily
- Recent observations: BP 148/94 mmHg, HbA1c 7.8%, BMI 31.2
- Allergies: penicillin (high criticality, anaphylaxis)

The profile is deliberately cardiac-risk-loaded so the chest-tightness scenario meaningfully exercises the agent's reasoning over real clinical context.

## How to verify it works

```bash
# 1. Each layer alive
curl http://localhost:8001/health                                              # agent
curl -u _SYSTEM:SYS http://localhost:52773/centralpark/health                   # IRIS

# 2. FHIR endpoint
curl -H "Accept: application/fhir+json" \
  http://localhost:52773/csp/healthshare/centralpark/fhir/r4/Patient/demo-patient-1

# 3. Vector search directly (no LLM cost)
curl -X POST http://localhost:52773/centralpark/vector/search \
  -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' \
  -d '{"query":"chest tightness on exertion","k":3}'

# 4. End-to-end triage (chat LLM)
curl -X POST http://localhost:52773/centralpark/triage \
  -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' \
  -d '{"patient_id":"demo-patient-1","message":"My chest feels tight when I walk upstairs."}'

# 5. See the Communication the agent wrote back
curl -u _SYSTEM:SYS -H "Accept: application/fhir+json" \
  "http://localhost:52773/csp/healthshare/centralpark/fhir/r4/Communication?subject=Patient/demo-patient-1"
```

Management portal at <http://localhost:52773/csp/sys/UtilHome.csp> (`_SYSTEM` / `SYS`). The Embedding configuration is under System Administration → Configuration → Connectivity → Embedding Configurations; Visual Trace shows every triage call as an Ens message.

## How to iterate

- **Python edits**: change anything under `src/python/central_park/`, run `docker compose restart agent`. The package is bind-mounted so no rebuild.
- **ObjectScript edits**: change a `.cls` file, then reload inside IRIS:
  ```bash
  docker compose exec iris iris session IRIS -U CENTRALPARK \
    'do $system.OBJ.LoadDir("/home/irisowner/central-park/src/cls","ck",,1)'
  ```
- **Boot setup edits**: changes to `iris-config/iris.script`, `Dockerfile`, or `module.xml` need `docker compose up --build`.
- **Switch LLM**: edit `.env`, run `docker compose restart agent`.

## Roadmap

Iteration 1: project scaffold, sidecar architecture, IRIS boot path

Iteration 2: real FHIR retrieval, seed patient bundle, IRIS-native vector search, triage corpus, escalation path, Ollama bundle (later moved to optional)

Iteration 3 (current)
- [x] AI Hub native embedding via `%Embedding.OpenAI`
- [x] SSL config and Embedding config installed programmatically at boot
- [x] Simplified Python tools: send text, IRIS embeds
- [x] OpenAI default, Ollama optional via profile
- [ ] Minimal HTMX chat UI at `/centralpark/`
- [ ] 3 minute screen recording for the demo video
- [ ] OpenExchange listing prep

## License

MIT, see `LICENSE`.
