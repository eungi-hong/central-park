import type { Handoff, QA } from "@/types";

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
