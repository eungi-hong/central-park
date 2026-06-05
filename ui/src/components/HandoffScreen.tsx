import { AlertTriangle, FileText, RotateCcw, Stethoscope, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { levelConfig } from "@/data/questions";
import { cn } from "@/lib/utils";
import type { Handoff } from "@/types";

interface Props {
  handoff: Handoff;
  qrId: string | null;
  patientId: string;
  onReset: () => void;
}

export function HandoffScreen({ handoff: h, qrId, patientId, onReset }: Props) {
  const cfg = levelConfig(h.triage_level);
  const citations = h.citations ?? [];
  const redFlags = h.red_flags ?? [];
  const actions = h.recommended_actions ?? [];

  const fhirResources: string[] = [];
  if (qrId) fhirResources.push(`QuestionnaireResponse · ${qrId}`);
  if (h.encounter_id) fhirResources.push(`Encounter · ${h.encounter_id}`);
  if (h.service_request_id) fhirResources.push(`ServiceRequest · ${h.service_request_id}`);
  const obs = h.observation_ids ?? [];
  if (obs.length) fhirResources.push(`${obs.length} Observation${obs.length === 1 ? "" : "s"}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Clinician handoff · Patient {patientId}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Triage assessment</h1>
        </div>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw /> New assessment
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="space-y-5">
          {/* Triage level banner */}
          <Card className="overflow-hidden">
            <div className="flex">
              <div className={cn("w-1.5 shrink-0", cfg.bar)} />
              <CardContent className="flex flex-1 flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Recommended disposition
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-sm font-semibold",
                        cfg.badge,
                      )}
                    >
                      {cfg.label}
                    </span>
                  </div>
                </div>
                {cfg.blurb && (
                  <p className="max-w-xs text-sm text-muted-foreground">{cfg.blurb}</p>
                )}
              </CardContent>
            </div>
          </Card>

          {redFlags.length > 0 && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Red flags detected</AlertTitle>
              <AlertDescription>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {redFlags.map((flag) => (
                    <span
                      key={flag}
                      className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="space-y-5 p-6">
              {h.chief_complaint && (
                <Section icon={<Stethoscope className="h-4 w-4" />} title="Chief complaint">
                  <p className="text-sm leading-relaxed">{h.chief_complaint}</p>
                </Section>
              )}

              {h.chief_complaint && h.hpi && <Separator />}

              {h.hpi && (
                <Section title="History of present illness">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                    {h.hpi}
                  </p>
                </Section>
              )}

              {actions.length > 0 && (
                <>
                  <Separator />
                  <Section icon={<ListChecks className="h-4 w-4" />} title="Recommended actions">
                    <ul className="space-y-1.5">
                      {actions.map((a) => (
                        <li key={a} className="flex gap-2 text-sm leading-relaxed">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                </>
              )}
            </CardContent>
          </Card>

          {fhirResources.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-medium">FHIR resources written:</span>
              {fhirResources.map((r) => (
                <span key={r} className="rounded-md bg-secondary px-2 py-0.5 font-mono">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Citations rail */}
        <aside className="space-y-3">
          <h3 className="text-sm font-semibold tracking-tight">
            Guidelines cited{" "}
            <span className="font-normal text-muted-foreground">({citations.length})</span>
          </h3>
          {citations.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                No guidelines were cited for this assessment.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="px-5 py-1">
                <Accordion type="multiple" className="w-full">
                  {citations.map((c, i) => {
                    const title = c.source || c.slug || `Guideline ${i + 1}`;
                    const score = typeof c.score === "number" ? c.score : null;
                    return (
                      <AccordionItem key={`${title}-${i}`} value={`c-${i}`}>
                        <AccordionTrigger>
                          <span className="min-w-0 flex-1 truncate pr-2">{title}</span>
                          {score !== null && (
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {(score * 100).toFixed(0)}%
                            </span>
                          )}
                        </AccordionTrigger>
                        <AccordionContent>
                          {score !== null && (
                            <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-primary/70"
                                style={{ width: `${Math.min(100, score * 100)}%` }}
                              />
                            </div>
                          )}
                          <p className="leading-relaxed text-muted-foreground">
                            {c.snippet || "No excerpt available."}
                          </p>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}
