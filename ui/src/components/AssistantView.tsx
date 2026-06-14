import { useState } from "react";
import { Loader2, Send, Sparkles, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { orchestrate, ApiError } from "@/api";
import { cn } from "@/lib/utils";

// The orchestrator surface: one request is routed and chained across the
// specialist agents, and the reply shows which agents ran.
interface Turn {
  role: "user" | "agent";
  text: string;
  agents?: string[];
}

const STARTERS = [
  "Summarize this patient and check their readmission risk",
  "Find care gaps and draft a care plan",
  "Any abnormal results to follow up?",
  "How many patients have diabetes?",
];

export function AssistantView() {
  const [patientId, setPatientId] = useState("demo-patient-1");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setDraft("");
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await orchestrate(text, patientId.trim() || undefined);
      setTurns((t) => [
        ...t,
        { role: "agent", text: res.answer, agents: res.steps.map((s) => s.agent) },
      ]);
    } catch (err) {
      setTurns((t) => [...t, { role: "agent", text: (err as ApiError).message ?? "The orchestrator is unavailable." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> Assistant
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          One request, routed and chained across the specialist agents (triage, risk, gaps,
          follow-up, summary, labs, care plan, FHIR query).
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label className="text-muted-foreground">Patient</label>
        <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} className="h-8 w-48 font-mono text-xs" />
        <span className="text-xs text-muted-foreground">(population questions ignore this)</span>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask in plain language. The orchestrator decides which agents to run and synthesizes one
            answer.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-1.5">
            <div
              className={cn(
                "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                turn.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-accent/60",
              )}
            >
              <p className="whitespace-pre-line">{turn.text}</p>
            </div>
            {turn.agents && turn.agents.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                {turn.agents.map((a, j) => (
                  <span key={j} className="flex items-center gap-1">
                    {j > 0 && <span className="text-muted-foreground">→</span>}
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {a}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Orchestrating agents…
          </div>
        )}

        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={busy}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
            placeholder="Ask the assistant to do something…"
            className="min-h-10 flex-1 resize-none text-sm"
            rows={1}
          />
          <Button size="icon" onClick={() => ask(draft)} disabled={busy || !draft.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
