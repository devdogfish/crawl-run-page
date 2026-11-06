"""Test doubles: a FakeGateway (the Gateway seam's second adapter) and a FakeCore with a little data."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

from crawler_ai.core import CoreError
from crawler_ai.gateway import GatewayEvent, TextDelta, ToolCall, ToolCalls
from crawler_ai.models import Crawl, IssueCounts, Page, PageList, Rule, Site


class FakeGateway:
    """Plays back scripted turns: each is a list of events for one stream_chat call. Records what it was sent."""

    def __init__(self, turns: list[list[GatewayEvent]] | None = None, json_answer: dict[str, Any] | None = None):
        self.turns, self.json_answer = list(turns or []), json_answer
        self.seen: list[dict[str, Any]] = []

    async def stream_chat(self, messages, tools=None) -> AsyncIterator[GatewayEvent]:
        self.seen.append({"messages": json.loads(json.dumps(messages)), "tools": tools})
        for ev in self.turns.pop(0):
            yield ev

    async def complete_json(self, messages, schema, timeout=None):
        self.seen.append({"messages": messages, "schema": schema})
        return self.json_answer or {"url": None}


def call(name: str, **args: Any) -> ToolCalls:
    return ToolCalls([ToolCall("x", name, json.dumps(args))])


def say(text: str) -> list[GatewayEvent]:
    return [TextDelta(text)]


PAGE = Page(id=7, site="rbccm", path="/en/insights/2025/ai", url="https://www.rbccm.com/en/insights/2025/ai", title="AI", h1="AI", type="article",
            type_label="Article", http_status=200, change="same", last_changed_crawl=None, issues=IssueCounts(P1=3, P2=2, P3=0, P4=1, total=6),
            by_category={"accessibility": 5}, crawl=811, baseline=810, ui_url="/rbccm/pages/7?crawl=811")


class FakeCore:
    async def list_sites(self):
        return [Site(id="rbccm", name="RBC CM", url="https://www.rbccm.com", qa=False, latest_crawl="811", ui_url="/rbccm/overview")]

    async def find_crawls(self, site, status=None, limit=10):
        return [Crawl(id=i, site=site, status="success", started_at="2026-11-04T02:00:00Z", duration_sec=60, pages=10, error_pct=1.0,
                      trigger="Schedule", ui_url=f"/{site}/crawls/{i}") for i in ("811", "810", "809")]

    async def find_pages(self, site, *a, **kw):
        return PageList(site=site, crawl=811, baseline=810, total=1, pages=[PAGE], next_cursor=None, ui_url=f"/{site}/pages?sort=worst")

    async def list_rules(self, category=None, site=None):
        return [Rule(id="image-alt", title="Image has no text alternative", category="accessibility", severity="critical", priority="P1",
                     source="axe-core", wcag="1.1.1", ui_url="/rbccm/issues/image-alt")]

    async def get_page(self, site, page, crawl=None):
        if page != "7":
            raise CoreError(f"Page {page} isn't in crawl 811.")
        return PAGE

    async def get_crawl(self, site, crawl): raise CoreError("not in fake")
    async def find_issues(self, *a, **k): raise CoreError("not in fake")
    async def find_issues_by_rule(self, *a, **k): raise CoreError("not in fake")
    async def get_issue(self, *a, **k): raise CoreError("not in fake")
    async def get_rule(self, *a, **k): raise CoreError("not in fake")
