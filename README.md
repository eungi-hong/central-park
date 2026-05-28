# Central Park

A conversational FHIR triage assistant. A patient asks a question in plain language. The agent reads the patient's own FHIR record (conditions, medications, recent observations, allergies), retrieves relevant triage guidelines from IRIS Vector Search, and answers with a level (self-care, see-GP, urgent-care, ED) plus a citation trail. When the level is urgent-care or ED, the agent writes a `Communication` resource back to FHIR and raises an alert through an IRIS Interoperability production.

Built for the [InterSystems Programming Contest: AI Agents for FHIR](https://openexchange.intersystems.com/contest/46), May to June 2026.

## Status

Scaffold. The boot path, the IRIS production with HTTP outbound to a Python sidecar, and the LangGraph agent shape are in place. FHIR retrieval, vector retrieval, escalation, and the patient-facing UI are stubbed and tracked below.

## How it works

```
patient browser
      │  POST /centralpark/triage  { patient_id, message }
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  IRIS for Health (Community Edition) — central-park-iris             │
│                                                                      │
│   CentralPark.REST.Dispatch  (%CSP.REST)                             │
│            │                                                         │
│            ▼                                                         │
│   CentralPark.Production  (Ens.Production)                           │
│            │                                                         │
│            ▼                                                         │
│   CentralPark.Operation.TriageAgent  (Ens.BusinessOperation)         │
│            │       EnsLib.HTTP.OutboundAdapter                       │
└────────────┼─────────────────────────────────────────────────────────┘
             │  POST http://agent:8000/run
             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Python sidecar — central-park-agent                                 │
│                                                                      │
│   FastAPI app   →   central_park.agent.run()  (LangGraph)            │
│                              │                                       │
│                              ├─▶ FHIR R4 (back to IRIS endpoint)     │
│                              ├─▶ IRIS Vector Search (guidelines)     │
│                              └─▶ LLM (openai | anthropic | ollama)   │
└──────────────────────────────────────────────────────────────────────┘
```

The agent is a LangGraph state machine with four nodes (`gather_context`, `retrieve_guidelines`, `reason`, `respond_or_escalate`). The graph is deterministic: every turn ends in either a `respond` or `escalate` terminal.

### Why a sidecar, not Embedded Python

The first scaffold ran the LangGraph agent inside the IRIS process via Embedded Python. On `intersystemsdc/irishealth-community:latest-cd` running on ARM64 (Apple Silicon), this image's Embedded Python integration is unstable: class methods with `[Language = python]` SIGSEGV the work-queue compiler, the bundled `_uuid` built-in is missing `has_uuid_generate_time_safe` so any stdlib `uuid` import crashes, and Callin worker processes SEGV intermittently under sustained load. Rather than work around each bug, the agent moved to a sidecar container the IRIS production calls over HTTP. Local dev edits are picked up via bind-mount + uvicorn reload, and the agent itself can be exercised independently of IRIS.

## Quickstart

Requirements: Docker + Docker Compose. An OpenAI API key in `.env` if you want the default provider, otherwise switch `CP_LLM_PROVIDER` to `ollama` and point at a local Ollama install.

```bash
git clone https://github.com/eungi-h/central-park.git
cd central-park
cp .env.example .env       # then fill in OPENAI_API_KEY
docker compose up --build
```

On first boot, IRIS for Health takes about 90 seconds to come up; the agent sidecar boots in a few seconds. The IRIS bootstrap creates the `CENTRALPARK` namespace, enables the FHIR R4 endpoint at `/csp/healthshare/centralpark/fhir/r4`, and starts the `CentralPark.Production` production with the HTTP outbound configured for the agent service.

Once both services are healthy:

```bash
# Agent sidecar (host port 8001 → container 8000)
curl http://localhost:8001/health
# → {"status":"ok","service":"central-park-agent"}

# IRIS REST surface (auth: _SYSTEM:SYS by default)
curl http://localhost:52773/centralpark/health -u _SYSTEM:SYS
# → {"status":"ok","service":"central-park"}

# End-to-end triage call
curl -X POST http://localhost:52773/centralpark/triage \
  -u _SYSTEM:SYS \
  -H 'Content-Type: application/json' \
  -d '{"patient_id":"example-1","message":"My chest feels tight when I walk upstairs."}'
```

Management portal: <http://localhost:52773/csp/sys/UtilHome.csp> (`_SYSTEM` / `SYS`).

## Configuration

Runtime config via environment variables. Defaults in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `CP_LLM_PROVIDER` | `openai`, `anthropic`, or `ollama` |
| `OPENAI_API_KEY` / `CP_OPENAI_MODEL` | OpenAI credentials and model |
| `ANTHROPIC_API_KEY` / `CP_ANTHROPIC_MODEL` | Anthropic credentials and model |
| `CP_OLLAMA_BASE_URL` / `CP_OLLAMA_MODEL` | Ollama URL and model tag |
| `CP_FHIR_BASE_URL` | FHIR base, defaults to the in-container endpoint |

## Repository layout

```
central-park/
├── docker-compose.yml
├── Dockerfile                   # IRIS for Health image
├── agent/
│   └── Dockerfile               # Python sidecar image
├── module.xml                   # IPM manifest
├── iris-config/
│   └── iris.script              # boot-time IRIS setup
└── src/
    ├── cls/CentralPark/         # ObjectScript: production, REST, operation, messages
    └── python/central_park/     # Python sidecar: FastAPI + LangGraph
```

## Why this design

The contest brief asks for an AI agent *called in an interoperability FHIR solution*. The split here is intentional:

- **IRIS hosts the interop graph.** The REST endpoint, the production, and the business operation are all native IRIS, so the agent call is a first-class production message visible in Visual Trace, queryable from `Ens.MessageHeader`, and replaceable with a non-AI implementation behind the same `Ens.Request` if needed.
- **Python hosts the brain.** LangGraph, the LLM SDKs, and the embedding model live in a clean Python container. No bridge bugs, no shared interpreter state.
- **FHIR is both ingress and egress.** Patient context is pulled from the IRIS-hosted FHIR R4 endpoint by the agent. Escalations are written back as `Communication` resources, which downstream systems can subscribe to through the same FHIR machinery.

## Roadmap

Iteration 1 (this scaffold)
- [x] Project structure, license, docker compose with two services
- [x] ObjectScript skeleton (production, REST, operation, messages)
- [x] Python agent skeleton (LangGraph state machine, LLM provider adapter)
- [x] Sidecar FastAPI app, IRIS HTTP outbound adapter wiring
- [ ] Verified end-to-end smoke test (in progress)

Iteration 2
- [ ] `fhir.get_patient_context` real implementation against the in-container FHIR R4 endpoint
- [ ] `vector.search_guidelines` using IRIS native vector columns, seeded with ~30 triage rules
- [ ] `escalate.create_alert` writing a `Communication` resource via FHIR
- [ ] Synthea sample patient bundle loaded at boot
- [ ] Minimal HTMX chat UI at `/centralpark/`
- [ ] 3 minute screen recording for the demo video

## License

MIT, see `LICENSE`.
