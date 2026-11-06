"""The HTTP side: POST /api/chat (SSE), POST /api/navigate, GET /api/assistant/system, and the MCP server at /mcp/.

Every response carries `X-Crawler-AI: 1` so the frontend can tell this backend from "nothing there" (then it falls back
to the scripted answers). Conversations aren't stored: the browser sends the whole thing each time.
ON INTEGRATION: mount `router` into the real FastAPI app (add its auth dependency), build the Core/Gateway from the real
app's config in `create_app`, and call `mcp.session_manager.run()` in the real lifespan. MCP endpoint: /mcp/ (trailing slash).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any, AsyncIterator, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from crawler_ai.agent import Toolbox, run_agent
from crawler_ai.config import Settings, load_settings
from crawler_ai.core import Core, FactsCache, PrototypeCore
from crawler_ai.gateway import Gateway, GatewayError, OpenAIGateway
from crawler_ai.mcp_server import build_mcp
from crawler_ai.navigation import navigate
from crawler_ai.prompts import SYSTEM_PROMPT
from crawler_ai.rule_assistant import RuleFields, RuleReply, PROMPT as RULE_PROMPT
from crawler_ai.url_map import UrlMap

log = logging.getLogger("crawler_ai.app")
MAX_MESSAGES, MAX_CHARS = 40, 60_000


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]  # the system message is the server's alone
    content: str = Field(max_length=20_000)


class Context(BaseModel):
    site: str = Field("", max_length=40)
    url: str = Field("", max_length=500)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    context: Context = Context()


class RuleAssistRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    current: RuleFields


class NavigateRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    context: Context = Context()


class _Marker:
    """Pure ASGI middleware (it doesn't buffer streams): adds X-Crawler-AI to every response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def send_(msg):
            if msg["type"] == "http.response.start":
                msg.setdefault("headers", []).append((b"x-crawler-ai", b"1"))
            await send(msg)
        await self.app(scope, receive, send_ if scope["type"] == "http" else send)


def create_app(settings: Settings | None = None, core: Core | None = None, gateway: Gateway | None = None) -> FastAPI:
    s = settings or load_settings()
    core = core or PrototypeCore(s.proto_url)  # ← integration: the real app's Core
    gateway = gateway or OpenAIGateway(s.ai_base_url, s.ai_api_key, s.ai_chat_model, s.ai_nav_model, s.chat_timeout)
    url_map = UrlMap.load(s.url_map)
    facts = FactsCache(core)
    mcp = build_mcp(core)
    tools = Toolbox(mcp, url_map, facts, gateway, s.nav_timeout)
    # path "/" + mount at /mcp → the endpoint is /mcp/ ; stateless so any worker can answer
    mcp_app = mcp.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async with mcp.session_manager.run():  # a mounted sub-app's own lifespan is not run by Starlette
            yield

    app = FastAPI(title="crawler-ai", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", [])[1:])
        return JSONResponse({"error": f"Invalid request ({where}: {first.get('msg', 'bad value')})."}, status_code=422)

    @app.post("/api/chat")
    async def chat(body: ChatRequest):
        if sum(len(m.content) for m in body.messages) > MAX_CHARS:
            return JSONResponse({"error": "The conversation is too long. Start a new one."}, status_code=413)

        async def events() -> AsyncIterator[str]:
            async for ev in run_agent([m.model_dump() for m in body.messages], body.context.model_dump(), gateway, tools):
                yield f"data: {json.dumps(ev)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.post("/api/navigate")
    async def navigate_(body: NavigateRequest):
        try:
            dest = await navigate(body.query, body.context.model_dump(), gateway, url_map, facts, s.nav_timeout)
        except (asyncio.TimeoutError, GatewayError) as e:
            slow = isinstance(e, asyncio.TimeoutError) or e.timeout
            return JSONResponse({"error": "Search took too long." if slow else str(e)}, status_code=504 if slow else 502)
        except Exception:
            log.exception("navigate failed")
            return JSONResponse({"error": "Search is unavailable right now."}, status_code=502)
        if not dest:
            return {"url": None, "label": "", "chips": []}
        return {"url": dest.url, "label": dest.label, "chips": dest.chips}

    @app.post("/api/rules/assist")
    async def rule_assist(body: RuleAssistRequest):
        if sum(len(m.content) for m in body.messages) > MAX_CHARS:
            return JSONResponse({"error": "The conversation is too long. Reopen the rule dialog to start again."}, status_code=413)
        messages = [{"role": "system", "content": RULE_PROMPT},
                    {"role": "user", "content": "Current form: " + body.current.model_dump_json()},
                    *[m.model_dump() for m in body.messages]]
        try:
            result = await asyncio.wait_for(gateway.complete_json(messages, RuleReply.model_json_schema(), timeout=s.chat_timeout), s.chat_timeout + 1)
            return RuleReply.model_validate(result).model_dump()
        except (asyncio.TimeoutError, GatewayError) as e:
            slow = isinstance(e, asyncio.TimeoutError) or e.timeout
            return JSONResponse({"error": "The AI service took too long. Try again." if slow else str(e)}, status_code=504 if slow else 502)
        except Exception:
            log.exception("rule assistant failed")
            return JSONResponse({"error": "The AI service returned an unusable reply. Try again."}, status_code=502)

    @app.get("/api/assistant/system")
    async def system() -> dict[str, str]:
        return {"prompt": SYSTEM_PROMPT}

    app.mount("/mcp", mcp_app)
    app.state.mcp = mcp
    app.add_middleware(_Marker)
    return app


app = create_app()
