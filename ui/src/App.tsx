import { useState } from "react";
import { Activity } from "lucide-react";
import { SetupScreen } from "@/components/SetupScreen";
import { InterviewScreen } from "@/components/InterviewScreen";
import { ProcessingScreen } from "@/components/ProcessingScreen";
import { HandoffScreen } from "@/components/HandoffScreen";
import { QUESTIONS } from "@/data/questions";
import { createQuestionnaireResponse, runInterview, ApiError } from "@/api";
import type { Handoff, QA } from "@/types";

type Phase = "setup" | "interview" | "processing" | "complete";
export type ProcessStep = "fhir" | "agent";

export default function App() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [patientId, setPatientId] = useState("demo-patient-1");
  const [answers, setAnswers] = useState<QA[]>([]);
  const [qrId, setQrId] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [step, setStep] = useState<ProcessStep>("fhir");
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  function startInterview(id: string) {
    setPatientId(id.trim() || "demo-patient-1");
    setAnswers([]);
    setError(null);
    setPhase("interview");
  }

  async function submitInterview(qa: QA[]) {
    setAnswers(qa);
    setError(null);
    setPhase("processing");

    try {
      setStep("fhir");
      const id = await createQuestionnaireResponse(patientId, qa);
      setQrId(id);

      setStep("agent");
      const result = await runInterview(patientId, id);
      setHandoff(result);
      setPhase("complete");
    } catch (err) {
      const e = err as ApiError;
      const detail =
        e.detail && e.detail.length ? e.detail.slice(0, 300) : e.status ? `HTTP ${e.status}` : undefined;
      setError({ title: e.message ?? "Something went wrong.", detail });
    }
  }

  function reset() {
    setAnswers([]);
    setQrId(null);
    setHandoff(null);
    setError(null);
    setPhase("setup");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-6 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Central Park</span>
          <span className="text-sm text-muted-foreground">· Triage</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {phase === "setup" && <SetupScreen onStart={startInterview} initialId={patientId} />}

        {phase === "interview" && (
          <InterviewScreen
            questions={QUESTIONS}
            onComplete={submitInterview}
            onCancel={reset}
          />
        )}

        {phase === "processing" && (
          <ProcessingScreen step={step} error={error} onRetry={() => submitInterview(answers)} onCancel={reset} />
        )}

        {phase === "complete" && handoff && (
          <HandoffScreen handoff={handoff} qrId={qrId} patientId={patientId} onReset={reset} />
        )}
      </main>
    </div>
  );
}
