"""THE ONLY CODE THAT KNOWS THE AI GATEWAY.

`Gateway` is the seam; adapters: `OpenAIGateway` (production, any OpenAI-compatible chat/completions endpoint) and a
FakeGateway in tests/. Messages and tools use the OpenAI chat format.
ON INTEGRATION: only environment changes (AI_BASE_URL, AI_API_KEY, AI_CHAT_MODEL, AI_NAV_MODEL). If the gateway needs
per-user identity or extra headers, add them in OpenAIGateway.__init__ (default_headers) / the create() calls here.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol

import openai
from openai import AsyncOpenAI

Messages = list[dict[str, Any]]
Tools = list[dict[str, Any]]  # [{"type": "function", "function": {name, description, parameters}}]


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # JSON text, exactly as the model wrote it (may be invalid)


@dataclass
class ToolCalls:
    """All tool calls of one model turn, complete (arguments are fully received)."""

    calls: list[ToolCall]


GatewayEvent = TextDelta | ToolCalls


class GatewayError(Exception):
    """The gateway failed. The message is safe to show the user."""

    def __init__(self, message: str, timeout: bool = False):
        super().__init__(message)
        self.timeout = timeout


class Gateway(Protocol):
    def stream_chat(self, messages: Messages, tools: Tools | None = None) -> AsyncIterator[GatewayEvent]: ...
    async def complete_json(self, messages: Messages, schema: dict[str, Any], timeout: float | None = None) -> dict[str, Any]: ...


class OpenAIGateway:
    def __init__(self, base_url: str, api_key: str, chat_model: str, nav_model: str, chat_timeout: float = 60.0):
        # explicit timeout and one retry, as a gateway can be slow or flaky; streams aren't retried once started
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=chat_timeout, max_retries=1)
        self._chat_model, self._nav_model = chat_model, nav_model

    async def stream_chat(self, messages: Messages, tools: Tools | None = None) -> AsyncIterator[GatewayEvent]:
        acc: dict[int, dict[str, str]] = {}  # tool call index -> id, name, arguments (the API sends them in fragments)
        try:
            stream = await self._client.chat.completions.create(
                model=self._chat_model, messages=messages, stream=True, **({"tools": tools} if tools else {}))  # type: ignore[arg-type]
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    yield TextDelta(delta.content)
                for tc in delta.tool_calls or []:
                    a = acc.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    a["id"] = tc.id or a["id"]
                    if tc.function:
                        a["name"] += tc.function.name or ""
                        a["arguments"] += tc.function.arguments or ""
        except openai.OpenAIError as e:
            raise _friendly(e) from e
        if acc:
            yield ToolCalls([ToolCall(a["id"], a["name"], a["arguments"] or "{}") for _, a in sorted(acc.items())])

    async def complete_json(self, messages: Messages, schema: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
        try:
            r = await self._client.chat.completions.create(
                model=self._nav_model, messages=messages, timeout=timeout,  # type: ignore[arg-type]
                response_format={"type": "json_schema", "json_schema": {"name": "result", "strict": True, "schema": schema}})
        except openai.OpenAIError as e:
            raise _friendly(e) from e
        try:
            return json.loads(r.choices[0].message.content or "")
        except json.JSONDecodeError as e:
            raise GatewayError("The AI service returned an answer I couldn't read.") from e


def _friendly(e: openai.OpenAIError) -> GatewayError:
    if isinstance(e, openai.APITimeoutError):
        return GatewayError("The AI service took too long to answer. Try again.", timeout=True)
    if isinstance(e, openai.APIConnectionError):
        return GatewayError("I can't reach the AI service right now. Try again in a minute.")
    if isinstance(e, openai.RateLimitError):
        return GatewayError("The AI service is busy (rate limit). Try again in a moment.")
    if isinstance(e, openai.AuthenticationError):
        return GatewayError("The AI service rejected our credentials. An administrator needs to check AI_API_KEY.")
    return GatewayError("The AI service returned an error. Try again.")
