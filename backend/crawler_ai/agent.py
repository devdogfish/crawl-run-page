"""Ask AI's tool loop: model <-> tools, in-process.

Tool schemas come from the MCP server (the same tools external clients get) and calls go through it, so a tool exists
once. One app-only tool, `navigate`, is added here: it runs the same navigation as Cmd+K (navigation.navigate: the request
in words → one URL validated against url-map.json), or takes an exact ui_url from a tool result, and tells the frontend to go.
`run_agent` yields the dicts that app.py sends as SSE events (see the HTTP contract in the architecture brief).
ON INTEGRATION: nothing to change; the Gateway and the MCP server (Core) are injected.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator

from mcp.server.mcpserver import MCPServer
from mcp.types import TextContent

from crawler_ai.core import FactsCache
from crawler_ai.navigation import describe, navigate
from crawler_ai.gateway import Gateway, GatewayError, Messages, TextDelta, ToolCall, ToolCalls, Tools
from crawler_ai.prompts import SYSTEM_PROMPT
from crawler_ai.url_map import UrlError, UrlMap

log = logging.getLogger("crawler_ai.agent")
MAX_ROUNDS = 6
MAX_RESULT_CHARS = 12_000  # a tool result is read by a model: bounded, and says how to narrow it

NAVIGATE = {
    "type": "function",
    "function": {
        "name": "navigate",
        "description": "Take the user to a place in the app. ONLY when the user explicitly asks to go to, open, show or take them somewhere. "
                       "Describe the destination in `request` with every detail the user gave (e.g. 'new P1 accessibility issues on podcasts'); "
                       "the app turns it into the right view with its filters. If a tool result gave the exact ui_url of what they want "
                       "(one page, one issue), pass it as `url` instead.",
        "parameters": {"type": "object", "properties": {
            "request": {"type": "string", "description": "Where to go, in words, with all the filters the user asked for"},
            "url": {"type": "string", "description": "Optional: an exact ui_url from a tool result"}}, "required": ["request"]},
    },
}


@dataclass
class ToolResult:
    text: str  # what the model sees
    summary: str  # what the user sees under the tool chip
    is_error: bool = False
    navigate: dict[str, str] | None = None


class Toolbox:
    def __init__(self, mcp: MCPServer, url_map: UrlMap, facts: FactsCache, gateway: Gateway, nav_timeout: float):
        self._mcp, self._map, self._facts = mcp, url_map, facts
        self._gateway, self._nav_timeout = gateway, nav_timeout

    async def schemas(self) -> Tools:
        # strict stays off: the MCP-generated schemas don't meet OpenAI's strict-mode rules
        tools = [{"type": "function", "function": {"name": t.name, "description": t.description or "", "parameters": t.input_schema}}
                 for t in await self._mcp.list_tools()]
        return [*tools, NAVIGATE]

    async def call(self, name: str, args: dict[str, Any], context: dict[str, str] | None = None) -> ToolResult:
        if name == "navigate":
            return await self._navigate(args, context or {})
        try:
            res = await self._mcp.call_tool(name, args)
        except Exception as e:  # ToolError (bad arguments, unknown tool, CoreError...) → the model reads it and corrects itself
            msg = str(e)
            return ToolResult(msg, msg[:200], is_error=True)
        data = res.structured_content if res.structured_content is not None else None
        text = json.dumps(data, separators=(",", ":")) if data is not None else "\n".join(c.text for c in res.content if isinstance(c, TextContent))
        if res.is_error:
            return ToolResult(text, text[:200], is_error=True)
        if len(text) > MAX_RESULT_CHARS:
            text = text[:MAX_RESULT_CHARS] + '…[truncated; narrow the query, lower limit or pass next_cursor]'
        return ToolResult(text, _summary(data))

    async def _navigate(self, args: dict[str, Any], context: dict[str, str]) -> ToolResult:
        if args.get("url"):  # an exact ui_url from a tool result
            try:
                v = self._map.validate(str(args["url"]), await self._facts.get())
            except UrlError as e:
                return ToolResult(f"Not navigated: {e}. Describe the destination in `request` instead.", "invalid link", is_error=True)
            url, label = v.url, describe(v)[0]
        else:  # the same path as Cmd+K: words → one validated URL
            try:
                dest = await navigate(str(args.get("request", "")), context, self._gateway, self._map, self._facts, self._nav_timeout)
            except (asyncio.TimeoutError, GatewayError):
                dest = None
            if not dest:
                return ToolResult("Not navigated: no view of the app clearly matches. Tell the user, or offer a link from a tool result.", "no match", is_error=True)
            url, label = dest.url, dest.label
        return ToolResult(f"Navigated the user to {url} ({label}). Reply with one short sentence.", "", navigate={"url": url, "label": label})


def _summary(data: Any) -> str:
    if isinstance(data, dict):
        if "result" in data and isinstance(data["result"], list):
            return f"{len(data['result'])} results"
        if "pages_affected" in data:
            return f"{data['pages_affected']} pages"
        if "issues" in data:
            return f"{len(data['issues'])} issues on the page"
        if "pages" in data and "total" in data:
            return f"{len(data['pages'])} of {data['total']:,} pages"
        if "title" in data:
            return str(data["title"])[:80]
    return "done"


def system_message(context: dict[str, str]) -> str:
    where = f"The user is looking at {context.get('url') or 'the app'} (site: {context.get('site') or 'none selected'})."
    return f"{SYSTEM_PROMPT}\n\n{where}"


async def run_agent(messages: list[dict[str, str]], context: dict[str, str], gateway: Gateway, tools: Toolbox) -> AsyncIterator[dict[str, Any]]:
    convo: Messages = [{"role": "system", "content": system_message(context)}, *messages]
    schemas = await tools.schemas()
    n_calls = 0
    try:
        for round_ in range(MAX_ROUNDS):
            text, calls = "", []
            # the last round has no tools, so the model has to answer with what it has
            async for ev in gateway.stream_chat(convo, schemas if round_ < MAX_ROUNDS - 1 else None):
                if isinstance(ev, TextDelta):
                    text += ev.text
                    yield {"delta": ev.text}
                elif isinstance(ev, ToolCalls):
                    calls = ev.calls
            if not calls:
                return
            numbered: list[tuple[str, ToolCall]] = []
            for c in calls:
                n_calls += 1
                numbered.append((f"call_{n_calls}", c))  # our own ids: unique across rounds whatever the gateway sends
            convo.append({"role": "assistant", "content": text or None, "tool_calls": [
                {"id": i, "type": "function", "function": {"name": c.name, "arguments": c.arguments}} for i, c in numbered]})
            parsed = [(i, c, _args(c)) for i, c in numbered]
            for i, c, a in parsed:
                if c.name != "navigate":
                    yield {"tool": {"id": i, "name": c.name, "args": a or {}, "status": "running"}}
            results = await asyncio.gather(*[_run(tools, c, a, context) for _, c, a in parsed])
            for (i, c, a), r in zip(parsed, results):
                if c.name != "navigate":
                    yield {"tool": {"id": i, "name": c.name, "args": a or {}, "status": "error" if r.is_error else "done", "summary": r.summary}}
                if r.navigate:
                    yield {"navigate": r.navigate}
                convo.append({"role": "tool", "tool_call_id": i, "content": r.text})
        log.warning("agent stopped after %s rounds", MAX_ROUNDS)
    except GatewayError as e:
        yield {"error": str(e)}
    except Exception:  # never leak a stack trace to the panel
        log.exception("agent failed")
        yield {"error": "Something went wrong while answering. Try again."}


def _args(c: ToolCall) -> dict[str, Any] | None:
    try:
        a = json.loads(c.arguments or "{}")
        return a if isinstance(a, dict) else None
    except json.JSONDecodeError:
        return None


async def _run(tools: Toolbox, c: ToolCall, args: dict[str, Any] | None, context: dict[str, str]) -> ToolResult:
    if args is None:
        return ToolResult("The arguments weren't a JSON object. Call the tool again with valid JSON arguments.", "bad arguments", is_error=True)
    return await tools.call(c.name, args, context)
