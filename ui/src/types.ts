// Mirrors the agent's HandoffResponse (src/python/central_park/main.py:63-73)
// and the citation shape from tools/vector.py.

export type TriageLevel = "self-care" | "see-gp" | "urgent-care" | "ed";

export interface Citation {
  source?: string;
  slug?: string;
  snippet?: string;
  score?: number;
}

export interface Handoff {
  triage_level: TriageLevel | string | null;
  chief_complaint: string | null;
  hpi: string | null;
  red_flags: string[];
  recommended_actions: string[];
  citations: Citation[];
  questionnaire_response_id: string | null;
  encounter_id?: string | null;
  service_request_id?: string | null;
  observation_ids?: string[];
}

// One answered intake question, ready to become a QuestionnaireResponse.item.
export interface QA {
  link_id: string;
  question: string;
  answer: string;
}

// A question proposed by the adaptive-interview agent (/api/interview/next).
// snake_case mirrors the backend (central_park/interview.py:_normalize_question);
// data/questions.ts:toQuestion converts it to the camelCase Question the
// interview UI renders.
export interface DynamicQuestion {
  link_id: string;
  kind: "text" | "scale" | "choices";
  short: string;
  prompt: string;
  help?: string | null;
  placeholder?: string | null;
  min?: number;
  max?: number;
  min_label?: string;
  max_label?: string;
  options?: string[];
  none_option?: string;
}

export interface NextQuestionResult {
  done: boolean;
  question: DynamicQuestion | null;
}

// Outputs of the per-patient agents surfaced in the clinician console.
export interface RiskAssessment {
  band: "low" | "moderate" | "high" | string;
  score: number;
  probability: number;
  method: "integratedml" | "heuristic" | string;
  drivers: string[];
  features: { age: number; comorbid: number; severity: number };
}

export interface CareGap {
  code: string;
  title: string;
  detail: string;
  priority: string;
}

export interface GapsResult {
  gaps: CareGap[];
  task_ids: string[];
}

export interface PatientSummary {
  headline: string;
  summary: string;
  key_problems: string[];
  active_medications: string[];
  cautions: string[];
  audience: string;
}

export interface LabExplanation {
  name: string;
  value: string;
  plain: string;
}

export interface LabsResult {
  explanations: LabExplanation[];
  overall: string;
}

export interface CohortResult {
  aggregates: {
    total: number;
    high: number;
    moderate: number;
    low: number;
    open_gaps: number;
    avg_score: number;
  };
  risk_distribution: { band: string; count: number }[];
  gaps_by_type: { title: string; count: number }[];
  top_conditions: { display: string; count: number }[];
  highest_risk: { patient_id: string; name: string; risk_band: string; risk_score: number }[];
}

export interface QueryResult {
  resource_type: string;
  params: Record<string, string>;
  contains?: string;
  resolve_to?: string;
  explanation: string;
  total: number;
  results: { id: string; type: string; display: string }[];
  error?: string;
}

export interface CarePlanResult {
  title: string;
  activities: string[];
  care_plan_id: string;
}

export interface FollowupResult {
  findings: { observation: string; value: string; concern: string; priority: string }[];
  task_ids: string[];
}

export interface OrchestrateResult {
  answer: string;
  steps: { agent: string; args: Record<string, unknown>; result: unknown }[];
}

// One row in the clinician worklist, derived from a FHIR ServiceRequest
// (each triage interview writes one) plus its linked Patient.
export interface TriageQueueItem {
  service_request_id: string;
  encounter_id: string | null;
  patient_id: string;
  patient_name: string;
  triage_level: TriageLevel | string;
  chief_complaint: string;
  referral: string;
  authored_on: string | null;
  escalated: boolean;
  // ISO timestamp set when a clinician acknowledges an escalated case, parsed
  // back from a ServiceRequest.note sentinel; null until acknowledged.
  acknowledged_at: string | null;
}

// The patient's standing clinical record, read live from FHIR for the
// case-detail view (Patient + active Conditions/Medications, recent
// Observations, AllergyIntolerances). Mirrors the agent's get_patient_context.
export interface RecordEntry {
  display: string;
  detail?: string;
}
export interface PatientRecord {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  conditions: RecordEntry[];
  medications: RecordEntry[];
  vitals: RecordEntry[];
  allergies: RecordEntry[];
}

// The triage outcome reconstructed from a stored ServiceRequest — the agent's
// narrative is parsed back out of the resource's note annotations (written by
// tools/fhir.py:_handoff_notes), so a past case is fully reviewable.
export interface DetectedInteraction {
  severity: string;
  detail: string;
}

export interface CaseOutcome {
  triage_level: TriageLevel | string;
  chief_complaint: string;
  hpi: string;
  recommended_actions: string[];
  red_flags: string[];
  citations: Citation[];
  // Safety-agent findings and the multi-agent reasoning trail, parsed back from
  // the ServiceRequest notes the agent wrote (tools/fhir.py:_handoff_notes).
  detected_issues: DetectedInteraction[];
  trace: string[];
  verifier_note: string;
  qr_id: string | null;
  authored_on: string | null;
  acknowledged_at: string | null;
}
