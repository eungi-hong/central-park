"""Runtime configuration, populated from environment variables.

Centralising config here means the rest of the package never reads os.environ
directly, which makes tests easier (monkeypatch one object) and the surface
of "what knobs exist" visible in one file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    llm_provider: str
    openai_api_key: str | None
    openai_model: str
    anthropic_api_key: str | None
    anthropic_model: str
    ollama_base_url: str
    ollama_model: str
    fhir_base_url: str
    fhir_user: str | None
    fhir_password: str | None
    iris_rest_base_url: str


def load() -> Config:
    return Config(
        # OpenAI is the default so the chat LLM call is reliable. IRIS handles
        # embeddings natively via %Embedding.OpenAI (AI Hub), so the sidecar
        # only does chat. Switch to anthropic by setting CP_LLM_PROVIDER and
        # ANTHROPIC_API_KEY. Ollama is supported but experimental on ARM64.
        llm_provider=os.environ.get("CP_LLM_PROVIDER", "openai").lower(),
        openai_api_key=os.environ.get("OPENAI_API_KEY"),
        openai_model=os.environ.get("CP_OPENAI_MODEL", "gpt-4o-mini"),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY"),
        anthropic_model=os.environ.get("CP_ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
        ollama_base_url=os.environ.get("CP_OLLAMA_BASE_URL", "http://host.docker.internal:11434"),
        ollama_model=os.environ.get("CP_OLLAMA_MODEL", "llama3.2:3b"),
        fhir_base_url=os.environ.get(
            "CP_FHIR_BASE_URL",
            "http://localhost:52773/csp/healthshare/centralpark/fhir/r4",
        ),
        fhir_user=os.environ.get("CP_FHIR_USER"),
        fhir_password=os.environ.get("CP_FHIR_PASSWORD"),
        iris_rest_base_url=os.environ.get(
            "CP_IRIS_REST_BASE_URL",
            "http://iris:52773/centralpark",
        ),
    )
