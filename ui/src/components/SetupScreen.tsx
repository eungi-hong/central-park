import { useState } from "react";
import { ArrowRight, HeartPulse, Pill, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEMO_PATIENT } from "@/data/demoPatient";

interface Props {
  initialId: string;
  onStart: (id: string) => void;
}

export function SetupScreen({ initialId, onStart }: Props) {
  const [id, setId] = useState(initialId);

  return (
    <div className="grid items-start gap-6 md:grid-cols-[1.1fr_0.9fr]">
      {/* Begin card */}
      <Card>
        <CardContent className="space-y-6 p-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Start a triage interview</h1>
            <p className="text-sm text-muted-foreground">
              A short structured intake, grounded on the patient's FHIR record. Six questions, then
              a clinician handoff summary with a triage level and cited guidelines.
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
                Begin <ArrowRight />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Use <code className="rounded bg-muted px-1 py-0.5">demo-patient-1</code> for the
              seeded demo.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* Demo patient context */}
      <Card className="bg-accent/40">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Demo patient
              </p>
              <p className="text-lg font-semibold">{DEMO_PATIENT.name}</p>
              <p className="text-sm text-muted-foreground">{DEMO_PATIENT.summary}</p>
            </div>
            <Badge variant="secondary">{DEMO_PATIENT.id}</Badge>
          </div>

          <Field icon={<HeartPulse className="h-3.5 w-3.5" />} label="Conditions" items={DEMO_PATIENT.conditions} />
          <Field icon={<Pill className="h-3.5 w-3.5" />} label="Medications" items={DEMO_PATIENT.medications} />
          <Field label="Recent vitals" items={DEMO_PATIENT.vitals} />

          <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            Allergy: {DEMO_PATIENT.allergy}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  icon,
  label,
  items,
}: {
  icon?: React.ReactNode;
  label: string;
  items: readonly string[];
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className="rounded-md bg-card px-2 py-0.5 text-xs text-foreground shadow-sm">
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
