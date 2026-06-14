import { useState } from "react";
import { Activity, ExternalLink, Inbox, Search, Users } from "lucide-react";
import { WorklistScreen } from "@/components/WorklistScreen";
import { CohortView } from "@/components/CohortView";
import { ExploreView } from "@/components/ExploreView";
import { CaseDetailScreen } from "@/components/CaseDetailScreen";
import { cn } from "@/lib/utils";
import type { TriageQueueItem } from "@/types";

type View = "worklist" | "cohort" | "explore";

const NAV: { id: View; label: string; icon: typeof Inbox }[] = [
  { id: "worklist", label: "Worklist", icon: Inbox },
  { id: "cohort", label: "Cohort", icon: Users },
  { id: "explore", label: "Explore", icon: Search },
];

// The clinician console at "/". Three surfaces — the per-case worklist, the
// population Cohort view, and the NL Explore query — plus the case detail. The
// patient intake opens its own URL in a new tab; the clinician never fills it in.
export function ClinicianApp() {
  const [view, setView] = useState<View>("worklist");
  const [selected, setSelected] = useState<TriageQueueItem | null>(null);

  function go(v: View) {
    setSelected(null);
    setView(v);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-6 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Triage Park</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">· Clinical AI platform</span>

          <nav className="ml-6 flex items-center gap-1">
            {NAV.map((n) => {
              const active = !selected && view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </button>
              );
            })}
          </nav>

          <a
            href="/intake"
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Patient intake <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {selected ? (
          <CaseDetailScreen item={selected} onBack={() => setSelected(null)} />
        ) : view === "worklist" ? (
          <WorklistScreen onOpen={setSelected} />
        ) : view === "cohort" ? (
          <CohortView />
        ) : (
          <ExploreView />
        )}
      </main>
    </div>
  );
}
