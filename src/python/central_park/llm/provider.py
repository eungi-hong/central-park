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


class AnthropicProvider:
    def __init__(self, api_key: str, model: str) -> None:
        from anthropic import Anthropic

        self._client = Anthropic(api_key=api_key)
        self._model = model

    def complete(self, system: str, messages: list[dict]) -> str:
        resp = self._client.messages.create(
            model=self._model,
            system=system,
            messages=messages,
            max_tokens=2048,
        )
        return resp.content[0].text


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
        return AnthropicProvider(cfg.anthropic_api_key, cfg.anthropic_model)
    if name == "ollama":
        return OllamaProvider(cfg.ollama_base_url, cfg.ollama_model)
    raise ValueError(f"Unknown CP_LLM_PROVIDER: {name!r}. Expected openai | anthropic | ollama.")
