"""Vector-search tool over the seeded triage-guidelines corpus.

The agent posts the raw query text to /centralpark/vector/search. IRIS
embeds it via %Embedding.OpenAI (native AI Hub provider) and runs the
HNSW-indexed cosine search. We just unpack the JSON.

Failures degrade gracefully to an empty hit list so the agent's reason
step still has a chance to produce something useful.
"""

from __future__ import annotations

from typing import TypedDict

import httpx

from central_park.config import load


class GuidelineHit(TypedDict):
    source: str
    snippet: str
    score: float


def search_guidelines(query: str, k: int = 5) -> list[GuidelineHit]:
    cfg = load()
    auth = (cfg.fhir_user, cfg.fhir_password) if cfg.fhir_user else None
    try:
        resp = httpx.post(
            f"{cfg.iris_rest_base_url}/vector/search",
            json={"query": query, "k": k},
            auth=auth,
            timeout=15.0,
        )
        resp.raise_for_status()
    except Exception:
        return []

    return [
        {"source": h["source"], "snippet": h["snippet"], "score": h["score"]}
        for h in resp.json().get("hits", [])
    ]
