"""IRIS vector-search tool over a seeded triage-guidelines corpus.

Iteration 1: stub returning an empty list.

Iteration 2 will:
  1. Embed the query with the configured embedding model (likely
     sentence-transformers/all-MiniLM-L6-v2 to keep it offline).
  2. Run a SQL query against IRIS like:
        SELECT TOP ? source, snippet,
               VECTOR_COSINE(embedding, TO_VECTOR(?, double)) AS score
        FROM CentralPark_Data.Guideline
        ORDER BY score DESC
"""

from __future__ import annotations

from typing import TypedDict


class GuidelineHit(TypedDict):
    source: str
    snippet: str
    score: float


def search_guidelines(query: str, k: int = 5) -> list[GuidelineHit]:
    # TODO(iteration-2): real vector search against IRIS.
    _ = query, k
    return []
