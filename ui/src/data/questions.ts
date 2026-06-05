import type { TriageLevel } from "@/types";

// The 6 intake questions. Mirrors the seeded FHIR Questionnaire
// (src/python/central_park/seed_module.py) and the prior Streamlit UI.
export const QUESTIONS = [
  {
    linkId: "chief-complaint",
    short: "Chief concern",
    text: "What's your main concern today? Please describe what's been happening.",
  },
  {
    linkId: "onset",
    short: "Onset & course",
    text: "When did this start, and has it been getting better, worse, or staying the same?",
  },
  {
    linkId: "severity",
    short: "Severity",
    text: "On a scale of 1 to 10, how would you rate the severity right now?",
  },
  {
    linkId: "associated-symptoms",
    short: "Associated symptoms",
    text: "Are you experiencing any of the following: shortness of breath, chest tightness, fever, nausea, dizziness, or weakness on one side?",
  },
  {
    linkId: "history",
    short: "History",
    text: "Do you have any history of similar symptoms, or any recent illness, injury, or surgery?",
  },
  {
    linkId: "self-treatment",
    short: "Self-treatment",
    text: "Have you tried anything to manage this so far — any medications or home remedies?",
  },
] as const;

export interface LevelConfig {
  label: string;
  // Tailwind utility classes for the handoff badge + accent rail.
  badge: string;
  bar: string;
  blurb: string;
}

export const LEVEL_CONFIG: Record<TriageLevel, LevelConfig> = {
  "self-care": {
    label: "Self-care",
    badge: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    bar: "bg-emerald-500",
    blurb: "Manage at home; seek care if symptoms worsen.",
  },
  "see-gp": {
    label: "See GP",
    badge: "bg-amber-100 text-amber-900 border border-amber-200",
    bar: "bg-amber-500",
    blurb: "Book a routine appointment with a primary-care provider.",
  },
  "urgent-care": {
    label: "Urgent care",
    badge: "bg-orange-100 text-orange-900 border border-orange-300",
    bar: "bg-orange-500",
    blurb: "Seek same-day assessment at an urgent-care facility.",
  },
  ed: {
    label: "Go to ED",
    badge: "bg-red-100 text-red-800 border border-red-300",
    bar: "bg-red-600",
    blurb: "Go to the emergency department now or call emergency services.",
  },
};

export function levelConfig(level: string | null | undefined): LevelConfig {
  const key = (level ?? "see-gp").toLowerCase() as TriageLevel;
  return (
    LEVEL_CONFIG[key] ?? {
      label: (level ?? "Unknown").toString(),
      badge: "bg-slate-100 text-slate-700 border border-slate-200",
      bar: "bg-slate-400",
      blurb: "",
    }
  );
}
