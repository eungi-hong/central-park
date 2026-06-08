import { useState } from "react";
import { Activity } from "lucide-react";
import { SetupScreen } from "@/components/SetupScreen";
import { InterviewScreen } from "@/components/InterviewScreen";
import { ProcessingScreen } from "@/components/ProcessingScreen";
import { IntakeDoneScreen } from "@/components/IntakeDoneScreen";
import { QUESTIONS } from "@/data/questions";
import { createQuestionnaireResponse, runInterview, ApiError } from "@/api";
import type { ProcessStep } from "@/App";
import type { Handoff, QA } from "@/types";

type Phase = "setup" | "interview" | "processing" | "done";

// The patient self-intake at "/intake" — a link or waiting-room kiosk. No
// clinician chrome: the patient only ever answers questions and gets told what
// to do next. Their answers land in FHIR and surface in the clinician console.
export function PatientIntakeApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [patientId, setPatientId] = useState("demo-patient-1");
  const [answers, setAnswers] = useState<QA[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [step, setStep] = useState<ProcessStep>("fhir");
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  function startIntake(id: string) {
    setPatientId(id.trim() || "demo-patient-1");
    setAnswers([]);
    setError(null);
    setPhase("interview");
  }

  async function submit(qa: QA[]) {
    setAnswers(qa);
    setError(null);
    setPhase("processing");
    try {
      setStep("fhir");
      const id = await createQuestionnaireResponse(patientId, qa);
      setStep("agent");
      setHandoff(await runInterview(patientId, id));
      setPhase("done");
    } catch (err) {
      const e = err as ApiError;
      const detail =
        e.detail && e.detail.length ? e.detail.slice(0, 300) : e.status ? `HTTP ${e.status}` : undefined;
      setError({ title: e.message ?? "Something went wrong.", detail });
    }
  }

  function reset() {
    setAnswers([]);
    setHandoff(null);
    setError(null);
    setPhase("setup");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-6 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Triage Park</span>
          <span className="text-sm text-muted-foreground">· Patient intake</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {phase === "setup" && <SetupScreen initialId={patientId} onStart={startIntake} />}

        {phase === "interview" && (
          <InterviewScreen questions={QUESTIONS} onComplete={submit} onCancel={reset} />
        )}

        {phase === "processing" && (
          <ProcessingScreen step={step} error={error} onRetry={() => submit(answers)} onCancel={reset} />
        )}

        {phase === "done" && handoff && <IntakeDoneScreen handoff={handoff} onDone={reset} />}
      </main>
    </div>
  );
}
