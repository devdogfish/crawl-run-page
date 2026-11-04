# Crawl run page: spec

Status: agreed design, ready to integrate · Last updated: 2026-11-04
Stack: Next.js + **Chakra UI v3** (frontend) · **FastAPI** + Postgres (backend)

This document captures everything decided while designing the crawl run page: the questions that came up, the recommendations, what was agreed, the UI, the data model and the API. `SLICES.md` breaks the integration into 5 slices.

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

During the **crawl**, each URL is fetched over HTTP, redirects are followed, and the page is rendered in headless Chromium (Playwright). axe-core also runs, but its results stay off this page (see D11).

---

## 2. Decisions (questions asked → what we agreed)

| # | Question / feedback | Decision |
|---|---|---|
| D1 | Simple numbered steppers look "vibe-coded". | Model the page on real CI/orchestration run pages (GitHub Actions, Vercel, Dagster, Buildkite), built from pre-built Chakra components. Research: `docs/research-enterprise-pipeline-ui.md`. |
| D2 | Steps are sequential, but I want to click into each one and see its logs. | Step list plus a detail pane. Every step can be selected and has Logs and Metrics. |
| D3 | Logs and a badge aren't enough. I need loading states and graphs. | Running steps show progress bars. The crawl has a throughput/queue chart and a response-code bar; other steps have a rows/sec chart. |
| D4 | Must use Chakra. | Chakra UI v3 plus `@chakra-ui/charts` (Recharts 3). The only other UI dependency is `react-virtuoso` for the log. |
| D5 | The crawl is ~90% of the run, and the page total is roughly known from previous crawls. | The crawl gets real progress and an ETA. Expected pages = **median** of the last 5 crawls; ETA = remaining pages ÷ recent rate + usual time of the remaining steps. |
| D6 | Too much repeated information. | **Show each fact once.** Status, progress and ETA live in the header; pages and rate in the facts row; queue and rate on the crawl chart; errors on the response bar; "usual" only as chart reference lines. |
| D7 | The double/segmented progress bar looks bad. | One small progress bar inside the facts row, shown only while running. When the run is finished it is replaced by facts (trigger, duration…), not a full green bar. |
| D8 | Still looks like components dropped into an accordion. | **Page layout:** breadcrumb → title + status + actions → facts row → two panes (step list on the left, selected step with tabs on the right). |
| D9 | The history chart has too many labels. | A compact sparkline: one line of text ("23m 23s / 21m median"), a dashed median line and a dot for this run. No axes or grid; hover shows each run. |
| D10 | Median or average? | **Median**, for "usual duration", ETA and expected pages. Crawl times have occasional slow outliers (rate limits, slow nights, sitemap explosions). The median ignores them; the average gets pulled up. Use averages only for totals (e.g. hours crawled per month). UI label: "median" (or "typical" if users find that clearer). |
| D11 | Don't overdo accessibility on the crawl page, but show the technical details: redirect hops, and whether a redirect is client- or server-side. | The Pages table drops axe columns and shows **Status** (first response), **Redirect** (Server / Client / Mixed / Loop, plus "N hops" when there are 2+) and **Final URL**. Multi-hop rows expand into a one-line chain: `/a → 302 → /b → JavaScript → /c`. |
| D12 | Repeated info in redirect rows. | One-hop redirects don't expand; the row already says everything. The chain shows each URL once, with the hop type on the arrow. |
| D13 | Reuse the same table header (toolbar) as the logs. | One `DataToolbar` (search, filter segments, count, copy, download) is shared by Logs and Pages. |
| D14 | Pagination or virtualization? | **Logs:** a virtualized list that loads more on scroll (continuous stream). **Pages table:** numbered pagination, 50 rows per page, with filtering and sorting on the server (records people search, sort and link to). Never load every row into the browser. |
| D15 | Lighthouse usually runs on a subset; full site only sometimes, never during the crawl. | Lighthouse **sample** (200 pages, stratified by template) is a normal step after Load. **Full site** is an optional **follow-up job**: same level as the steps, last row of the step list, with a **Run** button once the run has succeeded. It reuses the crawl output (no re-crawl), runs separately (~3h 40m), and has its own logs, progress and scores. |
| D16 | Logging: print to the console and read it back, or a custom function? What goes in a log line? | Use Python `logging` plus a handler that writes **structured** records to Postgres; keep the console handler for developers. Never scrape stdout. See §6. |
| D17 | Stream logs live, or poll? | **Status/metrics:** poll every 2s (small JSON). **Logs:** SSE for the open step, resuming with `Last-Event-ID`. Polling with `?after=<id>` is an acceptable first version. No WebSockets: data only flows one way. |
| D18 | How do I collect metrics during processing? | Each step writes a progress row every few seconds (`items_total`, `items_done`, counters JSON). Charts and ETAs come from those rows, **never by parsing log text**. |
| D19 | 50K log lines: won't the client struggle? | A virtualized list (only the visible rows are in the DOM). Load the newest ~1,000 lines, fetch older ones on scroll up, filter on the server. |
| D20 | How do I keep the log scrolled to the bottom? | "Follow" pattern: stick to the bottom while the user is at the bottom; pause when they scroll up and show "↓ N new lines"; clicking it resumes (`react-virtuoso` `followOutput`). |
| D21 | How much should be logged? Every redirect, skip, success? | **Per-page outcomes are data, not logs.** Each URL is a row in `crawl_pages`. The log only gets milestones, a summary every 15–30s, each 5xx/timeout/render crash, retries, rate limits and step failures. Successes, redirects, normalisation skips and individual 4xx are **counted** (a single summary line is fine for 4xx). |
| D22 | Should users be able to copy or export logs? | Yes. Click a line number to select it, shift-click for a range; Copy; Download full log (`.txt`, served by the server). Pages export as `.csv`. |
| D23 | Breadcrumb. | `Crawls › {crawl_id}`; title "Crawl {crawl_id}". |

---

## 3. UI spec

Route: **`/crawls/[crawlId]`** (`src/app/crawls/[crawlId]/page.tsx`).

### 3.1 Header
- **Breadcrumb:** `Crawls › {crawl_id}`.
- **Title:** "Crawl {crawl_id}" plus **one** status badge: Crawling, Processing, Succeeded or Failed (a pulsing dot while running).
- **Actions** (right):
  - `Retry from {step}`, only when failed;
  - `Logs` (download all logs);
  - a `⋯` menu with "Run Lighthouse on full site" (enabled after the Lighthouse sample succeeds) and "Copy link".
- **Facts row** (Chakra `DataList`, 6 items):

| Fact | Content |
|---|---|
| Progress | Small bar + %, only while running. When finished, this slot shows **Trigger** (e.g. "Schedule · daily 02:00"). |
| Started | Absolute time, UTC. |
| Elapsed / Duration | Elapsed time, plus "· done ~HH:MM" while running. |
| Pages | Fetched count; while crawling "/ ~48.2K", with a tooltip explaining the median of the last 5 crawls. |
| Errors | % of fetched pages, plus the count (4xx + 429 + 5xx + timeouts). |
| Config | Crawler version · concurrency. |

### 3.2 Step list (left, sticky)
- **Row content:** icon, name, one-line subtitle, and duration (or `~usual` if not started). Running rows add a thin progress bar.
- **Statuses:** `pending`, `waiting`, `running`, `success`, `failed` and `blocked` ("Not run · an earlier step failed").
- **Selection:**
  - the running step is auto-selected (or the failed step after a failure);
  - once the user clicks a row, that choice sticks;
  - locked rows can't be clicked.
- **Last row, Lighthouse · full site** (optional job, same level as the steps):
  - before the run finishes: "Optional · after the run finishes";
  - after a failed run: "Optional · needs a successful run";
  - after success: "Optional · ~3h 40m" with a **Run** button;
  - once started: a normal step row.
- **Below the list:** the crawl-duration sparkline (D9).

### 3.3 Step pane (right)
- **Header:** icon, name, a badge only for non-running/non-success states, description, `Started HH:MM:SS`, duration / usual.
- **Progress line:** a thin striped bar at the top while running.
- **Alerts:**
  - **Failed:** an error alert with the message and "Later steps did not run. The crawl output is kept, so a retry starts here without crawling again."
  - **Rate limited (crawl):** a warning alert.
- **Tabs:**

| Tab | Shown for | Content |
|---|---|---|
| Logs (count) | all | `LogViewer` (D19–D22) |
| Metrics | all | **Crawl:** rate, URLs discovered, queue, median render, throughput+queue chart (with a "usual rate" line), response-code bar. **Other steps:** progress, items, usual duration, rows/sec chart. Empty state before data. |
| Pages (count) | crawl | Paginated table (D11–D14) |
| Scores | Lighthouse steps | 4 Lighthouse scores (Performance, Accessibility, Best Practices, SEO) as `ProgressCircle`s, coloured on Lighthouse's scale (≥90 green, ≥50 orange, else red). The sample step offers "Run full audit". |

### 3.4 Pages table
- **Toolbar** (`DataToolbar`):
  - search URLs;
  - filters with counts: **All · Errors · Redirects · Client-side · Skipped**;
  - copy visible URLs;
  - download all as CSV.
- **Columns:** `#` · URL (as requested) · Status (first response) · Redirect · Fetch (ms) · Render (s) · Final URL / note.
- **Redirect column:**
  - a type badge: Server (blue), Client (purple), Mixed (orange) or Loop (red);
  - "N hops" plus a chevron when there are 2+ hops, and clicking expands the chain.
- **Status semantics:** a client-side redirect shows `200` (the server answered normally and the page then redirected). Loops show the first status and count as Errors.
- **Notes:** skipped (e.g. "Duplicate of /x after URL normalisation"), retried 5xx, timeout, redirect loop.
- **Pagination:** 50 rows per page (Chakra `Pagination`: "101 – 150 of 930", page buttons). Changing the filter or search resets to page 1.

### 3.5 Visual rules
- Each fact once (D6).
- Badges only where they add something: no "Succeeded" badge on every row.
- Mono font for numbers, times, URLs and log text; tabular numbers.
- A dark log surface in both themes.
- Lighthouse colours follow Lighthouse's own scale; status colours follow the `STATUS` map in `src/components/step-ui.tsx`.

---

## 4. Data model (Postgres)

```sql
create table crawls (
  id            text primary key,              -- shown in breadcrumb
  site          text not null,
  status        text not null,                 -- running | success | failed | cancelled
  trigger       text not null,                 -- 'schedule' | 'manual' | ...
  config        jsonb not null,                -- crawler version, concurrency, lighthouse_sample_size
  expected_pages integer,                      -- median of last 5 crawls, set at start
  started_at    timestamptz not null,
  finished_at   timestamptz
);

create table crawl_steps (                     -- one row per step AND per follow-up job
  crawl_id      text references crawls(id),
  step_id       text,                          -- crawl | parse | transform | load | lighthouse | publish | lighthouse_full
  kind          text not null,                 -- 'step' | 'job'
  position      smallint not null,
  status        text not null,                 -- pending | waiting | running | success | failed | blocked
  started_at    timestamptz,
  finished_at   timestamptz,
  expected_sec  integer,                       -- median duration of this step over recent crawls
  items_total   integer,                       -- known after the crawl (pages) / sample size
  items_done    integer default 0,
  counters      jsonb default '{}',            -- step-specific: codes{2xx..}, queue, rows_written, scores{}
  error         text,
  attempt       smallint default 1,
  primary key (crawl_id, step_id)
);

create table crawl_samples (                   -- time series for charts, one row every ~5-10s per running step
  crawl_id text, step_id text, ts timestamptz,
  rate real,                                   -- pages/s (crawl), rows/s, pages/min (lighthouse)
  queue integer,                               -- crawl only
  items_done integer
);
create index on crawl_samples (crawl_id, step_id, ts);

create table crawl_logs (
  id        bigserial primary key,             -- cursor for after/before + SSE Last-Event-ID
  crawl_id  text not null,
  step_id   text not null,
  ts        timestamptz not null,
  level     text not null,                     -- INFO | WARNING | ERROR (+ CMD for commands)
  message   text not null,
  data      jsonb                              -- url, status, duration_ms, ...
);
create index on crawl_logs (crawl_id, step_id, id);

create table crawl_pages (                     -- one row per URL: the per-page detail lives HERE, not in logs
  crawl_id     text not null,
  n            integer not null,               -- 1..N in crawl order (stable, dense)
  url          text not null,                  -- as requested
  status       smallint,                       -- first response status; null for skipped/timeout
  kind         text not null,                 -- ok | redirect | client_error | server_error | timeout | loop | skipped
  redirect_side text,                          -- server | client | mixed | null
  hops         jsonb,                          -- [{from, to, via: "301"|"302"|"307"|"308"|"meta refresh"|"JavaScript", side}]
  final_url    text,
  fetch_ms     integer,
  render_ms    integer,
  note         text,                           -- skip reason, retry info, loop info
  primary key (crawl_id, n)
);
create index on crawl_pages (crawl_id, kind, n);
create index on crawl_pages (crawl_id, redirect_side, n) where redirect_side is not null;

create table lighthouse_results (
  crawl_id text, scope text,                   -- 'sample' | 'full'
  url text, performance smallint, accessibility smallint, best_practices smallint, seo smallint,
  primary key (crawl_id, scope, url)
);
```

**Retention:** delete `crawl_logs` and `crawl_samples` after 30–90 days. Keep `crawls`, `crawl_steps` (for history and medians) and, optionally, `crawl_pages` for the last N crawls.

**Detecting client-side redirects:** compare the requested URL with `page.url` after Playwright's `load` and network-idle. If it changed without a 3xx, the redirect was client-side. Inspect the DOM for `<meta http-equiv="refresh">` to label it "meta refresh"; otherwise label it "JavaScript". Cap chains at 10 hops, and mark a revisited URL as `loop`.

---

## 5. API (FastAPI)

All under `/api`. Times are ISO 8601 UTC. Pydantic models mirror the payloads below.

### 5.1 Crawl summary (poll every 2s while running, stop when finished)
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
      "expected_sec": 1260, "items_total": 48200, "items_done": 10500, "progress_pct": 21,
      "counters": { "codes": { "2xx": 9700, "3xx": 470, "4xx": 150, "429": 0, "5xx": 40, "timeout": 41 }, "queue": 6120, "discovered": 16620, "rate": 39 } },
    { "id": "parse", "kind": "step", "name": "Parse", "status": "waiting", "expected_sec": 60 },
    { "id": "lighthouse_full", "kind": "job", "name": "Lighthouse · full site", "status": "available", "expected_sec": 13200 }
  ],
  "history": { "durations_sec": [1260, 1302, …], "median_sec": 1260 }
}
```
- `progress_pct` and `eta_at` are computed **on the server**:
  - progress is weighted by each step's `expected_sec`, so the crawl counts for ~87% of the bar;
  - the ETA uses the median rate and medians of the steps (D5, D10).
- The follow-up job's `status` is `unavailable | available | running | success | failed`.
- Return an `ETag`. The client sends `If-None-Match`, and the server answers `304` when nothing changed.

### 5.2 Step time series (Metrics tab, polled while the tab is open)
`GET /api/crawls/{crawl_id}/steps/{step_id}/samples?since=<iso>` → `[{ "ts", "rate", "queue", "items_done" }]`

### 5.3 Logs
| Endpoint | Purpose |
|---|---|
| `GET /api/crawls/{id}/logs?step=crawl&limit=1000` | Newest page (tail), ascending by id. |
| `GET …/logs?step=crawl&before=<id>&limit=1000` | Older lines when the user scrolls up. |
| `GET …/logs?step=crawl&after=<id>` | New lines (polling fallback). |
| `GET …/logs?…&level=warning&q=timeout` | Server-side "Warnings & errors" filter and search. |
| `GET /api/crawls/{id}/logs/stream?step=crawl` | **SSE**, `text/event-stream`. Each event `id: <log id>`, `data: <json line>`; honours the `Last-Event-ID` header; sends `event: end` when the step finishes. |
| `GET /api/crawls/{id}/logs/download?step=crawl` | `text/plain` streamed download (`Content-Disposition: attachment`). Omit `step` for all steps. |

Line payload: `{ "id": 18234, "step": "crawl", "ts": "…", "level": "ERROR", "message": "503 Service Unavailable: /product/10065", "data": { "url": "…", "status": 503 } }`

SSE sketch:
```python
@router.get("/crawls/{crawl_id}/logs/stream")
async def stream_logs(crawl_id: str, step: str, request: Request, last_event_id: int | None = Header(None)):
    async def events():
        cursor = last_event_id or await latest_log_id(crawl_id, step)   # start at the tail
        while not await request.is_disconnected():
            rows = await fetch_logs(crawl_id, step, after=cursor, limit=500)
            for r in rows:
                cursor = r.id
                yield f"id: {r.id}\ndata: {r.model_dump_json()}\n\n"
            if not rows and await step_finished(crawl_id, step):
                yield "event: end\ndata: {}\n\n"; return
            await asyncio.sleep(0.5 if rows else 1.0)
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```
(Polling the table every 0.5–1s per open stream is fine at this scale. Postgres `LISTEN/NOTIFY` or Redis can replace it later.)

### 5.4 Pages
| Endpoint | Purpose |
|---|---|
| `GET /api/crawls/{id}/pages?filter=redirects&q=/product&page=3&page_size=50` | `{ "items": [PageRow], "total": 930, "page": 3, "page_size": 50 }`, ordered by `n`. |
| `GET /api/crawls/{id}/pages/counts?q=` | `{ "all": 16700, "errors": 394, "redirects": 706, "client": 110, "skipped": 213 }` (filter badges). |
| `GET /api/crawls/{id}/pages.csv` | Streamed CSV of every row, including the hop chain. |

Filters:
- `errors` = `kind in (client_error, server_error, timeout, loop)`
- `redirects` = `kind = redirect`
- `client` = `redirect_side in (client, mixed)`
- `skipped` = `kind = skipped`

**Why offset pagination is fine here:** rows are ordered by `n`, which only grows, so new pages append at the end and earlier pages don't shift while the crawl runs. At ~50K rows per crawl, `OFFSET` on `(crawl_id, kind, n)` is cheap. Switch to keyset (`n > last_n`) only if crawls reach millions of URLs.

`PageRow`: `{ "n", "url", "status", "kind", "redirect_side", "hops": [{ "from", "to", "via", "side" }], "final_url", "fetch_ms", "render_ms", "note" }`

### 5.5 Actions
| Endpoint | Purpose |
|---|---|
| `POST /api/crawls/{id}/retry` `{ "from_step": "transform" }` | Re-runs from the failed step and reuses the crawl output; `attempt += 1`. Logs get a marker line "── Retry · attempt 2 · crawl output reused ──". |
| `POST /api/crawls/{id}/jobs` `{ "type": "lighthouse_full" }` | `202` → the job appears in `steps` as `kind: "job"`. `409` if one is already running, or the run hasn't succeeded. |
| `POST /api/crawls/{id}/cancel` | Optional. |
| `GET /api/crawls/{id}/lighthouse?scope=sample\|full` | `{ "pages": 200, "median": { "performance": 72, "accessibility": 91, "best_practices": 96, "seo": 98 } }` |

---

## 6. Logging (backend)

```python
# logging_setup.py
import logging, contextvars
crawl_id_var = contextvars.ContextVar("crawl_id", default=None)
step_var = contextvars.ContextVar("step", default=None)

class CrawlLogHandler(logging.Handler):
    """Queue structured records for crawl_logs; a background task inserts them in batches."""
    def emit(self, record):
        if crawl_id_var.get() is None:
            return  # not part of a crawl → console only
        LOG_QUEUE.put_nowait({
            "crawl_id": crawl_id_var.get(), "step_id": step_var.get(), "ts": record.created,
            "level": record.levelname, "message": record.getMessage(), "data": getattr(record, "data", None),
        })

log = logging.getLogger("crawler")
log.addHandler(logging.StreamHandler())   # console, for developers
log.addHandler(CrawlLogHandler())         # database, for the UI
```
Usage: `crawl_id_var.set(...)`, `step_var.set("crawl")`, then `log.error("503 Service Unavailable: %s", path, extra={"data": {"url": url, "status": 503}})`.

- **Batch inserts** (every 1s or 100 lines). Don't insert row by row from the crawler's hot path.
- **Levels:**
  - INFO: milestones and periodic summaries;
  - WARNING: timeouts, retries, rate limits;
  - ERROR: 5xx, render crashes, step failures.
  - DEBUG is never stored.
- **Never log secrets** (tokens, cookies, auth headers). The UI shows log lines to users.
- **What to log vs store:** see D21.

---

## 7. Frontend integration notes

- **Prototype-only code:**
  - `src/lib/crawl.ts` and `src/lib/pages.ts` are simulators;
  - `PrototypeBar` in the page switches scenarios and skips stages.
  - All of these are removed in slice 1.
- **Reusable components:** `LogViewer`, `DataToolbar`, `CrawlChart`, `CodesBar`, `HistoryChart` (`compact`), and `StageIcon`, `STATUS` and `StageAreaChart` in `step-ui.tsx`.
- **Data fetching:**
  - poll the summary with a 2s interval while `status === "running"`; TanStack Query's `refetchInterval` works well for this;
  - open one `EventSource` per *visible* step's log;
  - fetch pages per page, filter and query.
- **Chart quirk:** `@chakra-ui/charts` with Recharts 3 needs the `responsive` prop on every chart.

---

## 8. Out of scope / later
- The crawl list page (`/crawls`). The prototype redirects it to a sample crawl.
- Accessibility (axe) results UI. It could become its own tab or page later (D11).
- Permalinks to a log line (`#L120`), cancel, notifications.
