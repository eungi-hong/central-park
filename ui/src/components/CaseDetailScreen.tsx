import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  ClipboardList,
  Database,
  FileText,
  HeartPulse,
  ListChecks,
  Loader2,
  MessageSquareText,
  MessagesSquare,
  Pill,
  Send,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  acknowledgeCase,
  askCopilot,
  fetchCaseOutcome,
  fetchPatientRecord,
  fetchTranscript,
  ApiError,
} from "@/api";
import { AgentToolbox } from "@/components/AgentToolbox";
import { levelConfig } from "@/data/questions";
import { cn } from "@/lib/utils";
import type { CaseOutcome, PatientRecord, QA, RecordEntry, TriageQueueItem } from "@/types";

interface Props {
  item: TriageQueueItem;
  onBack: () => void;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CaseDetailScreen({ item, onBack }: Props) {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [outcome, setOutcome] = useState<CaseOutcome | null>(null);
  const [transcript, setTranscript] = useState<QA[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [ackAt, setAckAt] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setError(null);
      try {
        const [rec, out] = await Promise.all([
          fetchPatientRecord(item.patient_id),
          fetchCaseOutcome(item.service_request_id),
        ]);
        if (cancelled) return;
        setRecord(rec);
        setOutcome(out);
        setAckAt(out.acknowledged_at);
        if (out.qr_id) {
          const t = await fetchTranscript(out.qr_id).catch(() => []);
          if (!cancelled) setTranscript(t);
        }
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError((err as ApiError).message ?? "Could not load this case.");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.patient_id, item.service_request_id]);

  async function acknowledge() {
    setAcking(true);
    setAckError(null);
    try {
      setAckAt(await acknowledgeCase(item.service_request_id));
    } catch (err) {
      setAckError((err as ApiError).message ?? "Could not save the acknowledgement.");
    } finally {
      setAcking(false);
    }
  }

  const cfg = levelConfig(outcome?.triage_level ?? item.triage_level);
  const escalated = item.escalated;
  const alertCount = (outcome?.red_flags.length ?? 0) + (outcome?.detected_issues.length ?? 0);
  const meta = [record?.age != null ? `${record.age}y` : null, record?.gender]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Worklist
      </button>

      {/* Header: identity + disposition + acknowledge */}
      <div className="flex gap-4 rounded-lg border p-5">
        <div className={cn("w-1 shrink-0 rounded", cfg.accent)} />
        <div className="flex flex-1 flex-wrap items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight">
              {record?.name || item.patient_name || item.patient_id}
            </h1>
            <p className="text-sm text-muted-foreground">
              {meta && <span>{meta}  ·  </span>}
              <span className="font-mono text-xs">{item.patient_id}</span>
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white",
                cfg.accent,
              )}
            >
              {cfg.label}
            </span>
            {escalated &&
              (ackAt ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-emerald-600" /> Acknowledged {formatTime(ackAt)}
                </span>
              ) : (
                <Button size="sm" onClick={acknowledge} disabled={acking}>
                  {acking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  Acknowledge
                </Button>
              ))}
          </div>
        </div>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading case…
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium text-destructive">{error}</p>
        </div>
      )}

      {status === "ready" && outcome && (
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          {/* Clinical content, split into panes so the case never feels crowded. */}
          <div className="min-w-0">
            {ackError && <p className="mb-4 text-sm text-destructive">{ackError}</p>}

            <Tabs defaultValue="overview">
              <TabsList className="mb-6">
                <TabsTrigger value="overview">
                  <FileText className="h-4 w-4" /> Overview
                  {alertCount > 0 && (
                    <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                      {alertCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="agents">
                  <Sparkles className="h-4 w-4" /> Agents
                </TabsTrigger>
                {transcript.length > 0 && (
                  <TabsTrigger value="transcript">
                    <MessagesSquare className="h-4 w-4" /> Transcript
                  </TabsTrigger>
                )}
                <TabsTrigger value="copilot">
                  <Bot className="h-4 w-4" /> Copilot
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-7">
                <p className="text-sm text-muted-foreground">{cfg.guidance}</p>

                {outcome.chief_complaint && (
                  <Section title="Chief complaint" icon={MessageSquareText} tone="text-slate-500">
                    <p className="text-sm leading-relaxed">{outcome.chief_complaint}</p>
                  </Section>
                )}

                {outcome.red_flags.length > 0 && (
                  <div className="rounded-md border-l-2 border-red-400 bg-red-50/50 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5" /> Red flags
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm text-red-900">
                      {outcome.red_flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {outcome.detected_issues.length > 0 && (
                  <div className="rounded-md border-l-2 border-orange-400 bg-orange-50/50 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-700">
                      <Pill className="h-3.5 w-3.5" /> Medication / allergy interactions
                    </p>
                    <ul className="mt-1.5 space-y-1.5 text-sm text-orange-900">
                      {outcome.detected_issues.map((d, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-0.5 shrink-0 rounded bg-orange-200/70 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-orange-800">
                            {d.severity}
                          </span>
                          <span className="leading-relaxed">{d.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {outcome.hpi && (
                  <Section title="Assessment" icon={Stethoscope} tone="text-blue-600">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                      {outcome.hpi}
                    </p>
                  </Section>
                )}

                {outcome.recommended_actions.length > 0 && (
                  <Section title="Recommended actions" icon={ListChecks} tone="text-emerald-600">
                    <ul className="space-y-1.5 text-sm">
                      {outcome.recommended_actions.map((a) => (
                        <li key={a} className="flex gap-2.5 leading-relaxed">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/50" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}
              </TabsContent>

              <TabsContent value="agents" className="space-y-7">
                <AgentToolbox patientId={item.patient_id} />
                {outcome.trace.length > 0 && (
                  <ReasoningTrail trace={outcome.trace} verifierNote={outcome.verifier_note} />
                )}
              </TabsContent>

              {transcript.length > 0 && (
                <TabsContent value="transcript">
                  <div className="divide-y rounded-lg border">
                    {transcript.map((qa) => (
                      <div key={qa.link_id} className="space-y-1 px-4 py-3">
                        <p className="text-sm text-muted-foreground">{qa.question}</p>
                        <p className="text-sm leading-relaxed">{qa.answer || "—"}</p>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              )}

              <TabsContent value="copilot">
                <CopilotPanel patientId={item.patient_id} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Patient record + provenance */}
          <aside className="space-y-6">
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                <ClipboardList className="h-4 w-4 text-slate-600" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Patient record
                </h2>
              </div>
              <div className="divide-y">
                <RecordGroup title="Conditions" icon={Stethoscope} tone="text-blue-600" entries={record?.conditions} empty="None active" />
                <RecordGroup title="Medications" icon={Pill} tone="text-violet-600" entries={record?.medications} empty="None active" />
                <RecordGroup title="Recent vitals" icon={HeartPulse} tone="text-teal-600" entries={record?.vitals} empty="None on file" />
                <RecordGroup title="Allergies" icon={ShieldAlert} tone="text-red-600" entries={record?.allergies} empty="None recorded" danger />
              </div>
            </div>

            {outcome.citations.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                  <BookOpen className="h-4 w-4 text-violet-600" /> Guidelines cited
                </h3>
                <ul className="space-y-3">
                  {outcome.citations.map((c, i) => (
                    <li key={`${c.source}-${i}`} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">
                          {c.source || c.slug || `Guideline ${i + 1}`}
                        </span>
                        {typeof c.score === "number" && (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {(c.score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {c.snippet && (
                        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {c.snippet}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <FhirResources item={item} outcome={outcome} />
          </aside>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        {Icon && <Icon className={cn("h-4 w-4", tone ?? "text-muted-foreground")} />}
        {title}
      </h3>
      {children}
    </div>
  );
}

function RecordGroup({
  title,
  icon: Icon,
  tone,
  entries,
  empty,
  danger,
}: {
  title: string;
  icon: LucideIcon;
  tone: string;
  entries: RecordEntry[] | undefined;
  empty: string;
  danger?: boolean;
}) {
  return (
    <div className="space-y-1.5 px-4 py-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/80">
        <Icon className={cn("h-3.5 w-3.5", tone)} />
        {title}
      </h4>
      {entries && entries.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {entries.map((e) => (
            <li key={e.display} className={cn("leading-snug", danger && "font-medium text-red-700")}>
              {e.display}
              {e.detail && <span className="font-normal text-muted-foreground"> · {e.detail}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground/70">{empty}</p>
      )}
    </div>
  );
}

// Clinician copilot: a read-only chat grounded on this patient's FHIR record.
// Starter chips seed common questions; answers come from POST /api/copilot.
interface CopilotTurn {
  role: "user" | "agent";
  text: string;
  citations?: { source?: string; slug?: string; snippet?: string }[];
}

const COPILOT_STARTERS = [
  "Why this triage level?",
  "Any medication interactions to worry about?",
  "What in their history is most relevant?",
];

function CopilotPanel({ patientId }: { patientId: string }) {
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    setTurns((t) => [...t, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await askCopilot(patientId, q);
      setTurns((t) => [...t, { role: "agent", text: res.answer, citations: res.citations }]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        { role: "agent", text: (err as ApiError).message ?? "The copilot is unavailable right now." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Ask the agent" icon={Bot} tone="text-primary">
      <div className="space-y-3 rounded-lg border p-4">
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            A read-only copilot, grounded on this patient's record and the cited guidelines. It
            cannot change the triage.
          </p>
        )}

        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
              turn.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-accent/60",
            )}
          >
            <p className="whitespace-pre-line">{turn.text}</p>
            {turn.citations && turn.citations.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Cited: {turn.citations.map((c) => c.source || c.slug).filter(Boolean).join("; ")}
              </p>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}

        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {COPILOT_STARTERS.map((s) => (
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
            placeholder="Ask about this patient…"
            className="min-h-10 flex-1 resize-none text-sm"
            rows={1}
          />
          <Button size="icon" onClick={() => ask(draft)} disabled={busy || !draft.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Section>
  );
}

// The multi-agent reasoning trail, shown as a vertical step timeline. Each
// entry is one agent that ran; the verifier's note (if any) is called out below.
function ReasoningTrail({ trace, verifierNote }: { trace: string[]; verifierNote: string }) {
  return (
    <div className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        <Sparkles className="h-4 w-4 text-primary" /> Agent reasoning
      </h3>
      <ol className="space-y-2.5">
        {trace.map((step, i) => {
          const [agent, ...rest] = step.split(":");
          const detail = rest.join(":").trim();
          return (
            <li key={i} className="flex gap-2.5 text-sm">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="leading-snug">
                <span className="font-medium">{agent}</span>
                {detail && <span className="text-muted-foreground"> · {detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {verifierNote && (
        <p className="rounded-md border-l-2 border-primary/40 bg-accent/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Reviewer:</span> {verifierNote}
        </p>
      )}
    </div>
  );
}

function FhirResources({ item, outcome }: { item: TriageQueueItem; outcome: CaseOutcome }) {
  const rows: [string, string][] = [];
  if (outcome.qr_id) rows.push(["QuestionnaireResponse", outcome.qr_id]);
  if (item.encounter_id) rows.push(["Encounter", item.encounter_id]);
  rows.push(["ServiceRequest", item.service_request_id]);
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        <Database className="h-4 w-4 text-slate-500" /> FHIR resources
      </h3>
      <ul className="space-y-1 text-xs">
        {rows.map(([type, id]) => (
          <li key={type} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{type}</span>
            <span className="truncate font-mono">{id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
