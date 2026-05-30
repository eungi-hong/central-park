"""Provider-agnostic LLM adapter.

Three providers ship in iteration 1: OpenAI, Anthropic, Ollama. Each exposes a
single `complete(system, messages) -> str` method. The agent doesn't know
which one is wired in, so swapping is a config change.
"""

from __future__ import annotations

from typing import Protocol

import httpx

from central_park.config import Config, load


class LLMProvider(Protocol):
    def complete(self, system: str, messages: list[dict]) -> str: ...
    def embed(self, texts: list[str]) -> list[list[float]]: ...


# Each provider's embedding model is chosen to match what most users have
# the easiest path to: OpenAI uses text-embedding-3-small (1536-dim), Ollama
# uses nomic-embed-text (768-dim). Anthropic doesn't ship embeddings, so it
# falls back to OpenAI for embedding only (separate key still required).
_OPENAI_EMBED_MODEL = "text-embedding-3-small"
_OLLAMA_EMBED_MODEL = "nomic-embed-text"


class OpenAIProvider:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key)
        self._model = model

    def complete(self, system: str, messages: list[dict]) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[{"role": "system", "content": system}, *messages],
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content or ""

    def embed(self, texts: list[str]) -> list[list[float]]:
        # text-embedding-3-small is natively 1536-dim; request 768 so the
        # vectors are dimension-compatible with the Ollama default and the
        # IRIS Guideline.Embedding column.
        resp = self._client.embeddings.create(
            model=_OPENAI_EMBED_MODEL, input=texts, dimensions=768
        )
        return [d.embedding for d in resp.data]


class AnthropicProvider:
    def __init__(self, api_key: str, model: str, openai_api_key: str | None = None) -> None:
        from anthropic import Anthropic

        self._client = Anthropic(api_key=api_key)
        self._model = model
        # Anthropic has no embedding API. If the user wants embeddings while
        # using Claude for text, they need to provide an OpenAI key too.
        self._openai_key = openai_api_key

    def complete(self, system: str, messages: list[dict]) -> str:
        resp = self._client.messages.create(
            model=self._model,
            system=system,
            messages=messages,
            max_tokens=2048,
        )
        return resp.content[0].text

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self._openai_key:
            raise RuntimeError(
                "Anthropic has no embedding API; set OPENAI_API_KEY for embedding fallback."
            )
        from openai import OpenAI
        client = OpenAI(api_key=self._openai_key)
        resp = client.embeddings.create(
            model=_OPENAI_EMBED_MODEL, input=texts, dimensions=768
        )
        return [d.embedding for d in resp.data]


class OllamaProvider:
    def __init__(self, base_url: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    def complete(self, system: str, messages: list[dict]) -> str:
        resp = httpx.post(
            f"{self._base_url}/api/chat",
            json={
                "model": self._model,
                "messages": [{"role": "system", "content": system}, *messages],
                "stream": False,
                "format": "json",
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]

    def embed(self, texts: list[str]) -> list[list[float]]:
        # keep_alive=0 tells Ollama to unload the embedding model immediately
        # after this call. On memory-constrained hosts that lets the chat
        # model load without contention.
        resp = httpx.post(
            f"{self._base_url}/api/embed",
            json={"model": _OLLAMA_EMBED_MODEL, "input": texts, "keep_alive": 0},
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()["embeddings"]

    def warmup(self) -> None:
        """Issue a tiny chat request so the model is hot before the first
        production triage call. Errors here are swallowed; warmup is best-effort.
        """
        try:
            httpx.post(
                f"{self._base_url}/api/chat",
                json={
                    "model": self._model,
                    "messages": [{"role": "user", "content": "ready?"}],
                    "stream": False,
                    "options": {"num_predict": 4},
                    "keep_alive": "30m",
                },
                timeout=120.0,
            )
        except Exception:
            pass


def get_provider(cfg: Config | None = None) -> LLMProvider:
    cfg = cfg or load()
    name = cfg.llm_provider
    if name == "openai":
        if not cfg.openai_api_key:
            raise RuntimeError("CP_LLM_PROVIDER=openai but OPENAI_API_KEY is unset.")
        return OpenAIProvider(cfg.openai_api_key, cfg.openai_model)
    if name == "anthropic":
        if not cfg.anthropic_api_key:
            raise RuntimeError("CP_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset.")
        return AnthropicProvider(
            cfg.anthropic_api_key, cfg.anthropic_model, openai_api_key=cfg.openai_api_key
        )
    if name == "ollama":
        return OllamaProvider(cfg.ollama_base_url, cfg.ollama_model)
    raise ValueError(f"Unknown CP_LLM_PROVIDER: {name!r}. Expected openai | anthropic | ollama.")
