import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Inbox, RefreshCw, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchTriageQueue, ApiError } from "@/api";
import { levelConfig } from "@/data/questions";
import { cn } from "@/lib/utils";
import type { TriageQueueItem } from "@/types";

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

export function DashboardScreen() {
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
      const e = err as ApiError;
      setError(e.message ?? "Could not load the triage queue.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const escalations = items.filter((i) => i.escalated).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Clinician view
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Triage queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every completed interview, newest first — read live from FHIR{" "}
            <span className="font-mono text-xs">ServiceRequest</span> resources.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {escalations > 0 && (
            <span className="flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {escalations} escalated
            </span>
          )}
          <Button variant="outline" onClick={load} disabled={status === "loading"}>
            <RefreshCw className={cn("h-4 w-4", status === "loading" && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {status === "error" && (
        <Card>
          <CardContent className="p-6 text-sm">
            <p className="font-medium text-destructive">{error}</p>
            <p className="mt-1 text-muted-foreground">
              The FHIR endpoint may still be starting. Try again in a moment.
            </p>
          </CardContent>
        </Card>
      )}

      {status === "ready" && items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No triage sessions yet</p>
            <p className="text-sm text-muted-foreground">
              Complete an interview and it will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {items.map((item) => {
              const cfg = levelConfig(item.triage_level);
              return (
                <li key={item.service_request_id} className="flex">
                  <div className={cn("w-1.5 shrink-0", cfg.bar)} />
                  <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <span
                      className={cn(
                        "w-28 shrink-0 rounded-full px-2.5 py-1 text-center text-xs font-semibold",
                        cfg.badge,
                      )}
                    >
                      {cfg.label}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Stethoscope className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">
                          {item.patient_name || "Unknown patient"}
                        </span>
                        {item.escalated && (
                          <span className="flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            alert raised
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {item.chief_complaint || item.referral || "No chief complaint recorded"}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(item.authored_on)}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {item.encounter_id
                          ? `Encounter · ${item.encounter_id}`
                          : `SR · ${item.service_request_id}`}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
