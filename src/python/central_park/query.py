"""NL->FHIR query agent: natural language to a validated, read-only FHIR search.

A clinician or analyst asks in plain language ("diabetic patients over 65",
"urgent ServiceRequests this week"). The agent translates that into a FHIR
search (resource type + search params), which is validated against an
allow-list and executed read-only. No writes, no raw SQL, no access outside the
allow-listed resource types, so a generated query is always safe to run.
"""

from __future__ import annotations

import json
import logging
import pathlib

from central_park.llm import get_provider
from central_park.tools import fhir_search, patients_with
from central_park.tools.fhir import QUERYABLE_RESOURCES

_log = logging.getLogger("central_park.query")

_PROMPT_TMPL = (pathlib.Path(__file__).parent / "prompts" / "query.txt").read_text(encoding="utf-8")
_PROMPT = _PROMPT_TMPL.replace("{{RESOURCES}}", ", ".join(sorted(QUERYABLE_RESOURCES)))


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return {}


def run_query(question: str) -> dict:
    """Translate `question` into a FHIR search, run it, and return results.

    Shape: {resource_type, params, explanation, total, results, error?}.
    """
    parsed = _loads(get_provider().complete(system=_PROMPT, messages=[{"role": "user", "content": question}]))
    resource_type = parsed.get("resource_type", "")
    params = parsed.get("params", {}) or {}
    contains = (parsed.get("contains") or "").strip()
    # When the user asks for *patients* who have a matching clinical resource,
    # the agent sets resolve_to "Patient": we search the clinical resource, then
    # return the distinct subject patients.
    resolve_to = (parsed.get("resolve_to") or "").strip()
    explanation = parsed.get("explanation", "")

    base = {"resource_type": resource_type, "params": params, "contains": contains,
            "resolve_to": resolve_to, "explanation": explanation, "total": 0, "results": []}

    if resource_type not in QUERYABLE_RESOURCES:
        return {**base, "error": f"I can only query: {', '.join(sorted(QUERYABLE_RESOURCES))}."}

    try:
        if resolve_to == "Patient" and resource_type != "Patient":
            found = patients_with(resource_type, params, contains=contains)
        else:
            found = fhir_search(resource_type, params, contains=contains)
    except Exception as exc:
        _log.warning("run_query: search failed (%s)", exc)
        return {**base, "error": "The query could not be executed against the FHIR server."}
    return {**base, "total": found["total"], "results": found["results"]}
