"""What the Core returns and the MCP tools / chat see. Shapes follow docs/pages-and-issues.md §2 (snake_case JSON).

Every result carries `ui_url`: a path inside the app (as the app builds links), so a model can hand the user a link.
ON INTEGRATION: keep these; the real Core's dataclasses should serialise to the same fields.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Priority = Literal["P1", "P2", "P3", "P4"]
Category = Literal["accessibility", "performance", "seo", "security"]
Status = Literal["new", "existing", "fixed"]
PageType = Literal["article", "research", "news", "podcast", "video", "event", "people", "other"]


class Site(BaseModel):
    id: str
    name: str
    url: str
    qa: bool  # a QA copy: minimal content, only compared with itself
    latest_crawl: str | None
    ui_url: str


class Crawl(BaseModel):
    id: str
    site: str
    status: Literal["running", "paused", "success", "failed", "cancelled"]
    started_at: str
    duration_sec: int
    pages: int
    error_pct: float
    trigger: str
    progress_pct: float | None = None
    ui_url: str


class IssueCounts(BaseModel):
    P1: int
    P2: int
    P3: int
    P4: int
    total: int


class Page(BaseModel):
    id: int
    site: str
    path: str
    url: str
    title: str
    h1: str
    type: PageType
    type_label: str
    http_status: int
    change: Literal["new", "changed", "removed", "same"] | None  # against the baseline crawl
    last_changed_crawl: int | None
    issues: IssueCounts | None  # None for a page removed from this crawl
    by_category: dict[str, int | None] | None  # performance is null when Lighthouse skipped the page
    crawl: int
    baseline: int | None
    year: str | None = None
    ui_url: str


class PageList(BaseModel):
    site: str
    crawl: int
    baseline: int | None
    total: int
    pages: list[Page]
    next_cursor: str | None
    ui_url: str  # the Pages view with these filters


class Element(BaseModel):
    id: str  # pass to get_issue; the app resolves it too
    selector: str
    html: str
    status: Status
    first_seen: int  # crawl id
    shared_pages: int | None  # same markup on this many pages (fix once in the template); None = only this page
    ui_url: str


class Reference(BaseModel):
    label: str
    url: str


class Issue(BaseModel):
    """One rule failing on one page, with its elements (capped; `elements_total` is the real count)."""

    page: int
    page_path: str
    crawl: int
    rule: str
    title: str
    priority: Priority
    severity: str
    category: Category
    wcag: str | None
    how_to_fix: str
    references: list[Reference]
    elements_total: int
    elements: list[Element]
    ui_url: str


class IssueList(BaseModel):
    site: str
    page: int
    page_path: str
    crawl: int
    baseline: int | None
    total_elements: int
    issues: list[Issue]
    ui_url: str


class Rule(BaseModel):
    id: str
    title: str
    category: Category
    severity: str
    priority: Priority
    source: str
    wcag: str | None
    why: str | None = None  # only on get_rule
    how_to_fix: str | None = None
    references: list[Reference] | None = None
    ui_url: str


class RulePattern(BaseModel):
    pattern: str  # selector pattern, e.g. "footer .legal a"
    shared: bool
    pages: int
    elements: int


class RulePage(BaseModel):
    page: int
    path: str
    elements: int
    new_elements: int
    example_element: str  # an element id for get_issue
    ui_url: str


class RuleHits(BaseModel):
    """Where one rule fails across a whole site."""

    site: str
    crawl: int
    baseline: int | None
    rule: Rule
    pages_affected: int
    elements: int
    patterns: list[RulePattern]
    pages: list[RulePage]
    next_cursor: str | None
    ui_url: str


class IssueDetail(Issue):
    """get_issue: the issue the element belongs to, that element first."""

    site: str
