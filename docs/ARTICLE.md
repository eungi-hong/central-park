# Triage Park: a multi-agent clinical platform on IRIS, with a safety floor that can only escalate

*Submitted to the InterSystems Programming Contest: AI Agents for FHIR.*
*Live demo: https://triagepark.78-47-167-98.sslip.io/ · Code: https://github.com/eungi-hong/central-park*

---

Ask a clinician what the first ten minutes of a visit look like and you'll hear the same list every time: take the history, pull up the record, cross-check the medications, and decide how urgent this is. It's necessary, it's repetitive, and rushing it is exactly how things get missed.

So we built **Triage Park**: a team of AI agents, backed by deterministic safety checks, that does that first pass, runs entirely inside InterSystems IRIS for Health, and hands the clinician a cited, explainable handoff. The thing we cared about most is the thing most "AI triage" demos hand-wave: **safety**. In Triage Park, clinical safety is *deterministic*, and every safety mechanism is one-directional - it can raise how urgent a case is, never lower it. Patient safety never rests on a language model getting it right on the first try.

This article walks through how it's built and the decisions we think make it worth a look.

## The shape of the system

Three containers, one external dependency (an LLM for chat):

- **`central-park-iris`** - IRIS for Health: the FHIR R4 repository, a real Interoperability production, server-side embeddings via AI Hub, vector search, and an IntegratedML risk model.
- **`central-park-agent`** - a FastAPI + LangGraph sidecar that hosts the agents.
- **`central-park-ui`** - a React clinician console and a patient intake app.

`docker compose up --build` boots all three. The agents are not a side-channel: they are called *inside* the IRIS production. A REST business service dispatches to a triage business operation that raises `Ens.AlertRequest` on escalation, so **every triage is a traceable message in Visual Trace**, exactly the "AI agent called in an interoperability FHIR solution" the contest asks for.

## The part we're proud of: a deterministic safety floor

The triage flow is a LangGraph state machine, but the headline isn't the graph - it's that three of its layers are deterministic and one-directional. Here is the path:

```
gather_context → check_safety → validate_red_flags → reason (tool loop) → verify → escalate
```

**1. The red-flag gate runs before any LLM call.** A small, curated set of can't-miss phrases (stroke signs, airway compromise, anaphylaxis, major haemorrhage, syncope, suicidal ideation) short-circuits straight to the ED - with a cheap negation guard so "no slurred speech" doesn't fire:

```python
# a non-negated match on a can't-miss phrase escalates to ED, skipping the model
window = lowered[max(0, idx - 20):idx]
if any(neg in window for neg in _NEGATIONS):
    continue   # "denies passing out" does not escalate
```

The scope is deliberately narrow: only presentations that warrant the ED *regardless of context*. Nuanced complaints like chest tightness are intentionally **not** hard-coded - those need the patient's FHIR risk factors and guideline retrieval, which is the reasoner's job.

**2. A deterministic medication-interaction agent.** Before the LLM, a non-LLM agent cross-references the patient's active medications and allergies against the complaint (anticoagulant + bleeding, ACE-inhibitor + angioedema, NSAID + GI bleed, allergy exposure), writes each finding back as a FHIR `DetectedIssue`, and sets a triage floor. In the demo, a patient on Lisinopril who reports facial swelling is escalated to the ED for possible angioedema - before a single token is generated.

**3. A self-critique reviewer.** After the reasoning agent commits a triage, a reviewer agent re-reads it. It *deterministically* drops any citation whose guideline wasn't actually retrieved (so a hallucinated source can never reach the clinician), then an LLM critic may escalate the level if the evidence warrants - but is structurally forbidden from downgrading:

```python
if verdict == "escalate":
    final_level = _higher(level, proposed)   # escalate-only by construction
```

The result: a missed keyword, a hallucinated citation, or an over-confident model can each only ever make the triage *more* cautious.

## A real agent, not a one-shot prompt

The reasoning step (`reason`) is a bounded ReAct loop, not a single call. Each turn the model returns JSON choosing either a tool call or a final answer, and it decides what extra evidence it needs before committing:

```json
{"action": "get_observations", "args": {"contains": "blood pressure"}}
```

Available tools: a refined `search_guidelines` vector query, `get_observations` to zoom into specific vitals/labs, and `get_risk_score` to consult the IntegratedML model. The loop is capped and falls back to a single structured call if the model never commits, so it always resolves. On the chest-tightness demo, the agent pulls the patient's cardiac risk factors and the relevant guidelines and lands on ED - with both citations grounded in sources it actually retrieved.

## One platform: agents, checks, and skills

Triage is the flagship, but it's one capability among many. The platform is split on purpose: judgment-heavy work runs as agents (tool-using loops that decide and act), safety-critical work runs as deterministic checks (rules, not an LLM), and the rest are focused LLM skills. Each writes standard FHIR back where it makes sense.

| Capability | Kind | Writes |
| --- | --- | --- |
| **Triage** reasoner | Agent (tool loop) | `Encounter`, `ServiceRequest`, `Communication` |
| Adaptive **intake** interview (multilingual) | Agent (adaptive loop) | `QuestionnaireResponse` |
| **Copilot** | Agent (read-only tool loop) | - |
| **Reviewer** | LLM critic | (escalation only) |
| **Red-flag gate**, **safety / interaction** | Deterministic check | `DetectedIssue` |
| **Gaps-in-care**, **result follow-up** | Deterministic check | `Task` |
| **Cohort** analytics | Deterministic (batch) | - |
| **Risk** | IntegratedML / heuristic | - |
| **Summary**, **lab explainer**, **care plan**, **NL→FHIR query** | LLM skill | `CarePlan` (care plan) |

And over all of them sits a **supervisor orchestrator**: a clinician can type "summarize this patient, check readmission risk, and flag care gaps," and it routes to the right components and *chains* them - `summary → risk → gaps` - then synthesizes one answer. Each component keeps its own depth; routing doesn't flatten the triage loop or the safety floor.

The clinician console reflects this: a **Worklist** with caseload KPIs, a **Cohort** analytics view (risk distribution, care gaps grouped by type, top conditions), an **Explore** view for natural-language FHIR queries, and an **Assistant** driven by the orchestrator. Open a case and every decision is explainable - the console reconstructs the whole case, including which agents ran and the reviewer's verdict, from FHIR alone.

## Using the platform, not bolting onto it

- **Vector Search.** A guideline corpus stored as `VECTOR(float, 1536)`, queried with HNSW-indexed `VECTOR_COSINE`. The agent sends raw text; **IRIS computes the embeddings server-side** via `%Embedding.OpenAI` (AI Hub). That's the platform's intended AI-Hub pattern, not an external vector store.
- **IntegratedML.** `CentralPark.ML` runs `CREATE MODEL` / `TRAIN MODEL` (AutoML) on a synthetic cohort and serves row-level `PREDICT` for readmission risk, which the triage agent consults as a tool.
- **Interoperability.** Every triage flows through `Ens.MessageHeader` and is visible in Visual Trace.
- **FHIR R4.** Reads patient context and writes eight resource types; the narrative is persisted on the `ServiceRequest` so a past case is fully reviewable with no LLM re-run.

## Two honest engineering notes

Good engineering is also knowing what *not* to force, and we want to be straight about two choices.

**Why a sidecar and not Embedded Python?** The production graph is first-class either way - the agent is a real business operation in Visual Trace. But this image's ARM64 Embedded Python build is unstable (Callin `<SYSTEM>` aborts on `import`), so running the LangGraph stack in-process would make the app fail to boot on Apple-Silicon machines. We chose an app that boots reliably for every judge over a bonus that breaks on some hardware.

**IntegratedML is gated.** AutoML trains through that same Embedded Python runtime, so on the ARM64 demo image the model is **off by default** (`CP_ENABLE_ML=0`) to keep boot fast - and the risk agent falls back to a transparent heuristic that's labelled as such, so the feature is useful everywhere and lights up fully on x86 with one flag. We'd rather ship a degraded-gracefully feature than a hang.

## Try it

```bash
git clone https://github.com/eungi-hong/central-park.git
cd central-park
cp .env.example .env          # set OPENAI_API_KEY=sk-...
docker compose up --build      # IRIS cold start ~90s
```

Open the clinician console at `http://localhost:8501`, run the demo patient through the chest-tightness scenario at `/intake`, and watch the case appear - triaged, cited, and explainable. Or skip the clone and open the [hosted demo](https://triagepark.78-47-167-98.sslip.io/).

The safety logic is covered by unit tests (`docker compose exec agent python -m pytest tests/ -q`): the deterministic red-flag gate, the medication-interaction agent, the escalate-only reviewer, and the reasoning loop's tool execution and fallback. We test the parts that protect patients.

---

*Triage Park is a first InterSystems Open Exchange contribution by Hong Eungi and Antor Chowdhury. If the layered-safety approach resonates, we'd love your vote and your feedback in the comments.*
