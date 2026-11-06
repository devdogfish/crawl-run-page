"""The read model the AI layer needs: what the real app's core already provides.

`Core` is the seam. `PrototypeCore` is the DEV adapter: it calls the prototype's data over HTTP
(POST {PROTO_URL}/<method>, served by Vite from src/lib/proto-api.ts).
ON INTEGRATION: write `class RealCore(Core)` over the app's own core/database (same method names and the models in
models.py) and pass it where `PrototypeCore` is built (app.create_app, __main__.py). Delete PrototypeCore and proto-api.ts.
"""
from __future__ import annotations

import time
from typing import Any, Protocol

import httpx

from crawler_ai.models import (Crawl, IssueDetail, IssueList, Page, PageList, Rule, RuleHits, Site)
from crawler_ai.url_map import Facts


class CoreError(Exception):
    """Something the caller can fix ("Page X isn't in crawl 811…"). The message goes back to the model."""


class Core(Protocol):
    async def list_sites(self) -> list[Site]: ...
    async def find_crawls(self, site: str, status: str | None = None, limit: int = 10) -> list[Crawl]: ...
    async def get_crawl(self, site: str, crawl: str) -> Crawl: ...
    async def find_pages(self, site: str, q: str | None = None, type: str | None = None, year: str | None = None,
                         change: str | None = None, sort: str | None = None, category: str | None = None,
                         crawl: str | None = None, limit: int = 20, cursor: str | None = None) -> PageList: ...
    async def get_page(self, site: str, page: str, crawl: str | None = None) -> Page: ...
    async def find_issues(self, site: str, page: str, crawl: str | None = None, priority: list[str] | None = None,
                          category: list[str] | None = None, status: str | None = None) -> IssueList: ...
    async def find_issues_by_rule(self, site: str, rule: str, crawl: str | None = None, limit: int = 15,
                                  cursor: str | None = None) -> RuleHits: ...
    async def get_issue(self, element_id: str) -> IssueDetail: ...
    async def list_rules(self, category: str | None = None, site: str | None = None) -> list[Rule]: ...
    async def get_rule(self, rule: str, site: str | None = None) -> Rule: ...


class PrototypeCore:
    def __init__(self, proto_url: str, client: httpx.AsyncClient | None = None):
        self._url = proto_url.rstrip("/")
        self._http = client or httpx.AsyncClient(timeout=60)

    async def _call(self, fn: str, **args: Any) -> Any:
        body = {k: v for k, v in args.items() if v is not None}
        try:
            r = await self._http.post(f"{self._url}/{fn}", json=body)
        except httpx.HTTPError as e:
            raise CoreError(f"The prototype data server isn't reachable at {self._url} ({type(e).__name__}). Start it with `pnpm dev`.") from e
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code != 200:
            raise CoreError(data.get("error") or f"Data server answered {r.status_code} for {fn}.")
        return data

    async def list_sites(self) -> list[Site]:
        return [Site.model_validate(x) for x in await self._call("list_sites")]

    async def find_crawls(self, site, status=None, limit=10):
        return [Crawl.model_validate(x) for x in await self._call("find_crawls", site=site, status=status, limit=limit)]

    async def get_crawl(self, site, crawl):
        return Crawl.model_validate(await self._call("get_crawl", site=site, crawl=crawl))

    async def find_pages(self, site, q=None, type=None, year=None, change=None, sort=None, category=None, crawl=None, limit=20, cursor=None):
        return PageList.model_validate(await self._call("find_pages", site=site, q=q, type=type, year=year, change=change, sort=sort,
                                                        category=category, crawl=crawl, limit=limit, cursor=cursor))

    async def get_page(self, site, page, crawl=None):
        return Page.model_validate(await self._call("get_page", site=site, page=page, crawl=crawl))

    async def find_issues(self, site, page, crawl=None, priority=None, category=None, status=None):
        return IssueList.model_validate(await self._call("find_issues", site=site, page=page, crawl=crawl, priority=priority,
                                                         category=category, status=status))

    async def find_issues_by_rule(self, site, rule, crawl=None, limit=15, cursor=None):
        return RuleHits.model_validate(await self._call("find_issues_by_rule", site=site, rule=rule, crawl=crawl, limit=limit, cursor=cursor))

    async def get_issue(self, element_id):
        return IssueDetail.model_validate(await self._call("get_issue", element_id=element_id))

    async def list_rules(self, category=None, site=None):
        return [Rule.model_validate(x) for x in await self._call("list_rules", category=category, site=site)]

    async def get_rule(self, rule, site=None):
        return Rule.model_validate(await self._call("get_rule", rule=rule, site=site))


class FactsCache:
    """Crawl ids and rule ids for URL validation, refreshed at most every `ttl` seconds."""

    def __init__(self, core: Core, ttl: float = 30):
        self._core, self._ttl, self._at, self._facts = core, ttl, 0.0, Facts()

    async def get(self) -> Facts:
        if time.monotonic() - self._at > self._ttl:
            sites = await self._core.list_sites()
            by_site = {s.id: await self._core.find_crawls(s.id, limit=50) for s in sites}
            crawls = {k: [c.id for c in v] for k, v in by_site.items()}
            finished = {k: [c.id for c in v if c.status == "success"] for k, v in by_site.items()}
            rules = {r.id for r in await self._core.list_rules()}
            self._facts, self._at = Facts(crawls, finished, rules), time.monotonic()
        return self._facts
