import type { Handoff, QA, TriageLevel, TriageQueueItem } from "@/types";

// Same-origin routes. nginx (prod) and the vite dev proxy both map:
//   /fhir/*  -> IRIS FHIR R4 endpoint (with server-side Basic auth injected)
//   /api/*   -> the triage agent FastAPI
const FHIR_BASE = "/fhir";
const AGENT_BASE = "/api";

export type ApiErrorKind =
  | "fhir-unreachable"
  | "fhir-http"
  | "fhir-no-id"
  | "agent-unreachable"
  | "agent-http";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  detail?: string;

  constructor(kind: ApiErrorKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

// IRIS returns 201 with an empty body; the new id lives in the Location
// header (often relative). Pull the segment after "QuestionnaireResponse".
function idFromLocation(location: string | null): string {
  if (!location) return "";
  const parts = location.split("/").filter(Boolean);
  const idx = parts.indexOf("QuestionnaireResponse");
  if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1];
  return "";
}

export async function createQuestionnaireResponse(
  patientId: string,
  qa: QA[],
): Promise<string> {
  const payload = {
    resourceType: "QuestionnaireResponse",
    questionnaire: "Questionnaire/triage-intake",
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    authored: new Date().toISOString(),
    item: qa.map((item) => ({
      linkId: item.link_id,
      text: item.question,
      answer: [{ valueString: item.answer }],
    })),
  };

  let resp: Response;
  try {
    resp = await fetch(`${FHIR_BASE}/QuestionnaireResponse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError("fhir-unreachable", "Cannot reach the FHIR server.");
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("fhir-http", "FHIR rejected the interview.", resp.status, detail);
  }

  // Prefer the response body id; fall back to the Location header.
  let id = "";
  const body = await resp.text().catch(() => "");
  if (body) {
    try {
      id = (JSON.parse(body) as { id?: string }).id ?? "";
    } catch {
      /* empty/non-JSON body is expected from IRIS */
    }
  }
  if (!id) {
    id =
      idFromLocation(resp.headers.get("Location")) ||
      idFromLocation(resp.headers.get("Content-Location"));
  }
  if (!id) {
    throw new ApiError(
      "fhir-no-id",
      "FHIR accepted the interview but returned no resource id.",
    );
  }
  return id;
}

export async function runInterview(
  patientId: string,
  questionnaireResponseId: string,
): Promise<Handoff> {
  let resp: Response;
  try {
    resp = await fetch(`${AGENT_BASE}/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: patientId,
        questionnaire_response_id: questionnaireResponseId,
      }),
    });
  } catch {
    throw new ApiError("agent-unreachable", "Cannot reach the triage agent.");
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("agent-http", "The triage agent returned an error.", resp.status, detail);
  }
  return (await resp.json()) as Handoff;
}

// Reverse of the SNOMED codes the agent stamps onto each ServiceRequest
// (src/python/central_park/tools/fhir.py:_TRIAGE_LEVEL_SR). The code is the
// authoritative triage level; priority alone can't separate self-care/see-gp.
const SR_CODE_TO_LEVEL: Record<string, TriageLevel> = {
  "243958005": "self-care",
  "306206005": "see-gp",
  "310861008": "urgent-care",
  "182813001": "ed",
};

function patientName(p: Record<string, unknown>): string {
  const names = (p.name as Array<Record<string, unknown>>) ?? [];
  for (const n of names) {
    const family = n.family as string | undefined;
    if (family) {
      const given = ((n.given as string[]) ?? []).join(" ");
      return `${given} ${family}`.trim();
    }
  }
  return "";
}

function refId(reference: string | undefined, type: string): string | null {
  if (!reference) return null;
  const parts = reference.split("/").filter(Boolean);
  const idx = parts.indexOf(type);
  return idx >= 0 && idx + 1 < parts.length ? parts[idx + 1] : null;
}

// Every triage interview writes a ServiceRequest carrying the triage level
// (SNOMED code), chief complaint (reasonCode), timestamp, and patient ref.
// We _include the subject Patient to resolve display names in one round-trip,
// then sort newest-first client-side (avoids depending on FHIR _sort support).
export async function fetchTriageQueue(): Promise<TriageQueueItem[]> {
  let resp: Response;
  try {
    resp = await fetch(
      `${FHIR_BASE}/ServiceRequest?_count=50&_include=ServiceRequest:subject`,
      { headers: { Accept: "application/fhir+json" } },
    );
  } catch {
    throw new ApiError("fhir-unreachable", "Cannot reach the FHIR server.");
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError("fhir-http", "FHIR rejected the queue query.", resp.status, detail);
  }

  const bundle = (await resp.json()) as {
    entry?: Array<{ resource?: Record<string, any> }>;
  };
  const entries = (bundle.entry ?? []).map((e) => e.resource).filter(Boolean) as Record<
    string,
    any
  >[];

  const patients = new Map<string, string>();
  for (const r of entries) {
    if (r.resourceType === "Patient" && r.id) patients.set(r.id, patientName(r));
  }

  const items: TriageQueueItem[] = entries
    .filter((r) => r.resourceType === "ServiceRequest")
    .map((sr) => {
      const code = (sr.code?.coding?.[0]?.code as string) ?? "";
      const level = SR_CODE_TO_LEVEL[code] ?? "see-gp";
      const patientId = refId(sr.subject?.reference, "Patient") ?? "";
      return {
        service_request_id: (sr.id as string) ?? "",
        encounter_id: refId(sr.encounter?.reference, "Encounter"),
        patient_id: patientId,
        patient_name: patients.get(patientId) || patientId,
        triage_level: level,
        chief_complaint: (sr.reasonCode?.[0]?.text as string) ?? "",
        referral: (sr.code?.text as string) ?? "",
        authored_on: (sr.authoredOn as string) ?? null,
        escalated: level === "urgent-care" || level === "ed",
      };
    });

  items.sort((a, b) => (b.authored_on ?? "").localeCompare(a.authored_on ?? ""));
  return items.slice(0, 25);
}
