# Crawl run page: spec

Status: agreed design, ready to integrate · Last updated: 2026-11-04
Stack: Next.js + **Chakra UI v3** (frontend) · **FastAPI** + **SQLite** (backend)

This document records what was decided while designing the crawl run page:

- the questions that came up, the recommendations and what was agreed (§2);
- the UI (§3);
- how to instrument the existing crawler: where to add logs and metrics (§4);
- how to store it all in SQLite (§5);
- the FastAPI endpoints (§6).

`SLICES.md` breaks the integration into 5 slices.

> **The crawler already exists and is not changed by this work.** This spec only defines what it should *report* (logs, progress, per-page results) and where to store it. How it crawls, renders, retries or picks pages is up to the crawler.

---

## 1. What the page is for

A crawl run has strictly sequential steps; each step is blocked until the one before it finishes:

```
Crawl (~90% of the time) → Parse → Transform → Load → Lighthouse (sample) → Publish
                                                       ↳ optional: Lighthouse · full site (follow-up job)
```

The page answers, in this order:

1. **Is it OK?** Status, progress, when it will finish.
2. **Where is it?** Which step is running, which are waiting, which failed.
3. **Why?** Logs, metrics and per-page results for the selected step.

Step ids and names are examples; use your pipeline's own. The UI reads whatever steps the API returns, in `position` order.

---

## 2. Decisions (questions asked → what we agreed)

| # | Question / feedback | Decision |
|---|---|---|
| D1 | Simple numbered steppers look "vibe-coded". | Model the page on real CI/orchestration run pages (GitHub Actions, Vercel, Dagster, Buildkite), built from pre-built Chakra components. Research: `docs/research-enterprise-pipeline-ui.md`. |
| D2 | Steps are sequential, but I want to click into each one and see its logs. | Step list plus a detail pane. Every step can be selected and has Logs and Metrics. |
| D3 | Logs and a badge aren't enough. I need loading states and graphs. | Running steps show progress bars. The crawl has a throughput/queue chart and a response-code bar; other steps have a rate chart. |
| D4 | Must use Chakra. | Chakra UI v3 plus `@chakra-ui/charts` (Recharts 3). The only other UI dependency is `react-virtuoso` for the log. |
| D5 | The crawl is ~90% of the run, and the page total is roughly known from previous crawls. | The crawl gets real progress and an ETA. Expected pages = **median** of the last 5 crawls; ETA = remaining pages ÷ recent rate + usual time of the remaining steps. |
| D6 | Too much repeated information. | **Show each fact once.** Status, progress and ETA live in the header; pages and rate in the facts row; queue and rate on the crawl chart; errors on the response bar; "usual" only as chart reference lines. |
| D7 | The double/segmented progress bar looks bad. | One small progress bar inside the facts row, shown only while running. When finished it's replaced by facts (trigger, duration…). |
| D8 | Still looks like components dropped into an accordion. | **Page layout:** breadcrumb → title + status + actions → facts row → two panes (step list on the left, selected step with tabs on the right). |
| D9 | The history chart has too many labels. | A compact sparkline: one text line ("Crawl duration · 23m 23s · median 21m"), a dashed median line and a dot for this run. No axes or grid; hover shows each run. |
| D10 | Median or average? | **Median**, for "usual duration", ETA and expected pages. Crawl times have occasional slow outliers; the median ignores them, while the average gets pulled up. Use averages only for totals (e.g. hours crawled per month). |
| D11 | Don't overdo accessibility on the crawl page, but show the technical details: redirect hops, and whether a redirect is client- or server-side. | The Pages table has no accessibility columns. It shows **Status** (first response), **Redirect** (Server / Client / Mixed / Loop, plus "N hops" when there are 2+) and **Final URL**. Multi-hop rows expand into a one-line chain: `/a → 302 → /b → JavaScript → /c`. |
| D12 | Repeated info in redirect rows. | One-hop redirects don't expand; the row already says everything. The chain shows each URL once, with the hop type on the arrow. |
| D13 | Reuse the same toolbar as the logs. | One `DataToolbar` (search, filter segments, count, copy, download) is shared by Logs and Pages. |
| D14 | Pagination or virtualization? | **Logs:** a virtualized list that loads more on scroll (continuous stream). **Pages table:** numbered pagination, 50 rows per page, with filtering on the server (records people search and link to). Never load every row into the browser. |
| D15 | Lighthouse usually runs on a subset; full site only sometimes, never during the crawl. | Lighthouse **sample** is a normal step after Load. **Full site** is an optional **follow-up job**: same level as the steps, last row of the list, with a **Run** button once the run has succeeded. It reuses the crawl output, runs separately, and has its own logs, progress and scores. |
| D16 | Logging: print to the console and read it back, or a custom function? What goes in a log line? | Python `logging` plus a handler that writes **structured** records to SQLite; keep the console handler for developers. Never scrape stdout. See §4. |
| D17 | Stream logs live, or poll? | **Status/metrics:** poll every 2s (small JSON). **Logs:** SSE for the open step, resuming with `Last-Event-ID`. Polling `?after=<id>` is an acceptable first version. No WebSockets. |
| D18 | How do I collect metrics during processing? | Each step reports progress every few seconds (`items_total`, `items_done`, counters). Charts and ETAs come from those rows, **never from parsing log text**. |
| D19 | 50K log lines: won't the client struggle? | A virtualized list (only visible rows in the DOM). Load the newest ~1,000 lines, fetch older ones on scroll up, filter on the server. |
| D20 | How do I keep the log scrolled to the bottom? | "Follow" pattern: stick to the bottom while the user is there; pause when they scroll up and show "↓ N new lines"; clicking it resumes (`react-virtuoso` `followOutput`). |
| D21 | How much to log? Every redirect, skip, success? | *Revised (D28):* **every HTTP request is logged**, including each redirect hop and retry, alongside milestones and progress summaries. `crawl_pages` still holds one row per URL with its final outcome, for the filterable Pages table. The log is the time-ordered record; the table is the per-URL summary. Skipped URLs are never requested, so they appear only in the table. |
| D22 | Should users be able to copy or export logs? | Yes. Click a line number to select it, shift-click for a range; Copy; Download full log (`.txt`, served by the API). Pages export as `.csv`. |
| D23 | Breadcrumb. | `Crawls › {crawl_id}`; title "Crawl {crawl_id}". |
| D24 | The crawler is already built; just make it easy to add logs in the right places, and store everything in SQLite. | One small module (`crawl_events.py`, §4.1) is the only thing the crawler imports. It is called at 7 points (§4.2), and a single background writer thread does batched SQLite inserts (§5). |
| D25 | Three typography styles next to each other look bad. | **Monospace only for code-like text** (URLs, log lines, commands). Numbers, times and durations use the normal font with tabular digits. A label + value pair is one font and size, with only the value emphasised. |
| D26 | Should the filter tabs match the search input's size? | Yes. All controls in a toolbar share one height (32px) and one text size (12px). The reference tools (GitHub Actions log search, Vercel log filters) do the same; the mismatch came from Chakra's default sizes. |
| D27 | Logs should be more consistent; an INFO/ERROR column isn't useful. What should a log line contain? | As in normal CI/crawler logs: **time + one plain sentence**, with severity shown only by colour. Every message follows `Verb subject (details)`, one template per kind of event. Structured fields go in `data` for filtering and export, not into the visible line (§4.3). |
| D28 | The HTTP code must be in the line, because every request is logged. | Request lines use an access-log template with the **status first**, so it lines up down the page: `200 GET /product/10065 (412 ms)`, `301 GET /p/1 → /product/1 (88 ms)`, `ERR GET /x (30.0 s, timed out after 30s)`. Level follows the status class, and the log viewer is virtualised, so ~50K lines per crawl is fine (§4.3, §5.2). |

---

## 3. UI spec

Route: **`/crawls/[crawlId]`** (`src/app/crawls/[crawlId]/page.tsx`).

### 3.1 Header
- **Breadcrumb:** `Crawls › {crawl_id}`.
- **Title:** "Crawl {crawl_id}" plus **one** status badge: Crawling, Processing, Succeeded or Failed (a pulsing dot while running).
- **Actions** (right):
  - `Retry from {step}`, only when failed;
  - `Logs` (download all logs);
  - a `⋯` menu with "Run Lighthouse on full site" (enabled after the sample succeeds) and "Copy link".
- **Facts row** (Chakra `DataList`, 6 items):

| Fact | Content | Source |
|---|---|---|
| Progress | Small bar + %, only while running. When finished, this slot shows **Trigger**. | `progress_pct` / `trigger` |
| Started | Absolute time, UTC. | `crawls.started_at` |
| Elapsed / Duration | Plus "· done ~HH:MM" while running. | `elapsed_sec`, `eta_at` |
| Pages | Fetched; while crawling "/ ~48.2K", with a tooltip "median of the last 5 crawls". | `pages.done`, `crawls.expected_pages` |
| Errors | % of fetched, plus the count. | crawl `counters.codes` |
| Config | Crawler version · concurrency. | `crawls.config` |

### 3.2 Step list (left, sticky)
- **Row content:** icon, name, one-line subtitle, and duration (or `~usual` if not started). Running rows add a thin progress bar.
- **Statuses:** `pending`, `waiting`, `running`, `success`, `failed` and `blocked` ("Not run · an earlier step failed").
- **Selection:**
  - the running step is auto-selected (or the failed step after a failure);
  - once the user clicks a row, that choice sticks;
  - locked rows can't be clicked.
- **Last row, Lighthouse · full site** (optional job, same level as the steps):
  - "Optional · after the run finishes", or "Optional · needs a successful run";
  - after success: "Optional · ~3h 40m" with a **Run** button;
  - once started: a normal row.
- **Below the list:** the crawl-duration sparkline (D9).

### 3.3 Step pane (right)
- **Header:** icon, name, a badge only for non-running/non-success states, description, `Started HH:MM:SS`, duration / usual.
- **Progress line:** a thin striped bar at the top while running.
- **Alerts:** a failure alert with the error message; a rate-limit warning on the crawl while it backs off.
- **Tabs:**

| Tab | Shown for | Content |
|---|---|---|
| Logs (count) | all | `LogViewer` (D19–D22) |
| Metrics | all | **Crawl:** rate, URLs discovered, queue, median render, throughput+queue chart (with a "usual rate" line), response-code bar. **Other steps:** progress, items, usual duration, rate chart. Empty state before data. |
| Pages (count) | crawl | Paginated table (D11–D14) |
| Scores | Lighthouse steps | 4 Lighthouse scores as `ProgressCircle`s, coloured on Lighthouse's scale (≥90 green, ≥50 orange, else red). The sample step offers "Run full audit". |

### 3.4 Pages table
- **Toolbar:** `DataToolbar` with
  - URL search;
  - filters with counts: **All · Errors · Redirects · Client-side · Skipped**;
  - copy visible URLs;
  - download CSV.
- **Columns:** `#` · URL (as requested) · Status (first response) · Redirect · Fetch (ms) · Render (s) · Final URL / note.
- **Redirect column:**
  - a type badge: Server (blue), Client (purple), Mixed (orange) or Loop (red);
  - "N hops" plus a chevron when there are 2+ hops, and clicking expands the chain.
- **Status semantics:** a client-side redirect shows `200`. Loops count as Errors.
- **Pagination:** 50 rows per page (Chakra `Pagination`). Changing the filter or search resets to page 1.

### 3.5 Visual rules
- Each fact once (D6). Badges only where they add something.
- **Typography (D25):**
  - monospace only for URLs, log lines and commands;
  - numbers use the body font with `fontVariantNumeric="tabular-nums"`;
  - one font and size per label/value pair.
- **Toolbars (D26):** controls are 32px tall with 12px text.
- **Colours:** a dark log surface in both themes. Lighthouse colours follow Lighthouse's own scale; status colours follow `STATUS` in `src/components/step-ui.tsx`.

---

## 4. Instrumenting the crawler (logs + metrics)

### 4.1 One module to import: `crawl_events.py`

The crawler only talks to this module. It doesn't know about the UI, the API or SQL. Every call is **non-blocking**: it puts a record on a queue, and one writer thread inserts batches into SQLite every ~1 second (§5.3).

```python
# crawl_events.py
import contextvars, json, logging, queue, threading, time
from datetime import datetime, timezone

crawl_id_var = contextvars.ContextVar("crawl_id", default=None)
step_var = contextvars.ContextVar("step", default=None)
_q: "queue.Queue[tuple[str, dict]]" = queue.Queue()
now = lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds")

class CrawlRecorder:
    def __init__(self, crawl_id: str):
        self.crawl_id = crawl_id
        crawl_id_var.set(crawl_id)

    # ── lifecycle ──────────────────────────────────────────────
    def crawl_started(self, site: str, trigger: str, config: dict, steps: list[tuple[str, str]]):
        """steps = [(step_id, name), ...] in order. Also stores expected_pages / expected_sec medians (§5.4)."""
        _q.put(("crawl_started", dict(id=self.crawl_id, site=site, trigger=trigger, config=config, steps=steps, ts=now())))

    def step_started(self, step_id: str, items_total: int | None = None):
        step_var.set(step_id)
        _q.put(("step_started", dict(crawl_id=self.crawl_id, step_id=step_id, items_total=items_total, ts=now())))

    def progress(self, items_done: int, rate: float, **counters):
        """Call every 5-10 s while a step runs. counters are step-specific (see §4.2)."""
        _q.put(("progress", dict(crawl_id=self.crawl_id, step_id=step_var.get(), items_done=items_done,
                                 rate=rate, counters=counters, ts=now())))

    def step_finished(self):
        _q.put(("step_finished", dict(crawl_id=self.crawl_id, step_id=step_var.get(), ts=now())))

    def step_failed(self, error: str):
        _q.put(("step_failed", dict(crawl_id=self.crawl_id, step_id=step_var.get(), error=error, ts=now())))

    # ── crawl step only ───────────────────────────────────────
    def page(self, n: int, url: str, *, status: int | None, kind: str, hops: list[dict] = (),
             final_url: str | None = None, fetch_ms: int | None = None, render_ms: int | None = None,
             note: str | None = None):
        """One call per URL, whatever the outcome. kind: ok | redirect | client_error | server_error | timeout | loop | skipped.
        hops: [{"from": url, "to": url, "via": "301"|"302"|"307"|"308"|"meta refresh"|"JavaScript", "side": "server"|"client"}]"""
        _q.put(("page", dict(crawl_id=self.crawl_id, n=n, url=url, status=status, kind=kind, hops=list(hops),
                             final_url=final_url, fetch_ms=fetch_ms, render_ms=render_ms, note=note)))

    def rate_limited(self, until: datetime | None):
        """until=None when the backoff ends."""
        _q.put(("rate_limited", dict(crawl_id=self.crawl_id, until=until.isoformat() if until else None)))

    # ── lighthouse steps / job ────────────────────────────────
    def lighthouse_result(self, scope: str, url: str, scores: dict):
        _q.put(("lighthouse", dict(crawl_id=self.crawl_id, scope=scope, url=url, **scores)))


def log_request(url: str, status: int | None, ms: int, *, method: str = "GET",
                redirect_to: str | None = None, detail: str | None = None, attempt: int | None = None):
    """Call once per HTTP request (every hop and retry). Builds the standard request line (§4.3)."""
    code = "ERR" if status is None else str(status)
    took = f"{ms / 1000:.1f} s" if ms >= 1000 else f"{ms} ms"
    extra = ", ".join(x for x in [took, detail] if x)
    msg = f"{code} {method} {url}" + (f" → {redirect_to}" if redirect_to else "") + f" ({extra})"
    level = logging.ERROR if status is None or status >= 500 else logging.WARNING if status >= 400 else logging.INFO
    log.log(level, msg, extra={"data": {"url": url, "status": status, "ms": ms, "method": method,
                                         "redirect_to": redirect_to, "attempt": attempt}})


class DbLogHandler(logging.Handler):
    """Every log record emitted inside a crawl goes to crawl_logs (console output is unchanged)."""
    def emit(self, record):
        if crawl_id_var.get() is None:
            return
        data = getattr(record, "data", None) or {}
        _q.put(("log", dict(crawl_id=crawl_id_var.get(), step_id=step_var.get() or "crawl", ts=now(),
                            level=record.levelname, message=record.getMessage(),
                            status=data.get("status"), url=data.get("url"), data=data or None)))

log = logging.getLogger("crawler")
log.setLevel(logging.INFO)
log.addHandler(DbLogHandler())   # keep your existing console handler as it is
```

> **Async crawler?** `contextvars` follow asyncio tasks automatically. Set `step_var` inside the task that runs the step, and every `log.*` call made from it is tagged correctly.

### 4.2 Where to call it

| When in the crawler | Call | Feeds in the UI |
|---|---|---|
| A crawl is created | `rec.crawl_started(site, trigger, config, steps)` | breadcrumb, header facts, step list (all `pending`), expected pages, usual durations |
| Each step begins | `rec.step_started("crawl", items_total=None)`; processing steps pass the page count; Lighthouse passes the sample size | step status, "Started", progress denominator |
| Every 5–10s while a step runs (a timer, or every N items) | **crawl:** `rec.progress(done, rate, codes={...}, discovered=n, queue=n, render_ms_median=n)` · **others:** `rec.progress(done, rate)` | progress bar, ETA, Metrics charts, response-code bar, queue, facts row "Pages"/"Errors" |
| **Every HTTP request** (each redirect hop and each retry too) | `log_request(url, status, ms, redirect_to=…, detail=…)` | Logs tab (one line per request) |
| Each URL finishes, **including** redirects, errors, timeouts and skips | `rec.page(n, url, status=…, kind=…, hops=[…], …)` | Pages table, filter counts, CSV |
| Backoff starts / ends | `rec.rate_limited(until)` / `rec.rate_limited(None)` | rate-limit alert |
| Each Lighthouse audit | `rec.lighthouse_result("sample"\|"full", url, {performance, accessibility, best_practices, seo})` | Scores tab |
| Step ends | `rec.step_finished()` or `rec.step_failed(str(err))` | step status, failure alert, Retry button |

`codes` keys: `"2xx"`, `"3xx"`, `"4xx"`, `"429"`, `"5xx"`, `"timeout"` (cumulative counts). Send everything as cumulative totals, so a missed tick never corrupts a chart.

### 4.3 Log catalogue: what goes in the Logs tab

**What a log line contains.** This matches how CI and crawler logs normally look (GitHub Actions, Vercel, Scrapy):

| Part | Stored | Shown in the UI |
|---|---|---|
| Time | `ts` (UTC) | `HH:MM:SS` in the gutter |
| Severity | `level` (INFO / WARNING / ERROR) | **colour only**: errors red, warnings yellow, info default. No level column. |
| Step | `step_id` (from the context variable) | which tab the line appears in, not repeated per line |
| Message | `message` | one plain sentence, in the fixed shape below |
| Fields | `data` JSON (url, status, attempts, duration…) | not shown; used for filtering, export and debugging |

**Message shape: `Verb subject (details)`.** Past tense, the subject (a URL, a count or a name) right after the verb, and extra numbers in parentheses separated by commas. Each kind of event always uses the same template, so lines line up when you scan them. Scrapy's progress line works the same way: `Crawled N pages (at X pages/min)`.

Use the `crawler` logger anywhere (`from crawl_events import log`). Attach machine-readable fields with `extra={"data": {...}}`.

**Request lines (every request).** These follow an access-log template with the status code first, `<status> <METHOD> <path>[ → <target>] (<duration>[, detail])`, built by `log_request()`:

| Case | Line | Level (colour) |
|---|---|---|
| Success | `200 GET /product/10065 (412 ms)` | INFO (default) |
| Server redirect hop | `301 GET /p/10065 → /product/10065 (88 ms)` | INFO |
| Client-side redirect (seen after render) | `200 GET /m/product/10065 → /product/10065 (595 ms, client-side JavaScript)` | INFO |
| Client error | `404 GET /product/10066 (120 ms)` | WARNING (yellow) |
| Rate limited | `429 GET /product/10067 (41 ms, backing off)` | WARNING |
| Server error, after retries | `503 GET /product/10068 (900 ms, after 3 attempts)` | ERROR (red) |
| No response | `ERR GET /search?q=1 (30.0 s, timed out after 30s)` | ERROR |
| Redirect loop | `ERR GET /product/10069 (0 ms, redirect loop, gave up after 10 hops)` | ERROR |

**Other lines** use `Verb subject (details)`:

| Level | When | Template (example) | `data` |
|---|---|---|---|
| INFO | Step start: the command or config used | `$ crawler run shop.example.com --max-concurrency 64` | — |
| INFO | Seeds loaded | `Seeded 1,200 URLs from sitemap.xml (expecting ~48,200 pages)` | `{seeds, expected}` |
| INFO | **Progress every 15–30s** (same numbers as `progress`) | `Crawled 10,512 pages (39/s, 6,120 queued)` | `{done, rate, queue}` |
| INFO | Step finished | `Finished crawl: 49,350 pages (+2.4% vs expected)` | `{done, errors}` |
| WARNING | Rate limited | `Rate limited by shop.example.com (429, backing off 30s, concurrency 64 → 16)` | `{until, concurrency}` |
| INFO | Rate limit over | `Resumed full speed (concurrency 64)` | `{concurrency}` |
| ERROR | Render/browser crash | `Failed to render /product/10091 (Target closed)` | `{url, error}` |
| ERROR | Step failure, with the cause and a hint if known | `Failed model fct_prices (Numeric value '1.299,00' is not recognized)` | `{error, hint}` |
| INFO | Retry marker (written by the retry endpoint) | `Retrying from this step (attempt 2, reusing crawl output)` | `{attempt}` |

Keep the templates in one place (e.g. small helper functions such as `log_timeout(url, after_s)` in `crawl_events.py`), so every call site produces exactly the same shape.

**Volume:** ~1 line per request, so roughly 50K lines per crawl. The viewer is virtualised and filters on the server ("Warnings & errors" = `level IN ('WARNING','ERROR')`, or by status class), so this is fine. Progress summaries every 15–30s keep the log readable while it scrolls.

**Never log** secrets (tokens, cookies, auth headers), because the UI shows log lines to users.

---

## 5. Storage (SQLite)

### 5.1 Connection settings
```sql
PRAGMA journal_mode = WAL;     -- FastAPI can read while the crawler writes
PRAGMA synchronous = NORMAL;   -- safe with WAL, much faster
PRAGMA busy_timeout = 5000;    -- wait instead of failing if another writer holds the lock
PRAGMA foreign_keys = ON;
```

- **Writes:** only the `crawl_events` writer thread, one per crawler process, in short batched transactions.
- **Reads:** FastAPI opens read-only connections (`file:crawls.db?mode=ro`, `uri=True`).
- **Format:** timestamps are ISO 8601 UTC `TEXT`, and JSON is `TEXT` (query it with SQLite's `json_extract` / `->>` when needed).

### 5.2 Schema
```sql
CREATE TABLE crawls (
  id                 TEXT PRIMARY KEY,                 -- shown in the breadcrumb
  site               TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('running','success','failed','cancelled')),
  trigger            TEXT NOT NULL,                    -- 'schedule' | 'manual' | ...
  config             TEXT NOT NULL DEFAULT '{}',       -- JSON: crawler_version, concurrency, lighthouse_sample_size
  expected_pages     INTEGER,                          -- median pages of the last 5 successful crawls (§5.4)
  rate_limited_until TEXT,
  started_at         TEXT NOT NULL,
  finished_at        TEXT
);
CREATE INDEX crawls_site_started ON crawls (site, started_at);

CREATE TABLE crawl_steps (                             -- one row per step AND per follow-up job
  crawl_id     TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  step_id      TEXT NOT NULL,                          -- crawl | parse | ... | lighthouse | publish | lighthouse_full
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'step',           -- 'step' | 'job'
  position     INTEGER NOT NULL,
  status       TEXT NOT NULL,                          -- pending | waiting | running | success | failed | blocked
  started_at   TEXT,
  finished_at  TEXT,
  expected_sec INTEGER,                                -- median duration of this step over recent crawls (§5.4)
  items_total  INTEGER,
  items_done   INTEGER NOT NULL DEFAULT 0,
  rate         REAL,                                   -- latest rate (pages/s, rows/s, pages/min)
  counters     TEXT NOT NULL DEFAULT '{}',             -- JSON, latest cumulative counters (codes, queue, discovered, scores…)
  error        TEXT,
  attempt      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (crawl_id, step_id)
);

CREATE TABLE crawl_samples (                           -- time series for charts; one row per progress() call
  crawl_id   TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  step_id    TEXT NOT NULL,
  ts         TEXT NOT NULL,
  items_done INTEGER NOT NULL,
  rate       REAL NOT NULL,
  queue      INTEGER                                   -- crawl only
);
CREATE INDEX crawl_samples_step_ts ON crawl_samples (crawl_id, step_id, ts);

CREATE TABLE crawl_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,          -- never reused → safe cursor for after/before and SSE Last-Event-ID
  crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  step_id  TEXT NOT NULL,
  ts       TEXT NOT NULL,
  level    TEXT NOT NULL,                              -- INFO | WARNING | ERROR
  message  TEXT NOT NULL,                              -- the rendered line, e.g. "200 GET /product/1 (412 ms)"
  status   INTEGER,                                    -- HTTP status for request lines (NULL = no response / not a request)
  url      TEXT,                                       -- request URL for request lines
  data     TEXT                                        -- JSON: ms, method, redirect_to, attempt, ...
);
CREATE INDEX crawl_logs_step ON crawl_logs (crawl_id, step_id, id);
CREATE INDEX crawl_logs_level ON crawl_logs (crawl_id, step_id, level, id);
CREATE INDEX crawl_logs_status ON crawl_logs (crawl_id, step_id, status, id) WHERE status IS NOT NULL;

CREATE TABLE crawl_pages (                             -- one row per URL; per-page detail lives here, not in logs
  crawl_id      TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  n             INTEGER NOT NULL,                      -- 1..N in crawl order (stable; used for paging)
  url           TEXT NOT NULL,                         -- as requested
  status        INTEGER,                               -- first response status; NULL for skipped/timeout
  kind          TEXT NOT NULL,                         -- ok | redirect | client_error | server_error | timeout | loop | skipped
  redirect_side TEXT,                                  -- server | client | mixed | NULL (derived from hops on insert)
  hop_count     INTEGER NOT NULL DEFAULT 0,
  hops          TEXT,                                  -- JSON [{from,to,via,side}]
  final_url     TEXT,
  fetch_ms      INTEGER,
  render_ms     INTEGER,
  note          TEXT,
  PRIMARY KEY (crawl_id, n)
) WITHOUT ROWID;
CREATE INDEX crawl_pages_kind ON crawl_pages (crawl_id, kind, n);
CREATE INDEX crawl_pages_side ON crawl_pages (crawl_id, redirect_side, n) WHERE redirect_side IS NOT NULL;

CREATE TABLE lighthouse_results (
  crawl_id       TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  scope          TEXT NOT NULL,                        -- 'sample' | 'full'
  url            TEXT NOT NULL,
  performance    INTEGER, accessibility INTEGER, best_practices INTEGER, seo INTEGER,
  PRIMARY KEY (crawl_id, scope, url)
) WITHOUT ROWID;
```

### 5.3 The writer thread
```python
def _writer(db_path: str):
    db = sqlite3.connect(db_path, isolation_level=None, check_same_thread=False)
    for pragma in ("journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=5000", "foreign_keys=ON"):
        db.execute(f"PRAGMA {pragma}")
    while True:
        batch = [_q.get()]                                  # block for the first record
        deadline = time.monotonic() + 1.0
        while len(batch) < 1000 and (left := deadline - time.monotonic()) > 0:
            try: batch.append(_q.get(timeout=left))
            except queue.Empty: break
        with db:                                            # one transaction per batch
            for kind, rec in batch:
                HANDLERS[kind](db, rec)                     # small INSERT/UPDATE per kind, see table below

threading.Thread(target=_writer, args=("crawls.db",), daemon=True).start()
```

| Record | SQL |
|---|---|
| `crawl_started` | `INSERT crawls(status='running')` + one `crawl_steps` row per step (`pending`; the first is `waiting`), with `expected_sec` from §5.4 |
| `step_started` | `UPDATE crawl_steps SET status='running', started_at, items_total`; the next step → `waiting` |
| `progress` | `UPDATE crawl_steps SET items_done, rate, counters` + `INSERT crawl_samples` |
| `page` | `INSERT crawl_pages` (compute `redirect_side` and `hop_count` from `hops`) |
| `log` | `INSERT crawl_logs` |
| `rate_limited` | `UPDATE crawls SET rate_limited_until` |
| `lighthouse` | `INSERT OR REPLACE lighthouse_results` |
| `step_finished` | `UPDATE crawl_steps SET status='success', finished_at`; if it was the last step, `UPDATE crawls SET status='success'` |
| `step_failed` | `UPDATE … status='failed', error`; the later steps → `blocked`; `crawls.status='failed'` |

Flush the queue on shutdown (`atexit`), so the last lines and the final status are written.

### 5.4 Derived numbers (computed when a crawl starts, or by the API)
```sql
-- expected_pages: median pages of the last 5 successful crawls of this site
SELECT items_done FROM crawl_steps s JOIN crawls c ON c.id = s.crawl_id
WHERE c.site = :site AND c.status = 'success' AND s.step_id = 'crawl'
ORDER BY c.started_at DESC LIMIT 5;          -- take the median in Python: statistics.median(rows)

-- expected_sec per step: same query over the last 10 crawls, (julianday(finished_at) - julianday(started_at)) * 86400
```
The API computes at read time:
- **`progress_pct`:** weighted by `expected_sec`;
- **`eta_at`:** remaining items ÷ the median of the last ~6 sample rates, plus the `expected_sec` of the steps not started yet;
- **`error_pct`:** from `counters.codes`.

### 5.5 Retention and size
- About 50K page rows plus ~50K request log lines per crawl comes to roughly 15–25 MB. That's fine for SQLite. Batched inserts (§5.3) keep 50+ lines/s cheap.
- Keep `crawls` and `crawl_steps` forever (history and medians).
- Daily, delete `crawl_logs`, `crawl_samples` and `crawl_pages` for crawls older than 30–90 days (`DELETE … WHERE crawl_id IN (…)`). Then run `PRAGMA incremental_vacuum` (with `auto_vacuum=INCREMENTAL` set at creation), or a `VACUUM` now and then.

---

## 6. API (FastAPI)

All under `/api`. Times are ISO 8601 UTC. Pydantic models mirror the payloads below.

### 6.1 Crawl summary: polled every 2s while running
`GET /api/crawls/{crawl_id}`
```json
{
  "id": "812", "site": "shop.example.com", "status": "running", "trigger": "schedule",
  "config": { "crawler_version": "v14", "concurrency": 64 },
  "started_at": "2026-11-04T02:00:00Z", "finished_at": null,
  "elapsed_sec": 293, "eta_at": "2026-11-04T02:24:10Z", "progress_pct": 21,
  "pages": { "done": 10500, "expected": 48200, "errors": 231, "error_pct": 2.2 },
  "rate_limited_until": null,
  "steps": [
    { "id": "crawl", "kind": "step", "name": "Crawl", "status": "running", "started_at": "…", "finished_at": null,
      "expected_sec": 1260, "items_total": null, "items_done": 10500, "rate": 39, "progress_pct": 21,
      "counters": { "codes": { "2xx": 9700, "3xx": 470, "4xx": 150, "429": 0, "5xx": 40, "timeout": 41 }, "queue": 6120, "discovered": 16620 } },
    { "id": "parse", "kind": "step", "name": "Parse", "status": "waiting", "expected_sec": 60 },
    { "id": "lighthouse_full", "kind": "job", "name": "Lighthouse · full site", "status": "available", "expected_sec": 13200 }
  ],
  "history": { "durations_sec": [1260, 1302, 1188], "median_sec": 1260 }
}
```
- The follow-up job's status is `unavailable | available | running | success | failed`. It's derived; the job only gets a `crawl_steps` row once started.
- Return an `ETag` (e.g. a hash of `max(crawl_logs.id)` + the step rows). Answer `If-None-Match` with `304` when nothing changed.

### 6.2 Step time series (Metrics tab)
`GET /api/crawls/{crawl_id}/steps/{step_id}/samples?since=<iso>` → `[{ "ts", "items_done", "rate", "queue" }]`

### 6.3 Logs
| Endpoint | Purpose |
|---|---|
| `GET /api/crawls/{id}/logs?step=crawl&limit=1000` | Newest lines (tail), returned in ascending order. |
| `GET …/logs?step=crawl&before=<id>&limit=1000` | Older lines when the user scrolls up. |
| `GET …/logs?step=crawl&after=<id>` | New lines (polling fallback). |
| `GET …/logs?…&level=warning&q=timeout` | "Warnings & errors" filter (`level IN ('WARNING','ERROR')`) and search (`message LIKE '%' || :q || '%'`). |
| `GET …/logs?…&status=4xx` | Optional status-class filter (`status BETWEEN 400 AND 499`; also `5xx`, `429`, `none`). |
| `GET /api/crawls/{id}/logs/stream?step=crawl` | **SSE.** Each event `id: <log id>`, `data: <json line>`; honours `Last-Event-ID`; sends `event: end` when the step finishes. |
| `GET /api/crawls/{id}/logs/download?step=crawl` | Streamed `text/plain` download. Omit `step` for all steps. |

Line payload: `{ "id": 18234, "step": "crawl", "ts": "…", "level": "ERROR", "message": "503 GET /product/10065 (900 ms, after 3 attempts)", "status": 503, "url": "/product/10065" }`

```python
@router.get("/crawls/{crawl_id}/logs/stream")
async def stream_logs(crawl_id: str, step: str, request: Request, last_event_id: int | None = Header(None)):
    async def events():
        cursor = last_event_id or await latest_log_id(crawl_id, step)        # start at the tail
        while not await request.is_disconnected():
            rows = await fetch_logs(crawl_id, step, after=cursor, limit=500)  # SELECT … WHERE id > ? ORDER BY id
            for r in rows:
                cursor = r.id
                yield f"id: {r.id}\ndata: {r.model_dump_json()}\n\n"
            if not rows and await step_finished(crawl_id, step):
                yield "event: end\ndata: {}\n\n"; return
            await asyncio.sleep(0.5 if rows else 1.0)
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```
Polling SQLite every 0.5–1s per open stream is cheap: it's an index range scan on `(crawl_id, step_id, id)`. Use `aiosqlite`, or run the sync queries in a threadpool.

### 6.4 Pages
| Endpoint | Purpose |
|---|---|
| `GET /api/crawls/{id}/pages?filter=redirects&q=/product&page=3&page_size=50` | `{ "items": [PageRow], "total": 930, "page": 3, "page_size": 50 }`, ordered by `n` |
| `GET /api/crawls/{id}/pages/counts?q=` | `{ "all": 16700, "errors": 394, "redirects": 706, "client": 110, "skipped": 213 }` (a single `GROUP BY kind, redirect_side`) |
| `GET /api/crawls/{id}/pages.csv` | Streamed CSV, including the hop chain |

Filters:
- `errors` = `kind IN ('client_error','server_error','timeout','loop')`
- `redirects` = `kind = 'redirect'`
- `client` = `redirect_side IN ('client','mixed')`
- `skipped` = `kind = 'skipped'`

**Offset pagination (`LIMIT 50 OFFSET (page-1)*50`) is fine here:** `n` only grows, so earlier pages don't shift while the crawl adds rows, and ~50K rows per crawl is small.

`PageRow`: `{ "n", "url", "status", "kind", "redirect_side", "hops": [{ "from", "to", "via", "side" }], "final_url", "fetch_ms", "render_ms", "note" }`

### 6.5 Actions
| Endpoint | Purpose |
|---|---|
| `POST /api/crawls/{id}/retry` `{ "from_step": "transform" }` | Asks your orchestrator to re-run from that step, reusing the crawl output. Sets that step and the later ones back to `pending`/`waiting`, `attempt += 1`, and writes the retry marker log line. |
| `POST /api/crawls/{id}/jobs` `{ "type": "lighthouse_full" }` | `202`; the job appears in `steps` as `kind: "job"`. `409` if one is already running or the crawl hasn't succeeded. |
| `GET /api/crawls/{id}/lighthouse?scope=sample\|full` | `{ "pages": 200, "median": { "performance": 72, "accessibility": 91, "best_practices": 96, "seo": 98 } }` |

---

## 7. Frontend integration notes

- **Prototype-only code:**
  - `src/lib/crawl.ts` and `src/lib/pages.ts` are simulators;
  - `PrototypeBar` in the page switches scenarios and skips stages.
  - All of these are removed in slice 1.
- **Reusable components:** `LogViewer`, `DataToolbar`, `CrawlChart`, `CodesBar`, `HistoryChart` (`compact`), and `StageIcon`, `STATUS` and `StageAreaChart` in `step-ui.tsx`.
- **Data fetching:**
  - poll the summary every 2s while `status === "running"`; TanStack Query's `refetchInterval` works well for this;
  - open one `EventSource` per *visible* step's log;
  - fetch pages per page, filter and query.
- **Chart quirk:** `@chakra-ui/charts` with Recharts 3 needs the `responsive` prop on every chart.

## 8. Out of scope / later
- Changes to how the crawler crawls. This spec only defines what it reports.
- The crawl list page (`/crawls`).
- An accessibility (axe) results UI.
- Permalinks to log lines, cancel, notifications.
