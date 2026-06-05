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
