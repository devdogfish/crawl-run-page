# Backend for Pages and Issues, and the MCP server

How to build the part of the backend behind the Pages page, the page detail and the MCP server.
The crawl run page backend (logs, metrics, steps) is in [SPEC.md](../SPEC.md) §4 to §6; this document adds what comes after it.
Words like **issue**, **element**, **shared markup** and **baseline** are defined in [CONTEXT.md](../CONTEXT.md).

Status: proposal. Nothing here is built yet. Build order is at the end (slices 6 and 7 in [SLICES.md](../SLICES.md)).

---

## 1. The shape in one picture

```
           Next.js UI            Claude Code / Desktop / any MCP client
               │                               │
          HTTP (JSON)                 stdio  or  Streamable HTTP (/mcp)
               │                               │
      ┌────────▼────────┐             ┌────────▼────────┐
      │  api/  (FastAPI │             │  mcp/  (FastMCP │      ← two thin adapters:
      │  routers)       │             │  tools)         │        parse input, call core, shape output
      └────────┬────────┘             └────────┬────────┘
               └──────────────┬────────────────┘
                     ┌────────▼────────┐
                     │      core       │                       ← the deep part: all the logic
                     │ pages · issues  │
                     │ rules · handoff │
                     └────────┬────────┘
                              │ sqlite3
                     ┌────────▼────────┐
                     │  crawler.db     │                       ← written by the crawler (SPEC §5)
                     └─────────────────┘
```

The one rule: **the REST API and the MCP server are siblings, both calling the same core functions in-process.**
The MCP server does not call the REST API over HTTP. That would add a network hop, a second serialisation and a second set of error cases for no gain, because both run in the same Python process (or can open the same SQLite file).

Why this shape (in the vocabulary of deep modules):
- **The core is the deep module.** A small interface (four or five functions) hides the real work: comparing a crawl with its baseline, grouping elements into issues, working out new and fixed, priority, shared markup, filtering, paging.
- **The interface between core and transport is a real seam.** It has two adapters today (FastAPI and MCP) and a third later (the local check CLI). Logic that lives in an adapter would have to be written twice. Deletion test: delete `core/issues.py` and the same SQL and grouping logic reappears in a router, a tool and the exporter.
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
      handoff.py                 # as_prompt(issues), as_json(issues), ui_link(...)
      models.py                  # dataclasses / pydantic models returned by core (Page, Issue, Element, PageList)
    api/
      app.py                     # FastAPI app: routers + mounts the MCP server at /mcp
      crawls.py                  # SPEC §6 routes (already specced)
      pages.py                   # GET /api/sites/{site}/pages, GET /api/pages/{id}
      issues.py                  # GET /api/pages/{id}/issues, GET /api/issues/{id}
    mcp/
      server.py                  # FastMCP instance + tool definitions (thin)
      __main__.py                # `python -m crawler_api.mcp` → stdio
  tests/
    conftest.py                  # builds a temp crawler.db with two crawls of a few pages
    test_pages.py                # through core.pages' interface
    test_issues.py               # through core.issues' interface
    test_mcp.py                  # tools end to end (in-process client)
```

The crawler itself (SPEC §4) is a separate package. It only writes to `crawler.db`; the backend only reads. That keeps the two independent: the backend can be built and tested with a seeded database before the crawler records issues.

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

def get_issue(db, issue_id: str) -> Issue | None: ...
```

```python
# core/models.py (shape; the JSON in SPEC §6.6 is this, serialised)
@dataclass
class Element:
    id: str                 # "811-9155-image-alt-3"
    selector: str
    html: str
    status: Literal["new", "existing", "fixed"]
    first_seen: int         # crawl id
    shared_pages: int | None   # None = only on this page
    box: tuple[int, int, int, int] | None   # x, y, w, h in the screenshot

@dataclass
class Issue:
    id: str                 # "811-9155-image-alt"  (crawl, page, rule)
    rule: str
    title: str
    priority: str           # P1..P4, from severity (fixed)
    severity: str
    category: str
    wcag: str | None
    how_to_fix: str
    references: list[str]
    elements: list[Element]
    ui_url: str             # deep link to the page detail with ?issue=…
```

What the core hides (and therefore what its tests cover):
- **Resolving inputs:** page by id, path or full URL; `crawl="latest"` → newest finished crawl of that site (QA copies are their own sites).
- **Comparing with the baseline:** element identity is `(page, rule, selector, html_hash)`. New = in crawl, not in baseline. Fixed = in baseline, not in crawl. Same key for page change detection with `content_hash`.
- **Grouping:** elements → issues by rule; issues sorted by severity, then element count.
- **Priority:** `{"critical": "P1", "serious": "P2", "moderate": "P3", "minor": "P4"}`, in `rules.py`, not configurable.
- **Shared markup:** `shared_pages` = how many pages in the same crawl have the same `html_hash` for that rule.
- **Paging:** keyset cursors (opaque strings), never offsets, so the MCP tool and the UI page the same way.

---

## 4. Storage additions

These tables extend SPEC §5.2. The crawler writes them; the backend reads them.

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
  screenshot    TEXT,               -- file path; NULL if not captured
  PRIMARY KEY (crawl_id, page_id)
);

CREATE TABLE element (              -- one failing element of one rule on one page in one crawl
  crawl_id     INTEGER NOT NULL,
  page_id      INTEGER NOT NULL,
  rule_id      TEXT NOT NULL,
  selector     TEXT NOT NULL,
  html         TEXT NOT NULL,       -- trimmed snippet
  html_hash    TEXT NOT NULL,       -- identity across crawls and pages
  pattern      TEXT NOT NULL,       -- selector without positions (footer .legal a): the Issues page groups by it
  box          TEXT                 -- JSON [x,y,w,h]
);
CREATE INDEX element_page ON element (crawl_id, page_id);
CREATE INDEX element_hash ON element (crawl_id, rule_id, html_hash);   -- shared markup counts

CREATE TABLE link (crawl_id INTEGER, from_page INTEGER, to_url TEXT);    -- "links to" filter
CREATE TABLE rule_match (crawl_id INTEGER, page_id INTEGER, rule_id TEXT, count INTEGER);  -- custom rules
```

The crawler doesn't decide who owns an element or which CMS field it came from. TeamSite's HTML doesn't expose that reliably ([research/teamsite-cms-traces.md](../research/teamsite-cms-traces.md)): component ids are per page and unnamed, and content fields aren't marked. What it stores is deterministic: the selector pattern, and the `html_hash`, whose count across pages gives "same markup on N pages".

---

## 5. The MCP server

### 5.1 What it's for

An AI coding tool (Claude Code, Cursor, Claude Desktop) pulls issues itself: "get the P1 accessibility issues for /en/insights/2025/… and fix them in this repo". The developer doesn't copy anything.

### 5.2 Tools

Start with three read-only tools. Design them around what the model needs to do, not around the REST endpoints.

| Tool | Input | Returns |
|---|---|---|
| `find_pages` | `site`, `q?` (URL, title), `rule?`, `priority?`, `category?`, `change?`, `crawl?` = latest, `limit?` = 20 | pages with issue counts by priority, `ui_url`, `next_cursor` |
| `list_issues` | `page` (id, path or URL), `crawl?` = latest, `priority?`, `category?`, `status?` | issues with their elements (selector, HTML, shared pages), how to fix, `ui_url` |
| `get_issue` | `issue_id` | one issue with every element, references and the local check command |

Later, only if people ask for it: a `fix_page` **prompt** (MCP prompts are user-invoked templates: "fix all P1 issues on page X" expands into a ready prompt), and `issue://{id}` **resources**.

### 5.3 Writing tools that models use well

- **Descriptions are for the model.** Say when to use the tool and what comes back, in one or two sentences: "List the issues on one page of the site. Use this before fixing a page; each issue includes the failing HTML, where it comes from (template, component or CMS content) and how to fix it."
- **Constrain inputs.** Enums for `priority` (`P1`…`P4`), `category`, `status`. Sensible defaults (`crawl` = latest). Accept what a user would paste: a full URL as well as an id.
- **Return compact, structured results.** Return the typed model (FastMCP turns it into structured content plus text). Cap lists (`limit`, `next_cursor`), trim HTML snippets, and omit fields the model doesn't need. A page with 150 elements should come back grouped by issue, not as 150 flat rows.
- **Always include `ui_url`.** The model can hand the developer a link to the exact issue in the UI.
- **Errors that say what to do next:** "Page /en/foo isn't in crawl 811. The latest crawl that has it is 806." Raise them as tool errors, not empty results.
- **Read-only, and say so.** Mark every tool `readOnlyHint`. No write tools (start a crawl, mark fixed) until there's a clear need and auth for it.
- **Keep the set small.** Three tools the model can choose between reliably beat ten overlapping ones.

### 5.4 Code

Use the official MCP Python SDK (`mcp` package; `FastMCP` is included). Check [the SDK README](https://github.com/modelcontextprotocol/python-sdk) for the current API and pin the version in `pyproject.toml`; the transport and mounting APIs have changed between releases.

```python
# crawler_api/mcp/server.py (shape)
from typing import Literal
from mcp.server.fastmcp import FastMCP
from crawler_api import db
from crawler_api.core import issues, pages
from crawler_api.core.models import Issue, PageList

mcp = FastMCP("rbc-crawler", stateless_http=True)

Priority = Literal["P1", "P2", "P3", "P4"]
Category = Literal["accessibility", "performance", "seo", "security"]

@mcp.tool(annotations={"readOnlyHint": True})
def list_issues(page: str, crawl: int | Literal["latest"] = "latest",
                priority: list[Priority] = [], category: list[Category] = []) -> list[Issue]:
    """List the issues on one page. Use before fixing a page: each issue has the failing HTML,
    its source (template, component or CMS content) and how to fix it."""
    with db.connect(readonly=True) as conn:
        return issues.find_issues(conn, page, crawl, priority=priority, category=category)

# find_pages and get_issue look the same: parse, call core, return.
```

```python
# crawler_api/mcp/__main__.py: local, over stdio
from crawler_api.mcp.server import mcp
mcp.run()                       # stdio is the default transport
```

```python
# crawler_api/api/app.py: the same server over HTTP, next to the REST API
app = FastAPI(lifespan=...)     # the lifespan must start mcp's session manager; see the SDK README
app.mount("/mcp", mcp.streamable_http_app())
```

The tool functions contain no logic beyond calling the core. If one starts growing an `if`, that logic belongs in the core, where the REST API gets it too.

### 5.5 Running it

You don't need to deploy anything to try it.

| Setup | How | When |
|---|---|---|
| **Local, stdio** | `claude mcp add rbc-crawler -- uv run --directory backend python -m crawler_api.mcp` | Developing the server; demo on your own machine. The client starts the process and reads your local `crawler.db`. |
| **Local, HTTP** | `uvicorn crawler_api.api.app:app` then `claude mcp add --transport http rbc-crawler http://localhost:8000/mcp` | Same as above, but through the real API process (closest to production). |
| **Shared** | The FastAPI app on an internal host; teammates add `https://crawler.internal/mcp` | When others need it. Put it behind the company SSO or a read-only token. |

Debug with the MCP Inspector (`npx @modelcontextprotocol/inspector`), which lists the tools, shows their schemas and lets you call them by hand.

### 5.6 Testing

- **Core:** `tests/test_issues.py` and `tests/test_pages.py` build a temporary `crawler.db` with two crawls (a baseline and a crawl with a new, a fixed and a shared element) and assert through `find_issues` / `find_pages` only. This is where almost all tests live. They survive any change to SQL or internals.
- **Tools:** a few tests that the tools are registered, validate their input, and return the core's result unchanged (call them through the SDK's in-process client, or call the decorated functions directly).
- **By hand:** the Inspector, then one real session in Claude Code: "list the P1 issues on /en/insights/… and fix them".

---

## 6. The local check CLI (later)

`npx @rbc/crawler check <url> [--rule …] [--selector …]` runs the same rules (axe-core with the crawler's config, plus the custom checks) against any URL, including localhost, and prints issues in the same `Issue` shape. It's a third adapter: it needs the crawler's rule runner, not the database, so it lives with the crawler package and reuses `core/rules.py` for titles and fix guidance.

---

## 7. Build order

1. **Slice 6: Pages and issues API.** Storage additions (§4), `core/` with tests against a seeded database, the REST routes, then point the Pages page and page detail at them instead of the mock data.
2. **Slice 7: MCP server.** `mcp/server.py` with the three tools, stdio entry, `/mcp` mount, Inspector check, and one real fix session in Claude Code.

Both slices can start before the crawler records issues: a seed script that writes the prototype's mock data into `crawler.db` is enough.
