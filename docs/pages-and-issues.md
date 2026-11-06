# Pages and issues: the read side

How to build the part of the backend behind the Pages page, the page detail and the Issues page: the read-model core, its storage, element ids and the REST routes. The AI (Cmd+K search, Ask AI and the MCP server) sits on top of this core through the tools described in [ai.md](ai.md).
The crawl run page backend (logs, metrics, steps) is in [SPEC.md](../SPEC.md) §4 to §6; this document adds what comes after it.
Words like **issue**, **element**, **shared markup** and **baseline** are defined in [CONTEXT.md](../CONTEXT.md).

Status: proposal. Nothing here is built yet. Build order is at the end; the tickets are in [PLAN.md](../PLAN.md) (T2.2 to T2.5).

This lives inside the existing v2 backend ([ADR 0001](adr/0001-extend-v2-backend.md)): the database is its `intelligence.db`, and every new route is under `/api/v3`, like the crawl run page's. The package and file names below are a proposed layout for the new read side, not the backend's current one.

---

## 1. The shape in one picture

```
                     React UI                          Claude Code / Desktop / any MCP client
               │                     │                               │
          HTTP (JSON)        POST /api/v3/chat (SSE)        stdio  or  Streamable HTTP (/mcp)
               │                     │                               │
      ┌────────▼────────┐   ┌────────▼────────┐             ┌────────▼────────┐
      │  api/  (FastAPI │   │ assistant/      │             │  mcp/  (FastMCP │   ← thin adapters:
      │  routers)       │   │ (chat, seeds)   │             │  tools, prompt) │     parse input, call core, shape output
      └────────┬────────┘   └───┬─────────┬───┘             └────────┬────────┘
               └────────────────┼─────────┼──────────────────────────┘
                     ┌──────────▼──────┐  │
                     │      core       │  │                ← the deep part: all the logic
                     │ pages · issues  │  │
                     │ rules · handoff │  └──► gateway.py ──► corporate AI gateway
                     └────────┬────────┘                     (the only code that knows it)
                              │ sqlite3
                     ┌────────▼────────┐
                     │ intelligence.db │                   ← written by the crawl, and by `analyze` (PLAN.md T2.2, T2.3)
                     └─────────────────┘
```

The one rule: **the REST API, the assistant and the MCP server are siblings, all calling the same core functions in-process.**
The MCP server does not call the REST API over HTTP. That would add a network hop, a second serialisation and a second set of error cases for no gain, because both run in the same Python process (or can open the same SQLite file).

Why this shape (in the vocabulary of deep modules):
- **The core is the deep module.** A small interface (four or five functions) hides the real work: comparing a crawl with its baseline, grouping elements into issues, working out new and fixed, priority, shared markup, filtering, paging.
- **The interface between core and transport is a real seam.** It has three adapters (FastAPI, the assistant and MCP) and a fourth later (the local check CLI). Logic that lives in an adapter would have to be written twice. Deletion test: delete `core/issues.py` and the same SQL and grouping logic reappears in a router, a tool and the exporter.
- **No repository port in front of SQLite.** SQLite runs in-process and tests can use a real database file, so the core takes a `sqlite3.Connection` directly. A `Repository` interface with one implementation would be indirection without a second adapter to justify it.

---

## 2. Folder layout

```
backend/
  pyproject.toml                 # fastapi, uvicorn, mcp (pin versions), pytest
  crawler_api/
    db.py                        # connect(path) -> sqlite3.Connection (WAL, row factory, read-only option)
    core/
      rules.py                   # the rule catalog: id, title, severity, category, wcag, why, how_to_fix, references
      pages.py                   # find_pages(...), get_page(...)
      issues.py                  # find_issues(...), get_issue(...)
      handoff.py                 # prompt text for issues and pages (copy, Ask AI, MCP prompt), as_json(issues), ui_url(...)
      models.py                  # dataclasses / pydantic models returned by core (Page, Issue, Element, PageList)
    api/
      app.py                     # FastAPI app: routers + mounts the MCP server at /mcp
      crawls.py                  # SPEC §6 routes (already specced)
      pages.py                   # GET /api/v3/sites/{site}/pages, GET /api/v3/pages/{id}
      issues.py                  # GET /api/v3/pages/{id}/issues, GET /api/v3/issues/{id}
    assistant/
      routes.py                  # POST /api/v3/chat, GET /api/v3/assistant/seed, GET /api/v3/assistant/system
      prompts.py                 # SYSTEM_PROMPT: the reference and fix format the frontend parses
      gateway.py                 # the corporate gateway; see ai.md §6
      fake_gateway.py            # canned answers for tests and local dev without gateway access
    mcp/
      server.py                  # FastMCP instance + tool and prompt definitions (thin)
      __main__.py                # `python -m crawler_api.mcp` → stdio
  tests/
    conftest.py                  # builds a temp intelligence.db with two crawls of a few pages
    test_pages.py                # through core.pages' interface
    test_issues.py               # through core.issues' interface
    test_mcp.py                  # tools end to end (in-process client); see ai.md §4.6
    test_assistant.py            # chat and navigate routes with the fake gateway
```

The capture side (the v2 `Crawl` and its stores, plus the `analyze` steps T2.2 and T2.3) writes `intelligence.db`; this read side only reads it. That keeps the two independent: the read side can be built and tested with a seeded database before a crawl records issues.

---

## 3. The core interface

This is everything a caller needs. Keep it this small; resist adding one function per screen.

```python
# core/pages.py
def find_pages(db, site: str, crawl: int, baseline: int | None = None, *,
               q: str = "", page_type: str | None = None, year: int | None = None,
               rule: str | None = None, links_to: str | None = None,
               change: Literal["new", "changed", "removed"] | None = None,
               sort: Literal["worst", "changed", "path", "matches"] = "worst",
               category: str | None = None,          # with sort="worst": rank by this category
               cursor: str | None = None, limit: int = 50) -> PageList: ...

def get_page(db, page: int | str, crawl: int | Literal["latest"]) -> Page | None: ...
#                 ^ id or URL (full or path); the core normalises it

# core/issues.py
def find_issues(db, page: int | str, crawl: int | Literal["latest"], baseline: int | None = None, *,
                priority: list[str] = [], category: list[str] = [],
                status: Literal["new", "existing", "fixed"] | None = None,
                q: str = "", shared: bool | None = None) -> list[Issue]: ...

def get_issue(db, element_id: str, crawl: int | Literal["latest"] = "latest") -> Issue | None: ...
#                  ^ one element's id (see "Ids" below); returns its issue with that element first
```

```python
# core/models.py (shape; the routes and MCP tools return these, serialised as JSON)
@dataclass
class Element:
    id: str                 # stable across crawls, see "Ids" below
    selector: str
    html: str
    status: Literal["new", "existing", "fixed"]
    first_seen: int         # crawl id
    shared_pages: int | None   # None = only on this page

@dataclass
class Issue:
    page: int
    crawl: int
    rule: str
    title: str
    priority: str           # P1..P4, from severity (fixed)
    severity: str
    category: str
    wcag: str | None
    how_to_fix: str
    references: list[str]
    elements: list[Element]
    ui_url: str             # deep link to the page detail with the element selected
```

**Ids.** Links, Ask AI's `@issue:ID` references and component blocks, and MCP results all name **one element**, so an element's id must:
- **survive new crawls.** A link shared today still opens next month, and shows the element as fixed once it's gone. So no crawl number in it.
- **resolve on its own.** Everything a chip or fix card shows (page, rule, original HTML, links to Issues / Preview / Source) comes from the id, wherever in the app it appears.

Make it a short hash of the element identity T2.3 already defines, `(page, rule, selector, html_hash)`, stored as a column on `element` and indexed. The crawl is a separate, optional parameter (`latest` by default). An issue doesn't need an id of its own: it's `(page, rule)` in a crawl, and any of its elements leads to it.

The prototype still selects by position in the list (`?issue=18`) behind `resolveIssue` in `src/lib/refs.ts`; swapping that for this id is a change in that one file plus the page detail's URL handling.

**What the tool states, and what it doesn't.**
- **Priority** is fixed per severity, not configurable: Critical P1, Serious P2, Moderate P3, Minor P4.
- **Where to fix** isn't inferred. TeamSite's HTML doesn't reliably say who owns an element or which content field it came from ([research/teamsite-cms-traces.md](../research/teamsite-cms-traces.md)), and the preview shows where it is. What the tool states is deterministic: the selector, and "same markup on N pages" from the HTML hash (one fix covers all of them).
- **Assets aren't stored** ([ADR 0002](adr/0002-live-render-only-preview.md)). The preview streams images, video and fonts from the crawled site, with a neutral placeholder naming the file when one no longer loads. The Source view and issue snippets keep the original markup.

**Exports** (Issues tab → Export): Summarize with AI, copy as one prompt (from `core/handoff.py`), download JSON (the `Issue` shape above), copy the API request, copy a link to the view. The API serves the same with `?format=prompt|json`.

What the core hides (and therefore what its tests cover):
- **Resolving inputs:** page by id, path or full URL; `crawl="latest"` → newest finished crawl of that site (QA copies are their own sites).
- **Comparing with the baseline:** element identity is `(page, rule, selector, html_hash)`. New = in crawl, not in baseline. Fixed = in baseline, not in crawl. Same key for page change detection with `content_hash`.
- **Grouping:** elements → issues by rule; issues sorted by severity, then element count.
- **Priority:** `{"critical": "P1", "serious": "P2", "moderate": "P3", "minor": "P4"}`, in `rules.py`, not configurable.
- **Shared markup:** `shared_pages` = how many pages in the same crawl have the same `html_hash` for that rule.
- **Paging:** keyset cursors (opaque strings), never offsets, so the MCP tool and the UI page the same way.

---

## 4. Storage additions

These tables go into `intelligence.db`, written by the `analyze` steps (PLAN.md T2.2, T2.3); the read side reads them. No screenshots or element boxes ([ADR 0002](adr/0002-live-render-only-preview.md)): the preview finds an element by its selector in the live render.

```sql
CREATE TABLE page (                 -- one row per page of a site, stable across crawls
  id        INTEGER PRIMARY KEY,
  site      TEXT NOT NULL,
  path      TEXT NOT NULL,          -- normalised: no query, no trailing slash
  UNIQUE (site, path)
);

CREATE TABLE snapshot (             -- what one crawl saw on one page
  crawl_id      INTEGER NOT NULL,
  page_id       INTEGER NOT NULL,
  status        INTEGER,
  title         TEXT, h1 TEXT,
  content_hash  TEXT,               -- of the main content, so "changed" ignores tracking params and timestamps
  page_type     TEXT,               -- from the path prefix rules
  PRIMARY KEY (crawl_id, page_id)
);

CREATE TABLE element (              -- one failing element of one rule on one page in one crawl
  id           TEXT NOT NULL,       -- hash of (page_id, rule_id, selector, html_hash): the same in every crawl
  crawl_id     INTEGER NOT NULL,
  page_id      INTEGER NOT NULL,
  rule_id      TEXT NOT NULL,
  selector     TEXT NOT NULL,
  html         TEXT NOT NULL,       -- trimmed snippet
  html_hash    TEXT NOT NULL,       -- identity across crawls and pages
  pattern      TEXT NOT NULL        -- selector without positions (footer .legal a): the Issues page groups by it
);
CREATE INDEX element_id   ON element (id, crawl_id);
CREATE INDEX element_page ON element (crawl_id, page_id);
CREATE INDEX element_hash ON element (crawl_id, rule_id, html_hash);   -- shared markup counts

CREATE TABLE link (crawl_id INTEGER, from_page INTEGER, to_url TEXT);    -- "links to" filter
CREATE TABLE rule_match (crawl_id INTEGER, page_id INTEGER, rule_id TEXT, count INTEGER);  -- custom rules
```

The crawler doesn't decide who owns an element or which CMS field it came from. TeamSite's HTML doesn't expose that reliably ([research/teamsite-cms-traces.md](../research/teamsite-cms-traces.md)): component ids are per page and unnamed, and content fields aren't marked. What it stores is deterministic: the selector pattern, and the `html_hash`, whose count across pages gives "same markup on N pages".

---

## 5. Testing

- **Core:** `tests/test_issues.py` and `tests/test_pages.py` build a temporary `intelligence.db` with two crawls (a baseline and a crawl with a new, a fixed and a shared element). They assert through `find_issues` / `find_pages` only. This is where almost all tests live, and they survive any change to SQL or internals.
- **Ids:** an element keeps its id across the two crawls, and `get_issue(id)` finds it from the id alone, in the latest crawl and in an older one.
- **Routes:** a few tests per router that it parses input, calls the core and returns its result unchanged.

---

## 6. The local check CLI (later)

`npx @rbc/crawler check <url> [--rule …] [--selector …]` runs the same rules (axe-core with the crawler's config, plus the custom checks) against any URL, including localhost, and prints issues in the same `Issue` shape. It's a third adapter: it needs the crawler's rule runner, not the database, so it lives with the crawler package and reuses `core/rules.py` for titles and fix guidance.

---

## 7. Build order

Ticket numbers are from [PLAN.md](../PLAN.md).

1. **Stable pages and snapshots (T2.2), elements with their ids (T2.3).** Storage additions (§4), written by `analyze`.
2. **The core (T2.4)** with tests against a seeded database (§5), including `core/handoff.py`.
3. **Routes and the frontend switch (T2.5).** Point the Pages page, page detail and Issues page at the routes instead of the mock data. The frontend's `resolveIssue` (`src/lib/refs.ts`) becomes `GET /api/v3/issues/{id}`.

The AI systems build on 2 and 3; their order is in [ai.md](ai.md) and PLAN.md. All of this can start before a crawl records issues: a seed script that writes the prototype's mock data into `intelligence.db` is enough.
