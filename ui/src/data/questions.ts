import type { TriageLevel } from "@/types";

// The intake interview the patient answers themselves, on their own device.
// First-person, plain language. linkIds mirror the seeded FHIR Questionnaire
// (src/python/central_park/seed_module.py); the agent reads the answers back
// and codes severity + symptoms into Observations, so the scale and the
// checklist options must keep the keywords the backend looks for
// (src/python/central_park/tools/fhir.py:_SYMPTOM_CODES).

export type QuestionKind = "text" | "scale" | "choices";

interface BaseQuestion {
  linkId: string;
  short: string;
  prompt: string;
  help?: string;
}

export interface TextQuestion extends BaseQuestion {
  kind: "text";
  placeholder?: string;
}
export interface ScaleQuestion extends BaseQuestion {
  kind: "scale";
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
}
export interface ChoicesQuestion extends BaseQuestion {
  kind: "choices";
  options: string[];
  noneOption: string;
}

export type Question = TextQuestion | ScaleQuestion | ChoicesQuestion;

export const QUESTIONS: readonly Question[] = [
  {
    kind: "text",
    linkId: "chief-complaint",
    short: "Main concern",
    prompt: "What's bothering you today?",
    help: "Describe what you're feeling, in your own words.",
    placeholder: "e.g. My chest feels tight when I walk upstairs",
  },
  {
    kind: "text",
    linkId: "onset",
    short: "When it started",
    prompt: "When did it start, and how has it changed?",
    help: "For example: two days ago, and it's been getting worse.",
    placeholder: "e.g. Started yesterday, getting worse",
  },
  {
    kind: "scale",
    linkId: "severity",
    short: "How bad",
    prompt: "How bad is it right now?",
    min: 1,
    max: 10,
    minLabel: "Barely noticeable",
    maxLabel: "Worst imaginable",
  },
  {
    kind: "choices",
    linkId: "associated-symptoms",
    short: "Other symptoms",
    prompt: "Are you noticing any of these as well?",
    help: "Select all that apply.",
    options: [
      "Shortness of breath",
      "Chest tightness",
      "Chest pain",
      "Fever",
      "Nausea",
      "Dizziness",
      "Weakness on one side",
    ],
    noneOption: "None of these",
  },
  {
    kind: "text",
    linkId: "history",
    short: "Past history",
    prompt: "Has this happened before, or any recent illness or injury?",
    help: "Include anything from the last few weeks.",
    placeholder: "e.g. Had something similar last year",
  },
  {
    kind: "text",
    linkId: "self-treatment",
    short: "What you've tried",
    prompt: "Have you tried anything for it yet?",
    help: "Medicines, rest, home remedies — anything at all.",
    placeholder: "e.g. Took paracetamol, didn't help",
  },
];

// Triage dispositions. Intentionally no pill/badge styling — severity reads
// from a colored accent bar + colored label, so the UI stays calm and clinical.
export interface LevelConfig {
  label: string;
  // Solid color for the vertical accent bar / small square swatch.
  accent: string;
  // Text color for the disposition label.
  text: string;
  // What this disposition means, in plain language for the patient.
  guidance: string;
}

export const LEVEL_CONFIG: Record<TriageLevel, LevelConfig> = {
  "self-care": {
    label: "Self-care",
    accent: "bg-emerald-500",
    text: "text-emerald-700",
    guidance: "You can manage this at home. Seek care if it gets worse.",
  },
  "see-gp": {
    label: "See a GP",
    accent: "bg-amber-500",
    text: "text-amber-700",
    guidance: "Book a routine appointment with your primary-care provider.",
  },
  "urgent-care": {
    label: "Urgent care",
    accent: "bg-orange-500",
    text: "text-orange-700",
    guidance: "Get seen today at an urgent-care clinic.",
  },
  ed: {
    label: "Emergency",
    accent: "bg-red-600",
    text: "text-red-700",
    guidance: "Go to the emergency department now, or call emergency services.",
  },
};

export function levelConfig(level: string | null | undefined): LevelConfig {
  const key = (level ?? "see-gp").toLowerCase() as TriageLevel;
  return (
    LEVEL_CONFIG[key] ?? {
      label: (level ?? "Unknown").toString(),
      accent: "bg-slate-400",
      text: "text-slate-700",
      guidance: "",
    }
  );
}
