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

// Swap the browser-tab favicon by audience: a hospital mark for the clinician
// console, the pulse mark for patient intake. Removing and re-adding the icon
// links (rather than mutating href) forces the browser to re-read them.
function useRouteFavicon(isIntake: boolean) {
  useEffect(() => {
    const svg = isIntake ? "/favicon.svg" : "/favicon-hospital.svg";
    const png = isIntake ? "/favicon-32.png" : "/favicon-hospital-32.png";
    document.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove());
    const add = (type: string, href: string) => {
      const link = document.createElement("link");
      link.rel = "icon";
      link.type = type;
      link.href = href;
      document.head.appendChild(link);
    };
    add("image/svg+xml", svg);
    add("image/png", png);
  }, [isIntake]);
}

export default function App() {
  const path = usePathname();
  const isIntake = path.startsWith("/intake");
  useRouteFavicon(isIntake);
  return isIntake ? <PatientIntakeApp /> : <ClinicianApp />;
}
