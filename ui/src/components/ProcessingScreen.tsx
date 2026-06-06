import { Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { ProcessStep } from "@/App";

interface Props {
  step: ProcessStep;
  error: { title: string; detail?: string } | null;
  onRetry: () => void;
  onCancel: () => void;
}

const STEPS: { key: ProcessStep; label: string }[] = [
  { key: "fhir", label: "Saving your answers" },
  { key: "agent", label: "Reviewing your answers" },
];

export function ProcessingScreen({ step, error, onRetry, onCancel }: Props) {
  const activeIdx = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="mx-auto max-w-lg pt-6">
      <Card>
        <CardContent className="space-y-5 p-8">
          <h2 className="text-lg font-semibold tracking-tight">
            {error ? "Something went wrong" : "Submitting your answers…"}
          </h2>

          <ol className="space-y-3">
            {STEPS.map((s, i) => {
              const done = !error && i < activeIdx;
              const active = !error && i === activeIdx;
              const failed = !!error && i === activeIdx;
              return (
                <li key={s.key} className="flex items-center gap-3 text-sm">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      done && "border-primary/40 bg-primary/10 text-primary",
                      active && "border-primary text-primary",
                      failed && "border-destructive/40 bg-destructive/10 text-destructive",
                      !done && !active && !failed && "border-border text-muted-foreground",
                    )}
                  >
                    {done && <Check className="h-3.5 w-3.5" />}
                    {active && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {failed && <AlertCircle className="h-3.5 w-3.5" />}
                    {!done && !active && !failed && <span className="text-[11px]">{i + 1}</span>}
                  </span>
                  <span className={cn(done && "text-muted-foreground", failed && "text-destructive")}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {error && (
            <>
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{error.title}</AlertTitle>
                {error.detail && (
                  <AlertDescription className="mt-1 break-words font-mono text-xs">
                    {error.detail}
                  </AlertDescription>
                )}
              </Alert>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onCancel}>
                  Start over
                </Button>
                <Button onClick={onRetry}>Retry</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
