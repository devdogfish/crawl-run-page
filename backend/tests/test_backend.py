import contextlib
import json
from pathlib import Path

import httpx
import pytest

from crawler_ai.agent import Toolbox, run_agent
from crawler_ai.config import Settings
from crawler_ai.core import FactsCache
from crawler_ai.mcp_server import build_mcp
from crawler_ai.url_map import Facts, UrlError, UrlMap
from crawler_ai.app import create_app
from fakes import FakeCore, FakeGateway, call, say

MAP = UrlMap.load(Path(__file__).resolve().parents[2] / "url-map.json")
FACTS = Facts(crawls={"rbccm": ["812", "811", "810"]}, finished={"rbccm": ["811", "810"]}, rules={"image-alt"})


# ───────── url map ─────────
def test_valid_url_is_canonical_and_drops_defaults():
    v = MAP.validate("/rbccm/issues?sort=priority&cat=accessibility&pri=P1", FACTS)
    assert v.url == "/rbccm/issues?cat=accessibility&pri=P1" and v.route["id"] == "issues"


@pytest.mark.parametrize("url", [
    "https://evil.example/rbccm/issues", "//evil.example", "/nosite/issues", "/rbccm/issues?pri=P9", "/rbccm/issues?bogus=1",
    "/rbccm/issues/not-a-rule", "/rbccm/crawls/999", "/rbccm/pages/abc", "/rbccm/nothing",
])
def test_invalid_urls_are_rejected(url):
    with pytest.raises(UrlError):
        MAP.validate(url, FACTS)


def test_path_params_and_lists():
    assert MAP.validate("/rbccm/issues/image-alt?seg=new", FACTS).url == "/rbccm/issues/image-alt?seg=new"
    assert MAP.validate("/rbccm/pages/7?pri=P1,P2&crawl=811", FACTS).params == {"crawl": "811", "pri": "P1,P2"}
    assert MAP.validate("/", FACTS).route["id"] == "home"


# ───────── MCP tools ─────────
async def test_mcp_tools_registered_read_only_and_return_core_results():
    mcp = build_mcp(FakeCore())
    tools = {t.name: t for t in await mcp.list_tools()}
    assert {"list_sites", "find_crawls", "find_pages", "get_page", "find_issues", "find_issues_by_rule", "get_issue", "list_rules", "get_rule"} <= set(tools)
    assert all(t.annotations and t.annotations.read_only_hint for t in tools.values())
    res = await mcp.call_tool("find_pages", {"site": "rbccm", "sort": "p1"})
    assert res.structured_content["pages"][0]["issues"]["P1"] == 3
    assert [p.name for p in await mcp.list_prompts()] == ["fix_issue"]


# ───────── agent loop ─────────
def toolbox(gw):
    core = FakeCore()
    return Toolbox(build_mcp(core), MAP, FactsCache(core), gw, 5)


async def collect(gw, text="Which pages have the most P1 issues?"):
    return [e async for e in run_agent([{"role": "user", "content": text}], {"site": "rbccm", "url": "/rbccm/pages"}, gw, toolbox(gw))]


async def test_agent_calls_a_tool_then_answers():
    gw = FakeGateway([[call("find_pages", site="rbccm", sort="p1")], say("It is @page:7.")])
    events = await collect(gw)
    tool = [e["tool"] for e in events if "tool" in e]
    assert [t["status"] for t in tool] == ["running", "done"] and tool[0]["id"] == "call_1" and tool[1]["summary"] == "1 of 1 pages"
    assert "".join(e["delta"] for e in events if "delta" in e) == "It is @page:7."
    second = gw.seen[1]["messages"]
    assert second[0]["role"] == "system" and "The user is looking at /rbccm/pages" in second[0]["content"]
    assert second[-1]["role"] == "tool" and '"P1":3' in second[-1]["content"]


async def test_tool_errors_reach_the_model_and_the_panel():
    gw = FakeGateway([[call("get_page", site="rbccm", page="999")], say("Sorry.")])
    events = await collect(gw)
    assert [e["tool"]["status"] for e in events if "tool" in e] == ["running", "error"]
    assert "isn't in crawl 811" in gw.seen[1]["messages"][-1]["content"]


async def test_navigate_uses_the_search_navigation_and_is_validated():
    # the request in words goes through navigation.navigate (the Cmd+K path), so filters like "new" survive
    gw = FakeGateway([[call("navigate", request="new P1 accessibility issues")], say("Opening.")],
                     json_answer={"url": "/rbccm/issues?pri=P1&cat=accessibility&seg=new"})
    events = await collect(gw, "take me to the new P1 accessibility issues")
    nav = [e["navigate"] for e in events if "navigate" in e]
    assert nav and nav[0]["url"] == "/rbccm/issues?cat=accessibility&pri=P1&seg=new"
    # an exact ui_url is validated; anything else is refused and the model is told
    gw = FakeGateway([[call("navigate", request="x", url="https://evil.example")], say("No.")])
    assert not any("navigate" in e for e in await collect(gw))
    assert "Not navigated" in gw.seen[1]["messages"][-1]["content"]


# ───────── HTTP ─────────
@contextlib.asynccontextmanager
async def serve():  # not a fixture: the MCP session manager's task group must start and stop in one task
    gw = FakeGateway([[call("list_sites")], say("Hi")], json_answer={"url": "/rbccm/issues?pri=P1&cat=accessibility&seg=new"})
    app = create_app(Settings(), FakeCore(), gw)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as c:
            yield c


async def test_routes():
    async with serve() as client:
        r = await client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}], "context": {"site": "rbccm", "url": "/"}})
        assert r.headers["x-crawler-ai"] == "1" and r.text.rstrip().endswith("data: [DONE]")
        assert (await client.post("/api/chat", json={"messages": [{"role": "system", "content": "x"}]})).status_code == 422
        r = await client.post("/api/navigate", json={"query": "new P1 accessibility issues", "context": {"site": "rbccm", "url": "/"}})
        body = r.json()
        assert body["url"] == "/rbccm/issues?cat=accessibility&pri=P1&seg=new"
        assert [c["label"] for c in body["chips"]] == ["Accessibility", "P1", "New"] or {c["value"] for c in body["chips"]} >= {"P1", "new"}
        r = await client.get("/api/assistant/system")
        assert "Teamsite" in r.json()["prompt"] and r.headers["x-crawler-ai"] == "1"


async def test_mcp_over_http():
    async with serve() as client:
        h = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        r = await client.post("/mcp/", headers=h, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
        assert r.status_code == 200 and "find_pages" in r.text


async def test_rule_assistant_partial_fields_and_followup():
    fields = dict(name=None, pattern="old\\.example", scope="attributes", when=None, regex=True, matchCase=None, description=None)
    gw = FakeGateway(json_answer={"fields": fields, "message": "Flag found or missing links?"})
    app = create_app(Settings(), FakeCore(), gw)
    current = dict(name="", pattern="", scope="content", when="found", regex=False, matchCase=False, description="")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        messages = [{"role": "user", "content": "Find links to old.example"}]
        r = await c.post("/api/rules/assist", json={"messages": messages, "current": current})
        assert r.status_code == 200 and r.json()["fields"] == fields
        messages += [{"role": "assistant", "content": r.json()["message"]}, {"role": "user", "content": "Found"}]
        gw.json_answer = {"fields": {**fields, "when": "found"}, "message": "What name should this rule have?"}
        r = await c.post("/api/rules/assist", json={"messages": messages, "current": current})
        assert r.status_code == 200 and r.json()["fields"]["when"] == "found"
        assert gw.seen[-1]["messages"][-3:] == messages
        gw.json_answer = {"fields": {**fields, "scope": "invalid"}, "message": "Done"}
        assert (await c.post("/api/rules/assist", json={"messages": messages, "current": current})).status_code == 502


async def test_chat_creates_validated_rule_event_and_edit_reference():
    fields = dict(name="Old links", pattern="old\\.example", scope="attributes", when="found", regex=True, matchCase=False, description="Find old links")
    gw = FakeGateway([[call("create_rule", **fields)], say("Ready to edit.")])
    events = await collect(gw, "Create an old links rule")
    created = [e["create_rule"] for e in events if "create_rule" in e]
    assert len(created) == 1
    assert created[0]["site"] == "rbccm" and created[0]["pattern"] == fields["pattern"]
    assert "@rule:" + created[0]["id"] in gw.seen[1]["messages"][-1]["content"]
    gw = FakeGateway([[call("create_rule", name="Missing details")], say("Where should I look?")])
    events = await collect(gw)
    assert not any("create_rule" in e for e in events)
    assert any(e.get("tool", {}).get("status") == "error" for e in events)
