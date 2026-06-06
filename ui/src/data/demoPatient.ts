// The single seeded demo patient (iris-config/seed/demo-patient-1.json).
// Surfaced on the setup screen so the FHIR grounding is visible.
export const DEMO_PATIENT = {
  id: "demo-patient-1",
  name: "Marcus Reeves",
  summary: "Male · 53 yrs",
  conditions: ["Essential hypertension", "Hyperlipidemia", "Type 2 diabetes"],
  medications: ["Lisinopril 20 mg", "Atorvastatin 40 mg", "Metformin 1000 mg"],
  vitals: ["BP 148/94", "HbA1c 7.8%", "BMI 31.2"],
  allergy: "Penicillin (anaphylaxis)",
} as const;
