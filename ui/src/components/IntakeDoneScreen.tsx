import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { levelConfig } from "@/data/questions";
import { cn } from "@/lib/utils";
import type { Handoff } from "@/types";

interface Props {
  handoff: Handoff;
  onDone: () => void;
}

// Patient-facing close of the intake. Deliberately minimal: a confirmation and
// the one thing the patient needs — what to do next. The full clinical picture
// (HPI, citations, FHIR resources) is for the clinician, in the case detail.
export function IntakeDoneScreen({ handoff, onDone }: Props) {
  const cfg = levelConfig(handoff.triage_level);
  const urgent = handoff.triage_level === "ed" || handoff.triage_level === "urgent-care";

  return (
    <div className="mx-auto max-w-lg space-y-8 pt-8 text-center">
      <div className="space-y-3">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Thanks — your answers are in</h1>
        <p className="text-sm text-muted-foreground">
          A clinician will review what you've told us. Here's what we'd suggest in the meantime.
        </p>
      </div>

      <div className="flex gap-4 border-y py-5 text-left">
        <div className={cn("w-1 shrink-0 rounded", cfg.accent)} />
        <div className="space-y-1">
          <p className={cn("text-sm font-semibold", cfg.text)}>
            {urgent ? "Please act on this now" : cfg.label}
          </p>
          <p className="text-sm leading-relaxed text-foreground/90">{cfg.guidance}</p>
        </div>
      </div>

      <div className="flex justify-center">
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
