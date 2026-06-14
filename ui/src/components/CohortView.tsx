import { useEffect, useState } from "react";
import { ClipboardCheck, Gauge, Loader2, RefreshCw, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchCohort, ApiError } from "@/api";
import { cn } from "@/lib/utils";
import type { CohortResult } from "@/types";

// Population analytics across the whole panel: aggregates and charts grouped by
// risk band, care-gap type, and condition — not a patient roster.
const BAND_BAR: Record<string, string> = {
  high: "bg-red-500",
  moderate: "bg-amber-500",
  low: "bg-emerald-500",
};
const BAND_TEXT: Record<string, string> = {
  high: "text-red-700",
  moderate: "text-amber-700",
  low: "text-emerald-700",
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
          <h1 className="text-xl font-semibold tracking-tight">Cohort analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Risk and care-gap patterns across the whole patient panel.
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

      {status === "ready" && agg && data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={Users} label="Patients" value={agg.total} tone="text-slate-500" />
            <Stat icon={Gauge} label="High risk" value={agg.high} tone="text-red-600" emphasize={agg.high > 0} />
            <Stat icon={Gauge} label="Avg risk score" value={agg.avg_score} tone="text-amber-600" />
            <Stat icon={ClipboardCheck} label="Open care gaps" value={agg.open_gaps} tone="text-blue-600" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Risk distribution */}
            <Panel title="Risk distribution" icon={Gauge}>
              <RiskDonut data={data} total={agg.total} />
            </Panel>

            {/* Care gaps grouped by type */}
            <Panel title="Open care gaps by type" icon={ClipboardCheck}>
              {data.gaps_by_type.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open care gaps in the panel.</p>
              ) : (
                <BarList
                  items={data.gaps_by_type.map((g) => ({ label: g.title, value: g.count }))}
                  barClass="bg-blue-500"
                />
              )}
            </Panel>

            {/* Top conditions */}
            <Panel title="Most common conditions" icon={Stethoscope}>
              {data.top_conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conditions on file.</p>
              ) : (
                <BarList
                  items={data.top_conditions.map((c) => ({ label: c.display, value: c.count }))}
                  barClass="bg-violet-500"
                />
              )}
            </Panel>

            {/* Highest-risk patients (short list, not the full roster) */}
            <Panel title="Highest-risk patients" icon={Users}>
              <ul className="space-y-2">
                {data.highest_risk.map((p) => (
                  <li key={p.patient_id} className="flex items-center gap-3 text-sm">
                    <span className={cn("w-16 shrink-0 text-xs font-semibold uppercase", BAND_TEXT[p.risk_band])}>
                      {p.risk_band}
                    </span>
                    <span className="w-8 shrink-0 font-semibold tabular-nums">{p.risk_score}</span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: typeof Users; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" /> {title}
      </h3>
      {children}
    </div>
  );
}

// A horizontal bar list (value bars scaled to the max), the clean alternative
// to a charting dependency.
function BarList({ items, barClass }: { items: { label: string; value: number }[]; barClass: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{it.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{it.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", barClass)} style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Risk distribution as a CSS conic-gradient donut + legend.
function RiskDonut({ data, total }: { data: CohortResult; total: number }) {
  const colors: Record<string, string> = { high: "#ef4444", moderate: "#f59e0b", low: "#10b981" };
  let acc = 0;
  const stops: string[] = [];
  for (const { band, count } of data.risk_distribution) {
    const start = (acc / Math.max(total, 1)) * 360;
    acc += count;
    const end = (acc / Math.max(total, 1)) * 360;
    stops.push(`${colors[band]} ${start}deg ${end}deg`);
  }
  return (
    <div className="flex items-center gap-5">
      <div
        className="h-28 w-28 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops.join(",") || "#e5e7eb 0deg 360deg"})` }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-card">
            <span className="text-lg font-semibold leading-none tabular-nums">{total}</span>
            <span className="text-[10px] text-muted-foreground">patients</span>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.risk_distribution.map(({ band, count }) => (
          <li key={band} className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", BAND_BAR[band])} />
            <span className="capitalize">{band}</span>
            <span className="tabular-nums text-muted-foreground">{count}</span>
          </li>
        ))}
      </ul>
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
