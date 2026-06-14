# Triage Park - Video Storyboard

A production-ready plan for the contest video. The goal: in three minutes, make a
judge understand that Triage Park is not "a triage chatbot" but a **multi-agent
clinical platform on InterSystems IRIS** with a safety guarantee no other entry
has. Every claim shown on screen is real and demoable.

There are two cuts:
- **Cut A - Contest video (target 3:00).** The one you submit. Tight, demo-led.
- **Cut B - Deep dive (optional, 5–7 min).** For the second/third YouTube bonus; same beats, slower, more Visual Trace and code.

This document covers Cut A scene by scene, then the slide deck, then the shot list, recording setup, and a voiceover script you can read verbatim.

---

## 0. Pre-flight (before you hit record)

Run a clean stack so nothing stalls on camera:

```bash
docker compose down -v
docker compose up --build      # wait ~90s; confirm the worklist shows seeded cases
```

Have these tabs/states ready:
- **Tab 1** - Clinician console: `http://localhost:8501/`
- **Tab 2** - Patient intake: `http://localhost:8501/intake`
- **Tab 3** - IRIS Management Portal → Interoperability → Visual Trace (`http://localhost:52773/csp/sys/UtilHome.csp`, `_SYSTEM` / `SYS`)
- **Tab 4** - IRIS Management Portal → System Administration → Configuration → Connectivity → Embedding Configurations (to show AI Hub)

Demo patients to use:
- **Marcus Reeves** (`demo-patient-1`) - 53, HTN / hyperlipidemia / T2DM, on Lisinopril. The hero case.
- Use the **chest-tightness** scenario for nuanced reasoning, and an **"lips and tongue swelling"** message to trigger the deterministic safety agent (ACE-inhibitor → angioedema → ED).

Record at 1920×1080, browser at ~110% zoom so text is legible. Hide bookmarks/extensions. Use a cursor-highlight tool.

---

## 1. Scene-by-scene (Cut A, 3:00)

### Scene 1 - Hook + problem (0:00–0:18) · SLIDE
**Visual:** Title slide → one problem slide (see deck S1, S2).
**On-screen text:** "Every visit starts with the same manual work." then "What if a team of AI agents did the first pass - safely?"
**Voiceover:**
> "Every clinic visit starts the same way: take the history, cross-check the record, judge how urgent it is. Triage Park does that first pass - as a team of specialist AI agents running inside InterSystems IRIS, with a safety floor that can only ever escalate."

### Scene 2 - Patient intake, adaptive + multilingual (0:18–0:50) · DEMO (Tab 2)
**Action:**
1. Open `/intake`. Pick a language from the selector (show **Español** or **中文** briefly), then English.
2. Type the chief complaint: *"My chest feels tight when I climb stairs."*
3. Show the agent asking the **next question it chose** (severity scale, then the associated-symptoms checklist). Emphasize: questions adapt to the answers + the patient's FHIR record.
4. Submit. Show the processing → done screen with the plain-language next step.

**On-screen callouts:** "Adaptive - the agent picks each question" · "Multilingual" · "Saved to FHIR as a QuestionnaireResponse"
**Voiceover:**
> "Intake is an adaptive interview, in the patient's language. The agent chooses each next question from what it's heard and the patient's FHIR record - a cardiac-risk patient gets asked about exertion; a sore throat doesn't. Every answer is written back to FHIR."

### Scene 3 - Clinician worklist + the safety gate (0:50–1:30) · DEMO (Tab 1)
**Action:**
1. Switch to the clinician console. Show the **Worklist** with caseload **KPI cards** (Total, Acute, Need review, Acknowledged) and acuity-ordered cases.
2. Open Marcus's case. Land on the **Overview** tab: triage level pill, chief complaint, **Assessment** with cited guidelines.
3. **The money moment:** in a second browser action (or pre-recorded), run the safety case. Quickest on camera: open the **Assistant** or use the agent, or show a fresh `/intake` with "my lips and tongue are swelling." Result: escalated to **ED**, a **Medication / allergy interactions** banner (ACE-inhibitor → angioedema), `DetectedIssue` written.

**On-screen callouts:** "Deterministic safety agent - no LLM" · "One-directional: can only escalate" · "Written to FHIR as DetectedIssue"
**Voiceover:**
> "The clinician opens a ready-made handoff: triage level, assessment, cited guidelines. Underneath sit three deterministic safety layers that can only raise acuity, never lower it. Here the safety agent sees an ACE-inhibitor plus facial swelling, flags possible angioedema, and escalates to the ED - before any language model runs. Patient safety never rests on the LLM getting it right."

### Scene 4 - The agent toolbox + explainability (1:30–2:00) · DEMO (Tab 1, case detail)
**Action:**
1. In the case, click the **Agents** tab. Show the cards populating: **Readmission risk** (band + score + drivers), **Gaps in care** (writes Tasks), **Result follow-up**, then click **Patient summary** and **Care plan** to show on-demand LLM agents.
2. Scroll to **Agent reasoning** - the step timeline (Context → Safety → Red-flag gate → Triage agent tool calls → Reviewer).

**On-screen callouts:** "9+ specialist agents" · "Writes DetectedIssue, Task, CarePlan, Observation, ServiceRequest" · "Every decision is explainable"
**Voiceover:**
> "Triage is one capability among many. The same FHIR-grounded core powers a risk workbench, preventive-care gaps, result follow-up, summaries, and a care-plan agent - each writing standard FHIR resources back. And every case shows exactly which agents ran and why."

### Scene 5 - Platform: Cohort, Explore, Assistant/orchestrator (2:00–2:35) · DEMO (Tab 1 nav)
**Action:**
1. **Cohort** tab - show the analytics: risk donut, **care gaps grouped by type** (bar chart), top conditions, KPIs.
2. **Explore** tab - type *"patients with diabetes"*; show the translated `GET /Condition?…` and the results.
3. **Assistant** tab - type *"Summarize this patient, check readmission risk, and flag care gaps."* Show the answer + the **agent chain chips** (summary → risk → gaps).

**On-screen callouts:** "Population analytics" · "Natural language → validated FHIR query" · "One request, routed and chained across agents"
**Voiceover:**
> "Zoom out and it's a platform: population analytics across the whole panel, natural-language FHIR querying, and an orchestrator that routes one request across the right agents - and chains several when needed. Summarize, score risk, and find gaps, in one ask."

### Scene 6 - Under the hood: real IRIS interoperability (2:35–2:50) · DEMO (Tab 3) + SLIDE
**Action:** Switch to **Visual Trace**. Show a triage as `Ens.MessageHeader` flowing REST inbox → triage agent business operation → `Ens.AlertRequest`. Quick cut to the Embedding Configurations screen (AI Hub).
**On-screen callouts:** "A real Interoperability production - every triage is a traceable message" · "Server-side embeddings via AI Hub + VECTOR_COSINE" · "IntegratedML risk model"
**Voiceover:**
> "None of this is bolted on. The agents are called inside a real IRIS Interoperability production - every triage is a traceable message in Visual Trace. Embeddings and vector search run server-side in IRIS, and the risk model is IntegratedML."

### Scene 7 - Close + CTA (2:50–3:00) · SLIDE
**Visual:** Recap slide (deck S8) → title card with the vote link.
**On-screen text:** "Triage Park - a multi-agent clinical platform on IRIS. Deterministic safety. Full FHIR write-back. Explainable." + "Vote in the InterSystems AI Agents for FHIR contest."
**Voiceover:**
> "Triage Park: a multi-agent clinical platform on IRIS, with a safety floor that can only escalate, full FHIR write-back, and a reason for every decision. Thanks for watching - and for your vote."

---

## 2. Slide deck (the non-demo frames)

Keep slides minimal: dark or clean white, one idea each, big type. Suggested 8 slides.

- **S1 - Title.** "Triage Park" + tagline "A multi-agent clinical triage platform on IRIS." Logo/pulse mark. Authors. Contest name.
- **S2 - Problem.** "The pre-checkup is manual, repetitive, and risky to rush." Three icons: history · cross-check record · judge urgency.
- **S3 - One-liner solution.** "A team of specialist agents does the first pass - safely - and hands the clinician a cited, explainable handoff."
- **S4 - Architecture diagram.** The three-service diagram from the README (browser → UI → IRIS interop production + FHIR + AI Hub + IntegratedML ← agent sidecar). Animate the triage message path.
- **S5 - The agents.** A grid of the agents (intake, triage reasoner, safety, red-flag gate, reviewer, risk, gaps, summary, labs, follow-up, care-plan, cohort, NL→FHIR query, copilot, orchestrator). Caption: "Deterministic where safety matters, agentic where judgment matters."
- **S6 - The safety guarantee.** The layered diagram: red-flag gate → reason loop → reviewer, with the arrow "can only escalate, never downgrade." This is the differentiator slide - linger here.
- **S7 - InterSystems features used.** Checklist: FHIR R4 (reads + 8 resource types written) · Interoperability production + Visual Trace · Vector Search (VECTOR_COSINE) · AI Hub embeddings · IntegratedML · Docker · IPM. Maps directly to the technology bonuses.
- **S8 - Recap + CTA.** Three bold lines: "Deterministic safety floor." "Full FHIR write-back." "Explainable, multi-agent." + vote link + live demo URL.

---

## 3. Shot list (quick reference)

| # | Time | Source | Action / shot | On-screen text |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | Slides | Title + problem | "What if a team of AI agents did the first pass - safely?" |
| 2 | 0:18 | /intake | Language pick → chest-tightness → adaptive Qs → done | "Adaptive · Multilingual · Written to FHIR" |
| 3 | 0:50 | console | Worklist KPIs → case Overview → safety escalation (angioedema → ED) | "Deterministic safety · can only escalate · DetectedIssue" |
| 4 | 1:30 | case → Agents | Risk / gaps / follow-up cards + summary/care-plan + reasoning trail | "9+ agents · writes FHIR · explainable" |
| 5 | 2:00 | nav | Cohort analytics → Explore NL query → Assistant chained | "Population analytics · NL→FHIR · orchestration" |
| 6 | 2:35 | Visual Trace | Ens.MessageHeader path + Embedding config | "Real interop production · AI Hub · IntegratedML" |
| 7 | 2:50 | Slides | Recap + CTA | Vote link + demo URL |

---

## 4. Recording & editing notes

- **Pace:** demo segments should feel snappy - pre-type long inputs into a notes file and paste, don't type on camera. For agent calls that take a few seconds, cut the dead time.
- **The safety moment (Scene 3) is the emotional peak.** Consider a subtle zoom/pause and a soft "ding" when ED escalation appears. This is the one thing competitors don't have - sell it.
- **Captions:** burn in the on-screen callouts; many judges watch muted first.
- **Cursor:** use a highlight/click-ring so the eye follows the action.
- **Length discipline:** if you run long, cut Scene 6 to 8 seconds (Visual Trace only) rather than trimming the safety moment.
- **Music:** low, neutral, no lyrics. Duck under voiceover.
- **Thumbnail:** the case-detail screen with the red "ED" pill + "Agent reasoning" timeline visible - it reads as "serious clinical AI."

## 5. Optional Cut B additions (deep dive)

- Walk the LangGraph node diagram from the README and map each node to a Visual Trace message.
- Show the reason loop actually calling `search_guidelines` / `get_observations` (agent logs).
- Open a written `ServiceRequest` in the FHIR explorer and show the persisted narrative + the parsed-back reasoning trail.
- Toggle `CP_LLM_PROVIDER=anthropic` or the `ollama` profile to show provider-agnosticism.
- Show `docker compose exec agent python -m pytest tests/ -q` going green (the safety-gate + agent tests) - proof the safety logic is tested.
