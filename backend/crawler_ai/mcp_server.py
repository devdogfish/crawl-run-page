"""The MCP server ("rbc-crawler"): thin read-only tools over the Core. Parse input, call the core, return its result.

The same tools are used in-process by the Ask AI agent (agent.py), so a tool is written once. No logic lives here:
if a tool grows an `if`, it belongs in the Core. Errors (CoreError) are raised as ToolError with a message that says
what to do next.
ON INTEGRATION: call `build_mcp(RealCore(...))`; HTTP is mounted by app.py at /mcp/ (note the trailing slash).
"""
from __future__ import annotations

from typing import Annotated, Any, Awaitable

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from crawler_ai.core import Core, CoreError
from crawler_ai.models import (Category, Crawl, IssueDetail, IssueList, Page, PageList, Priority, Rule, RuleHits, Site, Status)

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)

SiteId = Annotated[str, Field(description="Site id: rbccm, rbccm-qa, rbcits or rbcits-qa (use list_sites).")]
CrawlRef = Annotated[str | int | None, Field(description="Crawl id. Default: the latest finished crawl.")]
Limit = Annotated[int, Field(ge=1, le=50)]


async def _ok(call: Awaitable[Any]) -> Any:
    try:
        return await call
    except CoreError as e:
        raise ToolError(str(e)) from e


def _crawl(c: str | int | None) -> str | None:
    return None if c in (None, "", "latest") else str(c)


def build_mcp(core: Core) -> MCPServer:
    mcp = MCPServer(
        "rbc-crawler",
        instructions=(
            "Read-only access to the RBC website crawler: sites, crawls, pages, accessibility/SEO/performance/security issues and rules. "
            "Typical flow: find_pages (or find_issues_by_rule) to locate, find_issues for one page's failing HTML, get_rule for how to fix. "
            "Every result has a ui_url: a path in the crawler app to give the user."),
    )

    def tool(title: str):
        return mcp.tool(title=title, annotations=READ_ONLY)

    @tool("List sites")
    async def list_sites() -> list[Site]:
        """List the websites the crawler covers (production and QA copies) with their latest finished crawl. Start here when the site is unknown."""
        return await _ok(core.list_sites())

    @tool("Find crawls")
    async def find_crawls(site: SiteId, status: Annotated[str | None, Field(description="running, paused, success, failed or cancelled")] = None,
                          limit: Limit = 10) -> list[Crawl]:
        """List a site's crawls, newest first: status, start time, pages crawled, error rate. Use for 'why did crawl N fail' or to pick a crawl id."""
        return await _ok(core.find_crawls(site, status, limit))

    @tool("Get crawl")
    async def get_crawl(site: SiteId, crawl: Annotated[str | int, Field(description="Crawl id")]) -> Crawl:
        """Details of one crawl of a site."""
        return await _ok(core.get_crawl(site, str(crawl)))

    @tool("Find pages")
    async def find_pages(
        site: SiteId,
        q: Annotated[str | None, Field(description="Text to find in the page path or title")] = None,
        type: Annotated[str | None, Field(description="article, research, news, podcast, video, event, people or other")] = None,
        year: Annotated[str | None, Field(description="Year in the URL, e.g. 2025, or 'none'")] = None,
        change: Annotated[str | None, Field(description="new, changed or removed since the previous finished crawl")] = None,
        sort: Annotated[str | None, Field(description="worst (default: most issues, critical weighted), p1 (most P1 issues first), changed (recently changed) or path")] = None,
        category: Annotated[Category | None, Field(description="With sort=worst: rank by this category only")] = None,
        crawl: CrawlRef = None, limit: Limit = 20,
        cursor: Annotated[str | None, Field(description="next_cursor from the previous result")] = None,
    ) -> PageList:
        """Find and rank pages of a site, each with its issue counts by priority (P1 critical, P2 serious, P3 moderate, P4 minor). Use for 'which pages have the most P1 issues', 'what's new'. Returns at most `limit` pages and a next_cursor."""
        return await _ok(core.find_pages(site, q, type, year, change, sort, category, _crawl(crawl), limit, cursor))

    @tool("Get page")
    async def get_page(site: SiteId, page: Annotated[str, Field(description="Page id, full URL or path (e.g. /en/insights/2025/ai)")], crawl: CrawlRef = None) -> Page:
        """One page: title, type, change since the previous crawl and issue counts. Accepts an id, a full URL or a path."""
        return await _ok(core.get_page(site, str(page), _crawl(crawl)))

    @tool("Find issues on a page")
    async def find_issues(
        site: SiteId, page: Annotated[str, Field(description="Page id, full URL or path")],
        crawl: CrawlRef = None, priority: list[Priority] | None = None, category: list[Category] | None = None, status: Status | None = None,
    ) -> IssueList:
        """List the issues on one page, grouped by rule, worst first. Each issue has its elements (selector, failing HTML, whether the markup is shared by other pages) and how to fix it. Use before fixing a page."""
        return await _ok(core.find_issues(site, str(page), _crawl(crawl), priority, category, status))

    @tool("Find where a rule fails")
    async def find_issues_by_rule(site: SiteId, rule: Annotated[str, Field(description="Rule id, e.g. image-alt (use list_rules)")], crawl: CrawlRef = None,
                                  limit: Limit = 15, cursor: str | None = None) -> RuleHits:
        """Where one rule fails across a whole site: affected pages (most elements first), the repeated element patterns, and whether the markup is shared across pages (one fix in the template)."""
        return await _ok(core.find_issues_by_rule(site, rule, _crawl(crawl), limit, cursor))

    @tool("Get issue")
    async def get_issue(element_id: Annotated[str, Field(description="An element id: from an @issue:ID reference in the conversation, or from find_issues / find_issues_by_rule")]) -> IssueDetail:
        """The issue one element belongs to, that element first: the page, the failing HTML and selector, why it matters and how to fix it. Call it for every @issue:ID the user asks about. Never guess ids."""
        return await _ok(core.get_issue(element_id))

    @tool("List rules")
    async def list_rules(category: Category | None = None, site: str | None = None) -> list[Rule]:
        """The rule catalog (id, title, category, severity, priority, WCAG criterion). Use get_rule for why it matters and how to fix."""
        return await _ok(core.list_rules(category, site))

    @tool("Get rule")
    async def get_rule(rule: Annotated[str, Field(description="Rule id, e.g. color-contrast")], site: str | None = None) -> Rule:
        """One rule in full: why it matters, how to fix it, references."""
        return await _ok(core.get_rule(rule, site))

    @mcp.prompt(title="Fix an issue")
    async def fix_issue(element_id: str) -> str:
        """Fix one issue: the same hand-off the app's 'Fix with AI' button gives."""
        i = await _ok(core.get_issue(element_id))
        e = i.elements[0]
        return "\n".join([
            f"Fix this accessibility/SEO issue found by the RBC crawler.", "",
            f"Page: {i.page_path} (page {i.page}, crawl {i.crawl})",
            f"Rule: {i.rule}{f' (WCAG {i.wcag})' if i.wcag else ''}: {i.title}",
            f"Priority: {i.priority}", f"Element: {e.selector}",
            f"Shared markup: the same HTML is on {e.shared_pages} pages; fix it once in the shared component." if e.shared_pages else "Only on this page.",
            "", "Failing HTML:", e.html, "", f"How to fix: {i.how_to_fix}", f"Open in the app: {e.ui_url}",
        ])

    return mcp
