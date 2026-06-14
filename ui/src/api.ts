import type {
  CarePlanResult,
  CaseOutcome,
  Citation,
  CohortResult,
  FollowupResult,
  GapsResult,
  Handoff,
  LabsResult,
  NextQuestionResult,
  PatientRecord,
  PatientSummary,
  QA,
  QueryResult,
  RecordEntry,
  RiskAssessment,
  TriageLevel,
  TriageQueueItem,
} from "@/types";

// Same-origin routes. nginx (prod) and the vite dev proxy both map:
//   /fhir/*  -> IRIS FHIR R4 endpoint (with server-side Basic auth injected)
//   /api/*   -> the triage agent FastAPI
const FHIR_BASE = "/fhir";
const AGENT_BASE = "/api";

export type ApiErrorKind =
  | "fhir-unreachable"
  | "fhir-http"
  | "fhir-no-id"
  | "agent-unreachable"
  | "agent-http";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  detail?: string;

  constructor(kind: ApiErrorKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

// IRIS returns 201 with an empty body; the new id lives in the Location
// header (often relative). Pull the segment after "QuestionnaireResponse".
function idFromLocation(location: string | null): string {
  if (!location) return "";
  const parts = location.split("/").filter(Boolean);
  const idx = parts.indexOf("QuestionnaireResponse");
  if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1];
  return "";
}

export async function createQuestionnaireResponse(
  patientId: string,
  qa: QA[],
): Promise<string> {
  const payload = {
    resourceType: "QuestionnaireResponse",
    questionnaire: "Questionnaire/triage-intake",
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    authored: new Date().toISOString(),
    item: qa.map((item) => ({
      linkId: item.link_id,
      text: item.question,
      answer: [{ valueString: item.answer }],
    })),
  };

  let resp: Response;
  try {
    resp = await fetch(`${FHIR_BASE}/QuestionnaireResponse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError("fhir-unreachable", "Cannot reach the FHIR server.");
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("fhir-http", "FHIR rejected the interview.", resp.status, detail);
  }

  // Prefer the response body id; fall back to the Location header.
  let id = "";
  const body = await resp.text().catch(() => "");
  if (body) {
    try {
      id = (JSON.parse(body) as { id?: string }).id ?? "";
    } catch {
      /* empty/non-JSON body is expected from IRIS */
    }
  }
  if (!id) {
    id =
      idFromLocation(resp.headers.get("Location")) ||
      idFromLocation(resp.headers.get("Content-Location"));
  }
  if (!id) {
    throw new ApiError(
      "fhir-no-id",
      "FHIR accepted the interview but returned no resource id.",
    );
  }
  return id;
}

// Adaptive intake: ask the agent for the next question given the answers so
// far. The caller falls back to the fixed question set if this throws, so the
// interview is never blocked by the agent being unreachable.
export async function fetchNextQuestion(
  patientId: string,
  answers: QA[],
): Promise<NextQuestionResult> {
  let resp: Response;
  try {
    resp = await fetch(`${AGENT_BASE}/interview/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: patientId, answers }),
    });
  } catch {
    throw new ApiError("agent-unreachable", "Cannot reach the triage agent.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("agent-http", "The triage agent returned an error.", resp.status, detail);
  }
  return (await resp.json()) as NextQuestionResult;
}

// Shared POST to an agent endpoint that takes { patient_id } and returns JSON.
async function agentPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${AGENT_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("agent-unreachable", "Cannot reach the triage agent.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("agent-http", "The agent returned an error.", resp.status, detail);
  }
  return (await resp.json()) as T;
}

export const fetchRiskAssessment = (patientId: string) =>
  agentPost<RiskAssessment>("/risk", { patient_id: patientId });

export const fetchCareGaps = (patientId: string) =>
  agentPost<GapsResult>("/gaps", { patient_id: patientId });

export const fetchPatientSummary = (patientId: string, audience = "clinician") =>
  agentPost<PatientSummary>("/summary", { patient_id: patientId, audience });

export const explainLabs = (patientId: string) =>
  agentPost<LabsResult>("/labs", { patient_id: patientId });

export const draftCarePlan = (patientId: string) =>
  agentPost<CarePlanResult>("/careplan", { patient_id: patientId });

export const runFollowup = (patientId: string) =>
  agentPost<FollowupResult>("/followup", { patient_id: patientId });

export const runNlQuery = (question: string) =>
  agentPost<QueryResult>("/query", { question });

export async function fetchCohort(): Promise<CohortResult> {
  let resp: Response;
  try {
    resp = await fetch(`${AGENT_BASE}/cohort`);
  } catch {
    throw new ApiError("agent-unreachable", "Cannot reach the triage agent.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("agent-http", "The cohort agent returned an error.", resp.status, detail);
  }
  return (await resp.json()) as CohortResult;
}

// Clinician copilot: ask a read-only, grounded question about one patient.
export async function askCopilot(
  patientId: string,
  question: string,
): Promise<{ answer: string; citations: Citation[] }> {
  let resp: Response;
  try {
    resp = await fetch(`${AGENT_BASE}/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: patientId, question }),
    });
  } catch {
    throw new ApiError("agent-unreachable", "Cannot reach the triage agent.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("agent-http", "The copilot returned an error.", resp.status, detail);
  }
  return (await resp.json()) as { answer: string; citations: Citation[] };
}

export async function runInterview(
  patientId: string,
  questionnaireResponseId: string,
): Promise<Handoff> {
  let resp: Response;
  try {
    resp = await fetch(`${AGENT_BASE}/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: patientId,
        questionnaire_response_id: questionnaireResponseId,
      }),
    });
  } catch {
    throw new ApiError("agent-unreachable", "Cannot reach the triage agent.");
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("agent-http", "The triage agent returned an error.", resp.status, detail);
  }
  return (await resp.json()) as Handoff;
}

// Reverse of the SNOMED codes the agent stamps onto each ServiceRequest
// (src/python/central_park/tools/fhir.py:_TRIAGE_LEVEL_SR). The code is the
// authoritative triage level; priority alone can't separate self-care/see-gp.
const SR_CODE_TO_LEVEL: Record<string, TriageLevel> = {
  "243958005": "self-care",
  "306206005": "see-gp",
  "310861008": "urgent-care",
  "182813001": "ed",
};

function patientName(p: Record<string, unknown>): string {
  const names = (p.name as Array<Record<string, unknown>>) ?? [];
  for (const n of names) {
    const family = n.family as string | undefined;
    if (family) {
      const given = ((n.given as string[]) ?? []).join(" ");
      return `${given} ${family}`.trim();
    }
  }
  return "";
}

function refId(reference: string | undefined, type: string): string | null {
  if (!reference) return null;
  const parts = reference.split("/").filter(Boolean);
  const idx = parts.indexOf(type);
  return idx >= 0 && idx + 1 < parts.length ? parts[idx + 1] : null;
}

// Every triage interview writes a ServiceRequest carrying the triage level
// (SNOMED code), chief complaint (reasonCode), timestamp, and patient ref.
// We _include the subject Patient to resolve display names in one round-trip,
// then sort newest-first client-side (avoids depending on FHIR _sort support).
export async function fetchTriageQueue(): Promise<TriageQueueItem[]> {
  let resp: Response;
  try {
    resp = await fetch(
      `${FHIR_BASE}/ServiceRequest?_count=50&_include=ServiceRequest:subject`,
      { headers: { Accept: "application/fhir+json" } },
    );
  } catch {
    throw new ApiError("fhir-unreachable", "Cannot reach the FHIR server.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("fhir-http", "FHIR rejected the queue query.", resp.status, detail);
  }

  const bundle = (await resp.json()) as {
    entry?: Array<{ resource?: Record<string, any> }>;
  };
  const entries = (bundle.entry ?? []).map((e) => e.resource).filter(Boolean) as Record<
    string,
    any
  >[];

  const patients = new Map<string, string>();
  for (const r of entries) {
    if (r.resourceType === "Patient" && r.id) patients.set(r.id, patientName(r));
  }

  const items: TriageQueueItem[] = entries
    .filter((r) => r.resourceType === "ServiceRequest")
    .map((sr) => {
      const code = (sr.code?.coding?.[0]?.code as string) ?? "";
      const level = SR_CODE_TO_LEVEL[code] ?? "see-gp";
      const patientId = refId(sr.subject?.reference, "Patient") ?? "";
      const ackNote = ((sr.note as Record<string, any>[]) ?? []).find((n) =>
        ((n.text as string) ?? "").startsWith("Acknowledged: "),
      );
      return {
        service_request_id: (sr.id as string) ?? "",
        encounter_id: refId(sr.encounter?.reference, "Encounter"),
        patient_id: patientId,
        patient_name: patients.get(patientId) || patientId,
        triage_level: level,
        chief_complaint: (sr.reasonCode?.[0]?.text as string) ?? "",
        referral: (sr.code?.text as string) ?? "",
        authored_on: (sr.authoredOn as string) ?? null,
        escalated: level === "urgent-care" || level === "ed",
        acknowledged_at: ackNote ? (ackNote.text as string).slice(14) : null,
      };
    });

  items.sort((a, b) => (b.authored_on ?? "").localeCompare(a.authored_on ?? ""));
  return items.slice(0, 25);
}

// --- case detail ------------------------------------------------------------

async function fhirGet(path: string): Promise<Record<string, any>> {
  let resp: Response;
  try {
    resp = await fetch(`${FHIR_BASE}${path}`, {
      headers: { Accept: "application/fhir+json" },
    });
  } catch {
    throw new ApiError("fhir-unreachable", "Cannot reach the FHIR server.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("fhir-http", "FHIR returned an error.", resp.status, detail);
  }
  return (await resp.json()) as Record<string, any>;
}

// Best-effort GET: a missing resource (e.g. a Patient never seeded) or an
// unsupported search param must not sink the whole view. Mirrors the agent's
// per-query is_success guards in get_patient_context.
async function fhirGetSoft(path: string): Promise<Record<string, any>> {
  try {
    const resp = await fetch(`${FHIR_BASE}${path}`, {
      headers: { Accept: "application/fhir+json" },
    });
    if (!resp.ok) return {};
    return (await resp.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

function codingDisplay(c: Record<string, any> | undefined): string {
  if (!c) return "";
  if (c.text) return c.text as string;
  for (const coding of (c.coding as Record<string, any>[]) ?? []) {
    if (coding.display) return coding.display as string;
  }
  return "";
}

function ageFromBirthDate(birthDate: string | undefined): number | null {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

function bundleResources(bundle: Record<string, any>): Record<string, any>[] {
  return ((bundle.entry as { resource?: Record<string, any> }[]) ?? [])
    .map((e) => e.resource)
    .filter(Boolean) as Record<string, any>[];
}

function observationValue(o: Record<string, any>): string {
  if (o.valueQuantity) {
    const { value, unit } = o.valueQuantity;
    return `${value ?? ""} ${unit ?? ""}`.trim();
  }
  if (o.component) {
    return (o.component as Record<string, any>[])
      .map((c) => {
        const vq = c.valueQuantity ?? {};
        return `${codingDisplay(c.code)} ${vq.value ?? ""} ${vq.unit ?? ""}`.trim();
      })
      .filter(Boolean)
      .join(", ");
  }
  if (o.valueInteger !== undefined) return String(o.valueInteger);
  if (o.valueString) return o.valueString as string;
  return "";
}

function isSurvey(o: Record<string, any>): boolean {
  for (const cat of (o.category as Record<string, any>[]) ?? []) {
    for (const coding of (cat.coding as Record<string, any>[]) ?? []) {
      if (coding.code === "survey") return true;
    }
  }
  return false;
}

// The patient's standing clinical record — one FHIR fan-out mirroring the
// agent's get_patient_context, shaped for display. Survey-category Observations
// (this triage's own severity/symptom flags) are excluded so the record shows
// only the patient's baseline clinical picture.
export async function fetchPatientRecord(patientId: string): Promise<PatientRecord> {
  const [patient, conditions, meds, obs, allergies] = await Promise.all([
    fhirGetSoft(`/Patient/${patientId}`),
    fhirGetSoft(`/Condition?patient=${patientId}&clinical-status=active`),
    fhirGetSoft(`/MedicationRequest?patient=${patientId}&status=active`),
    fhirGetSoft(`/Observation?patient=${patientId}&_sort=-date&_count=20`),
    fhirGetSoft(`/AllergyIntolerance?patient=${patientId}`),
  ]);

  const vitals: RecordEntry[] = bundleResources(obs)
    .filter((o) => !isSurvey(o))
    .map((o) => ({ display: codingDisplay(o.code), detail: observationValue(o) }))
    .filter((v) => v.display);

  // De-duplicate vitals by display, keeping the most recent (already -date sorted).
  const seen = new Set<string>();
  const dedupedVitals = vitals.filter((v) => {
    if (seen.has(v.display)) return false;
    seen.add(v.display);
    return true;
  });

  return {
    id: patientId,
    name: patientName(patient),
    age: ageFromBirthDate(patient.birthDate as string | undefined),
    gender: (patient.gender as string) ?? null,
    conditions: bundleResources(conditions)
      .map((c) => ({ display: codingDisplay(c.code) }))
      .filter((c) => c.display),
    medications: bundleResources(meds)
      .map((m) => ({
        display: codingDisplay(m.medicationCodeableConcept),
        detail: ((m.dosageInstruction as Record<string, any>[]) ?? [{}])[0]?.text,
      }))
      .filter((m) => m.display),
    vitals: dedupedVitals.slice(0, 6),
    allergies: bundleResources(allergies)
      .map((a) => ({
        display: codingDisplay(a.code),
        detail: [a.criticality, ...((a.reaction as Record<string, any>[]) ?? [])
          .flatMap((r) => (r.manifestation as Record<string, any>[]) ?? [])
          .map((mn) => codingDisplay(mn))]
          .filter(Boolean)
          .join(" · "),
      }))
      .filter((a) => a.display),
  };
}

export async function fetchTranscript(qrId: string): Promise<QA[]> {
  const qr = await fhirGet(`/QuestionnaireResponse/${qrId}`);
  return ((qr.item as Record<string, any>[]) ?? []).map((item) => {
    const answers = (item.answer as Record<string, any>[]) ?? [];
    return {
      link_id: (item.linkId as string) ?? "",
      question: (item.text as string) ?? "",
      answer: answers[0]?.valueString ?? "",
    };
  });
}

// Reconstruct the triage outcome from a single ServiceRequest, parsing the
// agent's narrative back out of the note annotations
// (tools/fhir.py:_handoff_notes).
function parseHandoffNotes(notes: Record<string, any>[]): {
  hpi: string;
  recommended_actions: string[];
  red_flags: string[];
  citations: Citation[];
  detected_issues: { severity: string; detail: string }[];
  trace: string[];
  verifier_note: string;
  qr_id: string | null;
  acknowledged_at: string | null;
} {
  let hpi = "";
  let qr_id: string | null = null;
  let acknowledged_at: string | null = null;
  let verifier_note = "";
  const recommended_actions: string[] = [];
  const red_flags: string[] = [];
  const citations: Citation[] = [];
  const detected_issues: { severity: string; detail: string }[] = [];
  const trace: string[] = [];

  for (const note of notes) {
    const text = (note.text as string) ?? "";
    if (text.startsWith("HPI: ")) hpi = text.slice(5);
    else if (text.startsWith("Action: ")) recommended_actions.push(text.slice(8));
    else if (text.startsWith("Red flag: ")) red_flags.push(text.slice(10));
    else if (text.startsWith("QR: ")) qr_id = text.slice(4);
    else if (text.startsWith("Acknowledged: ")) acknowledged_at = text.slice(14);
    else if (text.startsWith("Trace: ")) trace.push(text.slice(7));
    else if (text.startsWith("Verifier: ")) verifier_note = text.slice(10);
    else if (text.startsWith("Interaction: ")) {
      const rest = text.slice(13);
      const sep = rest.indexOf("|");
      if (sep >= 0) detected_issues.push({ severity: rest.slice(0, sep), detail: rest.slice(sep + 1) });
    } else if (text.startsWith("Guideline: ")) {
      const rest = text.slice(11);
      const sep = rest.indexOf("|");
      if (sep >= 0) {
        citations.push({
          source: rest.slice(0, sep),
          snippet: rest.slice(sep + 1),
        });
      }
    }
  }
  return {
    hpi,
    recommended_actions,
    red_flags,
    citations,
    detected_issues,
    trace,
    verifier_note,
    qr_id,
    acknowledged_at,
  };
}

export async function fetchCaseOutcome(serviceRequestId: string): Promise<CaseOutcome> {
  const sr = await fhirGet(`/ServiceRequest/${serviceRequestId}`);
  const code = (sr.code?.coding?.[0]?.code as string) ?? "";
  const parsed = parseHandoffNotes((sr.note as Record<string, any>[]) ?? []);
  return {
    triage_level: SR_CODE_TO_LEVEL[code] ?? "see-gp",
    chief_complaint: (sr.reasonCode?.[0]?.text as string) ?? "",
    authored_on: (sr.authoredOn as string) ?? null,
    ...parsed,
  };
}

// Record a clinician acknowledgement on an escalated case. Read-modify-write:
// IRIS FHIR has no "acknowledged" status on ServiceRequest, so we append a
// sentinel note (parsed back by parseHandoffNotes / fetchTriageQueue). Returns
// the acknowledgement timestamp.
export async function acknowledgeCase(serviceRequestId: string): Promise<string> {
  const sr = await fhirGet(`/ServiceRequest/${serviceRequestId}`);
  const at = new Date().toISOString();
  sr.note = [...((sr.note as Record<string, any>[]) ?? []), { text: `Acknowledged: ${at}` }];

  let resp: Response;
  try {
    resp = await fetch(`${FHIR_BASE}/ServiceRequest/${serviceRequestId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(sr),
    });
  } catch {
    throw new ApiError("fhir-unreachable", "Cannot reach the FHIR server.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("fhir-http", "Could not save the acknowledgement.", resp.status, detail);
  }
  return at;
}
