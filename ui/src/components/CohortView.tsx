import { useEffect, useState } from "react";
import { ClipboardCheck, Gauge, Loader2, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchCohort, ApiError } from "@/api";
import { cn } from "@/lib/utils";
import type { CohortResult } from "@/types";

// Population view: every patient in the repository, ranked by risk, with
// aggregate counts. Runs the deterministic risk + gaps agents across the panel.
const BAND_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  moderate: "bg-amber-100 text-amber-800",
  low: "bg-emerald-100 text-emerald-800",
};

export function CohortView() {
  const [data, setData] = useState<CohortResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStatus("loading");
    setError(null);
    try {
      setData(await fetchCohort());
      setStatus("ready");
    } catch (err) {
      setError((err as ApiError).message ?? "Could not load the cohort.");
      setStatus("error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const agg = data?.aggregates;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cohort</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every patient, ranked by readmission risk with open care gaps.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={status === "loading"}>
          <RefreshCw className={cn("h-4 w-4", status === "loading" && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Assessing the cohort…
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium text-destructive">{error}</p>
        </div>
      )}

      {status === "ready" && agg && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={Users} label="Patients" value={agg.total} tone="text-slate-500" />
            <Stat icon={Gauge} label="High risk" value={agg.high} tone="text-red-600" emphasize={agg.high > 0} />
            <Stat icon={Gauge} label="Moderate risk" value={agg.moderate} tone="text-amber-600" />
            <Stat icon={ClipboardCheck} label="Open care gaps" value={agg.open_gaps} tone="text-blue-600" />
          </div>

          <ul className="divide-y rounded-lg border">
            {data!.patients.map((p) => (
              <li key={p.patient_id} className="flex items-center gap-4 px-4 py-3">
                <span
                  className={cn(
                    "w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-semibold uppercase tracking-wide",
                    BAND_STYLE[p.risk_band] ?? "bg-slate-100 text-slate-700",
                  )}
                >
                  {p.risk_band}
                </span>
                <span className="w-12 shrink-0 text-lg font-semibold tabular-nums">{p.risk_score}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {p.gaps > 0 && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <ClipboardCheck className="h-3.5 w-3.5 text-blue-600" />
                    {p.gaps} {p.gaps === 1 ? "gap" : "gaps"}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">{p.risk_method}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  emphasize,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: string;
  emphasize?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-3.5", emphasize && "border-red-200 bg-red-50/40")}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", tone)} />
        {label}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums leading-none", emphasize && "text-red-700")}>
        {value}
      </p>
    </div>
  );
}
