"""One-shot seed of the guideline corpus into IRIS.

Called from main.py at FastAPI startup. Reads data/guidelines.json and POSTs
the rows (just text — no embeddings) to /centralpark/vector/seed. IRIS
embeds each snippet server-side via %Embedding.OpenAI and persists with the
HNSW vector index. Idempotent on slug, so re-running is safe.

Failures here are logged and swallowed so the agent still boots when the
embedding step has trouble. The vector tool then returns empty results
and the graph continues without retrieved guidelines.
"""

from __future__ import annotations

import json
import logging
import pathlib

import httpx

from central_park.config import load
from central_park.llm import get_provider

log = logging.getLogger("central_park.seed")
_CORPUS_PATH = pathlib.Path(__file__).parent / "data" / "guidelines.json"


def seed_guidelines() -> None:
    cfg = load()
    auth = (cfg.fhir_user, cfg.fhir_password) if cfg.fhir_user else None

    # Refresh IRIS's %Embedding.Config row from the current OPENAI_API_KEY
    # env var. The install hook baked into the image runs at build time with
    # no .env access, so without this call the row keeps its empty placeholder.
    try:
        resp = httpx.post(
            f"{cfg.iris_rest_base_url}/install/embedding-config",
            auth=auth,
            timeout=15.0,
        )
        resp.raise_for_status()
        log.info("Embedding config refresh: %s", resp.json())
    except Exception as e:
        log.warning("Embedding config refresh failed: %s", e)

    if not _CORPUS_PATH.exists():
        log.warning("Guideline corpus not found at %s, skipping seed.", _CORPUS_PATH)
        return

    corpus = json.loads(_CORPUS_PATH.read_text(encoding="utf-8"))
    log.info("Seeding %d guideline snippets into IRIS.", len(corpus))

    payload = [
        {"slug": row["slug"], "source": row["source"], "snippet": row["snippet"]}
        for row in corpus
    ]

    try:
        resp = httpx.post(
            f"{cfg.iris_rest_base_url}/vector/seed",
            json=payload,
            auth=auth,
            timeout=300.0,  # IRIS embeds 30 snippets serially; can take ~30-60s
        )
        resp.raise_for_status()
        log.info("Seed result: %s", resp.json())
    except Exception as e:
        log.warning("Seed POST failed: %s", e)

    # Warm the chat LLM if the provider exposes a warmup. Best-effort.
    try:
        provider = get_provider()
    except Exception as e:
        log.info("Chat provider not configured (%s); skipping warmup.", e)
        return
    if hasattr(provider, "warmup"):
        log.info("Warming up chat model ...")
        try:
            provider.warmup()
            log.info("Chat model warmed.")
        except Exception as e:
            log.info("Warmup skipped: %s", e)
