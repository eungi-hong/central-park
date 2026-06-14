# Triage Park - Video Storyboard

A production-ready plan for the contest video. The contest is **"AI Agents for
FHIR,"** so this cut is **agent-led**: it opens by naming the idea of an AI agent
for FHIR, shows that Triage Park is a *team* of such agents (perceive the record,
reason, act on FHIR, stay accountable), then gives a guided product tour, and
ends under the hood. The goal is that a judge finishes able to say: *this is
exactly the AI agent the brief asked for, built deeper and safer than the field,
and it helps real people.*

> **The thesis (say it in the first 15 seconds):** an AI agent for FHIR is not a
> chatbot. It **perceives** a patient's record, **reasons** over it with tools,
> **acts** by writing FHIR back, and is **accountable** - every step traceable
> inside the interoperability production. Triage Park is a team of these agents,
> with a deterministic safety floor so they can only ever escalate.

Two cuts are described:
- **Cut A - Flagship (target 5:00-6:00).** Agent thesis + full guided tour + under-the-hood. Lead with this.
- **Cut B - 3:00 highlight.** A tight subset (scene map at the end).

Everything shown is real and demoable on `docker compose up`. See the appendix "Aligning with the contest" for why each beat is chosen.

---

## 0. Pre-flight (before you record)

```bash
docker compose down -v
docker compose up --build      # ~90s; confirm the worklist shows seeded cases
```

Tabs to stage:
- **Tab 1** - Clinician console `http://localhost:8501/`
- **Tab 2** - Patient intake `http://localhost:8501/intake`
- **Tab 3** - Visual Trace (IRIS Portal -> Interoperability -> Visual Trace; `_SYSTEM` / `SYS`)
- **Tab 4** - Embedding Configurations (IRIS Portal -> System Administration -> Configuration -> Connectivity)

Hero data:
- **Marcus Reeves** (`demo-patient-1`) - 53, hypertension + hyperlipidemia + type 2 diabetes, on Lisinopril. Cardiac-risk-loaded, so the same complaint triages differently than for a healthy patient.
- **Chest tightness** for nuanced reasoning; **"my lips and tongue are swelling"** to trigger the deterministic safety agent (ACE-inhibitor -> angioedema -> ED).

Record 1920x1080, browser ~110% zoom, no bookmarks bar, cursor-highlight on. Pre-type long inputs and paste them; cut dead time during agent calls.

---

## PART A - The agent thesis + the stakes (0:00-1:15)

### Scene 1 - What is an AI agent for FHIR? (0:00-0:30) · SLIDES (S1, S0-loop)
**Visual:** Title card "AI Agents for FHIR." Then a single animated loop diagram (slide S0): **Perceive (read FHIR) -> Reason (tools) -> Act (write FHIR) -> Trace (in the production)**, with a small lock icon labeled "safety floor: escalate-only."
**On-screen text:** "Not a chatbot. An agent: perceive - reason - act - accountable."
**Voiceover:**
> "This contest asks for AI agents for FHIR. A real one isn't a chatbot. It perceives a patient's record, reasons over it with tools, acts by writing FHIR back, and stays accountable, every step traceable inside the interoperability production. Triage Park is built from a team of these agents, with deterministic safety checks underneath so they can only ever escalate."

### Scene 2 - Why it matters (0:30-1:15) · B-ROLL + SLIDE (three personas)
**Visual:** Brief b-roll (busy waiting room; clinician on a long chart at night); then slide S3, three columns: Patient · Clinician · Health system. A stat card: "rushed triage misses red flags; readmissions cost the US ~$17B/yr."
**Voiceover:**
> "And it points that capability at the most repetitive, most rushed, most error-prone minutes of care: the pre-checkup. For the patient, a chance to be heard, in their own language, before they are even seen. For the clinician, a safe, cited head start instead of a blank chart. For the health system, a view of risk and care gaps across the whole panel. A team of agents, running entirely inside InterSystems IRIS for Health."

---

## PART B - Guided product tour (1:05-4:40)

### Scene 3 - The patient experience: adaptive, multilingual intake (1:05-1:50) · DEMO (Tab 2)
**Action:**
1. Open `/intake`. On the setup screen, **show the language selector** - click **Español**, then **中文**, then back to **English** so the localisation is unmistakable.
2. Start. Type the complaint: *"My chest feels tight when I climb stairs."*
3. Show the agent choosing the **next** question (a 1-10 severity scale), then a symptom checklist. Narrate that it is adapting to the answers and to Marcus's record.
4. Finish; show the calm, plain-language "what to do next" screen.

**On-screen callouts:** "In the patient's language" · "Adaptive: the agent picks each question" · "Saved to FHIR"
**Voiceover:**
> "The patient answers a short interview on their own device, in their language. It is not a fixed form: the agent chooses each next question from what it has heard and the patient's record. Marcus is cardiac-risk-loaded, so it asks about exertion and radiating pain; a sore throat would stop in three questions. Every answer is written back to FHIR as a QuestionnaireResponse."
**Why it matters (let it land):** access and equity, and a patient who feels heard.

### Scene 4 - The clinician worklist (1:50-2:15) · DEMO (Tab 1)
**Action:**
1. Switch to the console. Land on the **Worklist**. Point out the **KPI cards** (Total, Acute, Need review, Acknowledged) and that cases are **ordered by acuity** with colour-coded levels.
2. Note the new case from Scene 3 sitting in the list.
**On-screen callouts:** "Caseload at a glance" · "Acuity-ordered"
**Voiceover:**
> "The clinician opens a worklist, not an inbox. Caseload KPIs up top, cases ordered by urgency, the riskiest first."

### Scene 5 - Inside a case: the full handoff (2:15-3:05) · DEMO (Tab 1, case detail)
Tour the case detail tab by tab, slowly enough to read.
**Action:**
1. Open Marcus's chest-tightness case. **Overview tab:** the colored triage pill, chief complaint, **Assessment** with **cited guidelines**, recommended actions. Hover the citations.
2. **Agents tab:** let the cards populate - **Readmission risk** (band + score + drivers), **Gaps in care** (and note it wrote FHIR Tasks), **Result follow-up**. Then click **Patient summary** and **Care plan** to show the on-demand agents producing output (care plan writes a CarePlan).
3. Scroll to **Agent reasoning**: the step timeline (Context -> Safety -> Red-flag gate -> Triage agent tool calls -> Reviewer). Pause here.
4. **Transcript tab:** the interview Q&A. **Right rail:** the patient record (colour-coded: conditions, meds, vitals, allergies) and the written-back FHIR resource IDs.
**On-screen callouts:** "Cited, grounded handoff" · "Six agents, one click" · "Every decision is explainable"
**Voiceover:**
> "Open a case and the whole picture is already assembled: a triage level, an assessment grounded in cited guidelines, and a toolbox of agents one click away. A readmission-risk score with its drivers. Preventive-care gaps, written back as FHIR tasks. A draft care plan. And critically, a reasoning trail: exactly which agents ran and why. Nothing here is a black box."

### Scene 6 - The safety moment (3:05-3:35) · DEMO (Tab 2 or console)
This is the emotional peak. Give it room.
**Action:**
1. Start a fresh intake for Marcus and enter *"my lips and tongue are swelling."* (Or show it pre-recorded for speed.)
2. Result: escalated to **ED**, an orange **Medication / allergy interactions** banner naming **ACE-inhibitor angioedema**, and a `DetectedIssue` written to FHIR.
**On-screen callouts:** "Deterministic. No LLM." · "Can only escalate, never downgrade" · "Caught before the model even ran"
**Voiceover (slow):**
> "Here is the difference that matters. Marcus is on an ACE inhibitor and reports facial swelling. Before any language model runs, a deterministic safety agent recognises possible angioedema and escalates him to the emergency department. Three safety layers sit under every triage, and each one can only raise urgency, never lower it. Patient safety never rests on the model getting it right."
**Editing:** subtle zoom + a soft chime when the ED pill appears.

### Scene 7 - The platform view (3:35-4:15) · DEMO (Tab 1 nav)
**Action:**
1. **Cohort:** the analytics view - risk **donut**, **care gaps grouped by type** (bar chart: e.g. colorectal screening, influenza), most common conditions, KPIs.
2. **Explore:** type *"patients with diabetes"*; show the translated `GET /Condition?clinical-status=active`, the "filter where name contains 'diabetes'" line, and the results.
3. **Assistant:** type *"Summarize this patient, check readmission risk, and flag care gaps."* Show the synthesized answer and the **agent-chain chips** (summary -> risk -> gaps).
**On-screen callouts:** "Population analytics" · "Natural language to validated FHIR" · "One request, routed and chained across agents"
**Voiceover:**
> "Step back and it is a platform. A cohort view turns the panel into population analytics: where the risk is, which care gaps recur. An Explore view answers plain-language questions as validated, read-only FHIR queries. And an assistant routes one request across the right agents, chaining several when the question needs it."

### Scene 8 - Under the hood (4:15-4:40) · DEMO (Tab 3/4) + SLIDE
**Action:** Visual Trace showing a triage as `Ens.MessageHeader` (REST inbox -> triage agent -> `Ens.AlertRequest`). Quick cut to Embedding Configurations (AI Hub). Optional: a one-line `pytest` green.
**On-screen callouts:** "A real Interoperability production" · "Server-side embeddings + VECTOR_COSINE" · "IntegratedML risk model" · "Safety logic is unit-tested"
**Voiceover:**
> "And this is the agent loop from the opening, made literal. Perceive: the agents read the FHIR record. Reason: a tool-using loop over vector-searched guidelines and an IntegratedML risk model. Act: they write FHIR back. Accountable: every triage is a traceable message in the Interoperability production. None of it is bolted on, and the safety logic is covered by tests."

---

## PART C - Close (4:40-5:15) · SLIDES

### Scene 9 - Recap for each persona + CTA
**Visual:** Slide S8 (three personas, one line each), then title card with the vote link + demo URL.
**On-screen text:** "Patients heard, in their language." · "Clinicians given a safe head start." · "Health systems given a population view." · then "Vote: InterSystems AI Agents for FHIR."
**Voiceover:**
> "Triage Park: patients heard in their own language, clinicians handed a safe, cited head start, and health systems given a view across the whole panel - a multi-agent clinical platform on IRIS, with a safety floor that can only escalate. Thanks for watching, and for your vote."

---

## Slide deck (non-demo frames)

Minimal, one idea per slide, large type.
- **S0 The agent loop.** One diagram: **Perceive (read FHIR) -> Reason (tools) -> Act (write FHIR) -> Trace (in the production)**, with an escalate-only "safety floor" lock. This is the thesis slide; it recurs as a motif (and returns in Scene 8).
- **S1 Title.** "Triage Park" + "A multi-agent clinical platform on IRIS." Authors, contest.
- **S2 Stakes.** Three stats: repetitive manual triage · missed red flags · ~$17B/yr readmissions.
- **S3 Who it's for.** Patient · Clinician · Health system, one promise each.
- **S4 Architecture.** Three-service diagram; animate the triage message path through the production.
- **S5 The platform.** A grid labelled by kind: **agents** (orchestrator, triage reasoner, intake, copilot), **deterministic checks** (red-flag gate, safety, gaps, follow-up), and **LLM skills** (summary, labs, care plan, NL→FHIR query), plus the IntegratedML risk model. Caption: "Deterministic where safety matters, agentic where judgment matters."
- **S6 The safety guarantee.** Layered diagram with "can only escalate, never downgrade." Linger.
- **S7 InterSystems features.** Checklist mapping to the technology bonuses: FHIR R4 (8 resources written) · Interoperability + Visual Trace · Vector Search · AI Hub · IntegratedML · Docker · IPM.
- **S8 Recap + CTA.** Three personas, vote link, demo URL.

---

## Shot list (Cut A)

| # | Time | Source | Beat | On-screen text |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | b-roll/slides | Stakes | "Rushing triage is how red flags get missed" |
| 2 | 0:30 | slide | Three personas | Patient · Clinician · System |
| 3 | 1:05 | /intake | Multilingual adaptive intake | "In the patient's language · adaptive" |
| 4 | 1:50 | console | Worklist + KPIs | "Caseload at a glance" |
| 5 | 2:15 | case detail | Tabs tour + reasoning trail | "Cited · multi-agent · explainable" |
| 6 | 3:05 | intake/console | Angioedema -> ED | "Deterministic · can only escalate" |
| 7 | 3:35 | nav | Cohort · Explore · Assistant | "Analytics · NL->FHIR · orchestration" |
| 8 | 4:15 | Visual Trace | Interop + AI Hub + ML | "Real production · standards-based" |
| 9 | 4:40 | slides | Recap + CTA | Vote link |

---

## Cut B - 3:00 highlight (scene map)

Keep: Scene 1 (0:20, trimmed) · Scene 3 intake (0:30) · Scene 5 case detail (0:40) · Scene 6 safety (0:30) · Scene 7 platform (0:40) · Scene 9 close (0:20). Drop Scenes 2, 4, 8 (fold their one-liners into voiceover).

---

## Recording & editing notes

- **Lead with the agent idea, then the people.** First 15 seconds: name what an AI agent for FHIR is (perceive/reason/act/accountable). Then make a non-engineer care about the stakes. Architecture is the payoff at the end, not the pitch.
- **Use precise language.** Call the tool-using, deciding components "agents" (orchestrator, triage reasoner, intake, copilot); call the rule-based pieces "checks." Don't blur them - the determinism of the safety checks is a selling point, not something to dress up as an agent.
- **The safety moment is the peak** - it is the one thing the field does not have. Slow down, zoom, chime.
- **Burn in captions;** many judges watch muted first.
- **Pace the demo:** paste pre-typed inputs, cut the few-second agent waits.
- **Show, then say:** let an action complete on screen before the voiceover explains it.
- **Thumbnail:** the case detail with the red ED pill + the Agent reasoning timeline visible - it reads as serious clinical AI.
- **Music:** low, neutral, ducked under voiceover.

## Optional deep-dive add-ons (for the 2nd/3rd YouTube bonus)

- Walk the LangGraph node diagram and map each node to a Visual Trace message.
- Show the reason loop actually calling `search_guidelines` / `get_observations` in the agent logs.
- Open a written `ServiceRequest` in the FHIR explorer and show the persisted narrative + parsed-back reasoning trail.
- Flip `CP_ENABLE_ML=1` on x86 and show the IntegratedML model training and serving real predictions.
- Toggle `CP_LLM_PROVIDER=anthropic` or the `ollama` profile to show provider-agnosticism.

---

## Appendix - Aligning with the contest (why these beats)

We can't see vote counts or the jury rubric, so this is deduced from two things we *can* read: the contest brief, and the pattern in past InterSystems winners. Treat it as informed inference, not certainty.

**What the brief literally asks for: "an AI agent called in an interoperability FHIR solution."** That single phrase drives the structure:
- We open by *defining* the agent (perceive/reason/act/accountable) so the judge immediately maps the video to the brief.
- Scene 8 shows the agent **inside the Interoperability production** in Visual Trace, because "called in an interoperability FHIR solution" is the exact requirement, and it's the thing a chatbot-style entry cannot show.
- We show FHIR **reads and writes** (8 resource types), not just reads, because "for FHIR" implies acting on the record.

**What past InterSystems winners suggest judges reward** (e.g. the AI-contest grand prize `fhir-integratedml-example`, and broad Grand-Prix winners): deep, native use of the platform's own capabilities, and a clean, working demo. So the video deliberately surfaces **Vector Search, AI Hub embeddings, IntegratedML, Interoperability, and IPM** (the technology-bonus list) as first-class beats, and every beat is a real action on `docker compose up`, never a mockup.

**Where we differentiate within that frame:** the brief asks for *an* agent; we show a *coordinated team* with an orchestrator, and a **deterministic, escalate-only safety floor** no chatbot entry has. That's the part to linger on (Scene 6), because it's both on-brief (a safe agent acting on real records) and unique.

**Honest caveat:** breadth and polish from established entrants are real. The video can't out-reputation them; it can make the *agent story* and the *safety guarantee* impossible to miss, which is the strongest hand we hold.
