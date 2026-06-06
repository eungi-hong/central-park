import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_PATIENT } from "@/data/demoPatient";

interface Props {
  initialId: string;
  onStart: (id: string) => void;
}

export function SetupScreen({ initialId, onStart }: Props) {
  const [id, setId] = useState(initialId);
  const isDemo = id.trim() === DEMO_PATIENT.id;

  return (
    <div className="mx-auto max-w-md space-y-7 pt-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Before you see a clinician</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A few quick questions about how you're feeling today. It takes about a minute and helps
          the clinician understand your concern before you're seen. There are no wrong answers.
        </p>
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(id);
        }}
      >
        <Label htmlFor="patient-id">Patient ID</Label>
        <div className="flex gap-2">
          <Input
            id="patient-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="demo-patient-1"
            autoFocus
          />
          <Button type="submit" className="shrink-0">
            Start <ArrowRight />
          </Button>
        </div>
        {/* Light identity confirmation — the patient just needs to know it's them. */}
        <p className="text-xs text-muted-foreground">
          {isDemo ? (
            <>
              Checking in as <span className="font-medium text-foreground">{DEMO_PATIENT.name}</span>
              {" · "}
              {DEMO_PATIENT.summary}
            </>
          ) : (
            <>
              Demo uses <code className="rounded bg-muted px-1 py-0.5">demo-patient-1</code>.
            </>
          )}
        </p>
      </form>
    </div>
  );
}
