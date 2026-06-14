import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Inbox, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchTriageQueue, ApiError } from "@/api";
import { levelConfig } from "@/data/questions";
import { cn } from "@/lib/utils";
import type { TriageLevel, TriageQueueItem } from "@/types";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

interface Props {
  onOpen: (item: TriageQueueItem) => void;
}

export function WorklistScreen({ onOpen }: Props) {
  const [items, setItems] = useState<TriageQueueItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setItems(await fetchTriageQueue());
      setStatus("ready");
    } catch (err) {
      setError((err as ApiError).message ?? "Could not load the worklist.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unacked = items.filter((i) => i.escalated && !i.acknowledged_at).length;

  // Group by acuity, highest first (the Linear/ClickUp "group by status" pattern).
  const LEVEL_ORDER: TriageLevel[] = ["ed", "urgent-care", "see-gp", "self-care"];
  const byLevel = (lvl: string) => items.filter((i) => i.triage_level === lvl);
  const ordered = [
    ...LEVEL_ORDER.flatMap(byLevel),
    ...items.filter((i) => !LEVEL_ORDER.includes(i.triage_level as TriageLevel)),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Worklist</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "case" : "cases"}
            {unacked > 0 && (
              <span className="text-red-700">  ·  {unacked} need urgent review</span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={status === "loading"}>
          <RefreshCw className={cn("h-4 w-4", status === "loading" && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Inbox} label="Total cases" value={items.length} tone="text-slate-500" />
          <StatCard
            icon={AlertTriangle}
            label="Acute (ED + urgent)"
            value={byLevel("ed").length + byLevel("urgent-care").length}
            tone="text-orange-600"
          />
          <StatCard
            icon={ShieldAlert}
            label="Need review"
            value={unacked}
            tone={unacked > 0 ? "text-red-600" : "text-muted-foreground"}
            emphasize={unacked > 0}
          />
          <StatCard
            icon={Check}
            label="Acknowledged"
            value={items.filter((i) => i.escalated && i.acknowledged_at).length}
            tone="text-emerald-600"
          />
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium text-destructive">{error}</p>
          <p className="mt-1 text-muted-foreground">
            The FHIR endpoint may still be starting. Try again in a moment.
          </p>
        </div>
      )}

      {status === "ready" && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Inbox className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium">No cases yet</p>
          <p className="text-sm text-muted-foreground">
            Completed intake interviews appear here for review.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {ordered.map((item) => {
            const cfg = levelConfig(item.triage_level);
            return (
              <li key={item.service_request_id}>
                <button
                  onClick={() => onOpen(item)}
                  className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-accent/40"
                >
                  <span className={cn("h-9 w-1 shrink-0 rounded", cfg.accent)} />

                  <span className={cn("w-24 shrink-0 text-sm font-medium", cfg.text)}>
                    {cfg.label}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {item.patient_name || "Unknown patient"}
                      </span>
                      {item.escalated &&
                        (item.acknowledged_at ? (
                          <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                            <Check className="h-3 w-3 text-emerald-600" /> acknowledged
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs font-medium text-red-700">
                            alert raised
                          </span>
                        ))}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {item.chief_complaint || item.referral || "No chief complaint recorded"}
                    </span>
                  </span>

                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(item.authored_on)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  emphasize,
}: {
  icon: typeof Inbox;
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
