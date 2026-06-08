import { useState } from "react";
import { Activity, ExternalLink } from "lucide-react";
import { WorklistScreen } from "@/components/WorklistScreen";
import { CaseDetailScreen } from "@/components/CaseDetailScreen";
import type { TriageQueueItem } from "@/types";

// The clinician console at "/". The worklist and case detail are the only
// surfaces here — the clinician never fills in the patient interview. The link
// to the patient intake opens its own URL in a new tab (framed as "this is
// what the patient gets", e.g. a waiting-room kiosk), never inline.
export function ClinicianApp() {
  const [selected, setSelected] = useState<TriageQueueItem | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-6 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Triage Park</span>
          <span className="text-sm text-muted-foreground">· Clinical triage</span>

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
        ) : (
          <WorklistScreen onOpen={setSelected} />
        )}
      </main>
    </div>
  );
}
