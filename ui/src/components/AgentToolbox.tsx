import { useEffect, useState } from "react";
import {
  ClipboardCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  Loader2,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  draftCarePlan,
  explainLabs,
  fetchCareGaps,
  fetchPatientSummary,
  fetchRiskAssessment,
  runFollowup,
  ApiError,
} from "@/api";
import { cn } from "@/lib/utils";
import type {
  CarePlanResult,
  FollowupResult,
  GapsResult,
  LabsResult,
  PatientSummary,
  RiskAssessment,
} from "@/types";

// The per-patient agent suite, surfaced in the clinician console as a row of
// reviewable cards (the Heidi/FHIR-Agent-Studio pattern). Cheap deterministic
// agents (risk, gaps) run on open; LLM agents (summary, labs) run on demand so
// the clinician only spends a model call when they want one.
export function AgentToolbox({ patientId }: { patientId: string }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        <Sparkles className="h-4 w-4 text-primary" /> AI agents
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <RiskCard patientId={patientId} />
        <GapsCard patientId={patientId} />
        <FollowupCard patientId={patientId} />
        <SummaryCard patientId={patientId} />
        <LabsCard patientId={patientId} />
        <CarePlanCard patientId={patientId} />
      </div>
    </section>
  );
}

// --- shared card shell ------------------------------------------------------

function AgentCard({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <span className="ml-auto text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}

function CardError({ message }: { message: string }) {
  return <p className="text-sm text-destructive">{message}</p>;
}

function Loading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {label}
    </p>
  );
}

// Generic on-demand hook: runs `fn` and tracks loading/data/error.
function useAgent<T>(fn: (id: string) => Promise<T>, patientId: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await fn(patientId));
    } catch (e) {
      setError((e as ApiError).message ?? "Agent unavailable.");
    } finally {
      setLoading(false);
    }
  }
  return { data, loading, error, run };
}

// --- risk workbench ---------------------------------------------------------

const BAND_STYLE: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800",
  moderate: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

function RiskCard({ patientId }: { patientId: string }) {
  const { data, loading, error, run } = useAgent<RiskAssessment>(fetchRiskAssessment, patientId);
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  return (
    <AgentCard
      icon={Gauge}
      title="Readmission risk"
      hint={data ? (data.method === "integratedml" ? "IntegratedML" : "heuristic") : undefined}
    >
      {loading && <Loading label="Scoring…" />}
      {error && <CardError message={error} />}
      {data && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                BAND_STYLE[data.band] ?? "bg-slate-100 text-slate-700",
              )}
            >
              {data.band}
            </span>
            <span className="text-2xl font-semibold tabular-nums leading-none">{data.score}</span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {data.drivers.map((d) => (
              <li key={d}>· {d}</li>
            ))}
          </ul>
        </div>
      )}
    </AgentCard>
  );
}

// --- gaps in care -----------------------------------------------------------

function GapsCard({ patientId }: { patientId: string }) {
  const { data, loading, error, run } = useAgent<GapsResult>(fetchCareGaps, patientId);
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  return (
    <AgentCard
      icon={ClipboardCheck}
      title="Gaps in care"
      hint={data && data.task_ids.length > 0 ? `${data.task_ids.length} tasks written` : undefined}
    >
      {loading && <Loading label="Checking…" />}
      {error && <CardError message={error} />}
      {data &&
        (data.gaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open care gaps.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.gaps.map((g) => (
              <li key={g.code} className="leading-snug">
                <span className="font-medium">{g.title}</span>
                <span className="block text-xs text-muted-foreground">{g.detail}</span>
              </li>
            ))}
          </ul>
        ))}
    </AgentCard>
  );
}

// --- patient summary (on demand) --------------------------------------------

function SummaryCard({ patientId }: { patientId: string }) {
  const { data, loading, error, run } = useAgent<PatientSummary>(fetchPatientSummary, patientId);
  return (
    <AgentCard icon={FileText} title="Patient summary">
      {!data && !loading && !error && (
        <RunButton label="Generate summary" onClick={run} />
      )}
      {loading && <Loading label="Summarizing…" />}
      {error && <CardError message={error} />}
      {data && (
        <div className="space-y-1.5">
          {data.headline && <p className="font-medium leading-snug">{data.headline}</p>}
          <p className="text-sm leading-relaxed text-foreground/90">{data.summary}</p>
          {data.cautions.length > 0 && (
            <p className="text-xs text-amber-700">Cautions: {data.cautions.join("; ")}</p>
          )}
        </div>
      )}
    </AgentCard>
  );
}

// --- lab explainer (on demand) ----------------------------------------------

function LabsCard({ patientId }: { patientId: string }) {
  const { data, loading, error, run } = useAgent<LabsResult>(explainLabs, patientId);
  return (
    <AgentCard icon={FlaskConical} title="Lab explainer">
      {!data && !loading && !error && (
        <RunButton label="Explain results" onClick={run} />
      )}
      {loading && <Loading label="Explaining…" />}
      {error && <CardError message={error} />}
      {data && (
        <div className="space-y-1.5">
          {data.explanations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{data.overall}</p>
          ) : (
            <>
              <ul className="space-y-1">
                {data.explanations.map((e, i) => (
                  <li key={i} className="leading-snug">
                    <span className="font-medium">{e.name}</span>{" "}
                    <span className="text-muted-foreground">{e.value}</span>
                    <span className="block text-xs text-muted-foreground">{e.plain}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{data.overall}</p>
            </>
          )}
        </div>
      )}
    </AgentCard>
  );
}

// --- abnormal-results follow-up (deterministic, runs on open) ---------------

function FollowupCard({ patientId }: { patientId: string }) {
  const { data, loading, error, run } = useAgent<FollowupResult>(runFollowup, patientId);
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  return (
    <AgentCard
      icon={Stethoscope}
      title="Result follow-up"
      hint={data && data.task_ids.length > 0 ? `${data.task_ids.length} tasks written` : undefined}
    >
      {loading && <Loading label="Checking results…" />}
      {error && <CardError message={error} />}
      {data &&
        (data.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No abnormal results to follow up.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.findings.map((f, i) => (
              <li key={i} className="leading-snug">
                <span className="font-medium">{f.concern}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.observation}: {f.value}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </AgentCard>
  );
}

// --- care plan (on demand, writes a FHIR CarePlan) --------------------------

function CarePlanCard({ patientId }: { patientId: string }) {
  const { data, loading, error, run } = useAgent<CarePlanResult>(draftCarePlan, patientId);
  return (
    <AgentCard
      icon={ClipboardList}
      title="Care plan"
      hint={data?.care_plan_id ? "CarePlan written" : undefined}
    >
      {!data && !loading && !error && <RunButton label="Draft care plan" onClick={run} />}
      {loading && <Loading label="Drafting…" />}
      {error && <CardError message={error} />}
      {data && (
        <div className="space-y-1.5">
          {data.title && <p className="font-medium leading-snug">{data.title}</p>}
          <ul className="space-y-1 text-sm">
            {data.activities.map((a, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AgentCard>
  );
}

function RunButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="w-full">
      {label}
    </Button>
  );
}
