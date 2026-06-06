import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { fetchCaseOutcome, fetchPatientRecord, fetchTranscript, ApiError } from "@/api";
import { levelConfig } from "@/data/questions";
import { cn } from "@/lib/utils";
import type { CaseOutcome, PatientRecord, QA, RecordEntry, TriageQueueItem } from "@/types";

interface Props {
  item: TriageQueueItem;
  onBack: () => void;
}

export function CaseDetailScreen({ item, onBack }: Props) {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [outcome, setOutcome] = useState<CaseOutcome | null>(null);
  const [transcript, setTranscript] = useState<QA[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

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

  const cfg = levelConfig(outcome?.triage_level ?? item.triage_level);
  const demo = [record?.age != null ? `${record.age}` : null, record?.gender]
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

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {record?.name || item.patient_name || item.patient_id}
        </h1>
        <p className="text-sm text-muted-foreground">
          {demo && <span>{demo}</span>}
          {demo && "  ·  "}
          <span className="font-mono text-xs">{item.patient_id}</span>
        </p>
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
          {/* Clinical reasoning */}
          <div className="space-y-7">
            {/* Disposition */}
            <div className="flex gap-4">
              <div className={cn("w-1 shrink-0 rounded", cfg.accent)} />
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Recommended disposition
                </p>
                <p className={cn("text-lg font-semibold", cfg.text)}>{cfg.label}</p>
                <p className="text-sm text-muted-foreground">{cfg.guidance}</p>
              </div>
            </div>

            {outcome.chief_complaint && (
              <Section title="Chief complaint">
                <p className="text-sm leading-relaxed">{outcome.chief_complaint}</p>
              </Section>
            )}

            {outcome.hpi && (
              <Section title="Assessment">
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                  {outcome.hpi}
                </p>
              </Section>
            )}

            {outcome.red_flags.length > 0 && (
              <div className="border-l-2 border-red-400 pl-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Red flags
                </p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {outcome.red_flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {outcome.recommended_actions.length > 0 && (
              <Section title="Recommended actions">
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

            {transcript.length > 0 && (
              <Section title="Interview transcript">
                <dl className="space-y-3">
                  {transcript.map((qa) => (
                    <div key={qa.link_id}>
                      <dt className="text-sm text-muted-foreground">{qa.question}</dt>
                      <dd className="text-sm leading-relaxed">{qa.answer || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}
          </div>

          {/* Patient record + provenance */}
          <aside className="space-y-7 lg:border-l lg:pl-6">
            <RecordSection title="Conditions" entries={record?.conditions} empty="None active" />
            <RecordSection title="Medications" entries={record?.medications} empty="None active" />
            <RecordSection title="Recent vitals" entries={record?.vitals} empty="None on file" />
            <RecordSection
              title="Allergies"
              entries={record?.allergies}
              empty="None recorded"
              danger
            />

            {outcome.citations.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Guidelines cited
                </p>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

function RecordSection({
  title,
  entries,
  empty,
  danger,
}: {
  title: string;
  entries: RecordEntry[] | undefined;
  empty: string;
  danger?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {entries && entries.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {entries.map((e) => (
            <li key={e.display} className={cn(danger && "text-red-700")}>
              {e.display}
              {e.detail && (
                <span className="text-muted-foreground"> — {e.detail}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
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
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        FHIR resources
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
