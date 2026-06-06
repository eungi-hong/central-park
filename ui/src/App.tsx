import { useEffect, useState } from "react";
import { ClinicianApp } from "@/components/ClinicianApp";
import { PatientIntakeApp } from "@/components/PatientIntakeApp";

export type ProcessStep = "fhir" | "agent";

// Two front doors, one SPA. The clinician console lives at "/"; the patient
// self-intake is its own URL ("/intake") — a link or waiting-room kiosk the
// patient opens. Neither audience ever sees the other's chrome. Lightweight
// path routing (no router dependency) is the right altitude for two routes.
function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export default function App() {
  const path = usePathname();
  return path.startsWith("/intake") ? <PatientIntakeApp /> : <ClinicianApp />;
}
