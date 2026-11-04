# Implementation slices

Five vertical slices to move the prototype into the real app. Each ships something visible and leaves the page working. Details are in `SPEC.md`: §4 instrumentation, §5 SQLite storage, §6 API.

The frontend already exists in this repo, and **the crawler's behaviour doesn't change**. The work is:

1. Add `crawl_events.py` (SPEC §4.1) and its writer (§5.3).
2. Call it at the right points in the existing crawler (§4.2).
3. Add the FastAPI endpoints.
4. Swap the prototype simulator for real data.

| # | Slice | Crawler: add calls | Backend | Frontend | Done when |
|---|---|---|---|---|---|
| 1 | Shell + summary | `crawl_started`, `step_started/finished/failed` | schema, writer, `GET /crawls/{id}` | header, facts, step list | a real crawl's status and steps show live |
| 2 | Logs | `DbLogHandler` + log catalogue lines | logs, SSE, download | `LogViewer` on real data | live logs follow, search, copy and download |
| 3 | Metrics + ETA | `progress(...)`, `rate_limited(...)` | samples, ETA, medians, history | Metrics tab, progress/ETA, sparkline | charts and ETA come from real numbers |
| 4 | Pages table | `page(...)` per URL | pages, counts, CSV | Pages tab | redirects/errors/skips can be filtered, paged and exported |
| 5 | Lighthouse + retry | `lighthouse_result(...)` | jobs, scores, retry | Scores tab, full-site row, Retry | sample scores, full audit and retry work end to end |

---

## Slice 1: Schema, writer, page shell and crawl summary

**Goal:** the route renders a real crawl, and statuses update while it runs.

**Crawler (calls only)**
- Add `crawl_events.py` (SPEC §4.1) and start the writer thread once per process (§5.3).
- Call:
  - `rec = CrawlRecorder(crawl_id)` and `rec.crawl_started(site, trigger, config, steps)` where a crawl is created;
  - `rec.step_started(step_id)` / `rec.step_finished()` / `rec.step_failed(str(err))` around each step.

**Backend**
- Create the SQLite schema (SPEC §5.2) with the pragmas (§5.1).
- Writer handlers for `crawl_started`, `step_started`, `step_finished` and `step_failed`. When a crawl starts, compute `expected_sec` per step (§5.4).
- `GET /api/crawls/{crawl_id}` (SPEC §6.1): id, site, status, trigger, config, timestamps, `elapsed_sec` and `steps[]`. Leave `progress_pct`, `eta_at`, `pages` and `history` null until slice 3. Use read-only connections, plus `ETag`/`304`.

**Frontend**
- Move `src/app/crawls/[crawlId]/page.tsx` into your app at the same route. Copy `src/components/*` and `src/lib/types.ts`.
- **Delete** `PrototypeBar`, `SCENARIOS` and the `useCrawlRun` simulator usage.
- Add a `useCrawl(crawlId)` hook that polls the summary every 2s while `status === "running"`. Map `steps[]` to the existing `StepInfo` shape in `useSteps`.
- The breadcrumb `Crawls › {crawl_id}` links to your crawl list.
- Tabs show their empty states until slices 2–4.

**Acceptance**
- [ ] `/crawls/<real id>` shows the correct status badge, Started, Duration, Config and step list.
- [ ] While a crawl runs, step statuses change within ~2s, without a reload.
- [ ] After a failure, the failed step is selected and the later steps show "Not run · an earlier step failed".
- [ ] The crawler is no slower with the writer running (records are queued, never written inline).

---

## Slice 2: Logs

**Goal:** real, live logs for every step, with no console scraping.

**Crawler (calls only)**
- Attach `DbLogHandler` to the `crawler` logger; the existing console output is unchanged.
- Call `log_request(...)` (SPEC §4.1) for **every HTTP request**, including each redirect hop and each retry. It writes the standard status-first line.
- Make sure the other lines in the **log catalogue** (SPEC §4.3) are emitted where they happen:
  - step start/command;
  - seeds/estimate;
  - a summary every 15–30s;
  - rate limits, render crashes;
  - the step result or failure.
- Add `extra={"data": {...}}` with the fields listed there.

**Backend**
- A writer handler for `log`.
- Endpoints (SPEC §6.3):
  - `GET …/logs` with `after`, `before`, `limit`, `level` and `q`;
  - `GET …/logs/stream` (SSE with `Last-Event-ID`);
  - `GET …/logs/download`.

**Frontend**
- Feed `LogViewer` from a `useStepLogs(crawlId, stepId)` hook that:
  1. loads the tail (`limit=1000`);
  2. opens an `EventSource` on `/logs/stream` while the step is running, and appends lines;
  3. loads `before=<first id>` when the list reaches the top (Virtuoso `startReached`).
- Search (debounced 300ms) and "Warnings & errors" become server-side query params.
- Download points at `/logs/download`. "Download all" in the header omits `step`.

**Acceptance**
- [ ] While running, new lines appear within about 1s and the view follows the bottom. Scrolling up pauses following and shows "↓ N new lines".
- [ ] After a network drop, the stream resumes without gaps or duplicates.
- [ ] Every request has one line with its status code first (`200 GET …`, `301 GET … → …`, `ERR GET … (timed out …)`), coloured by status class (SPEC D28).
- [ ] A crawl with ~50K request lines scrolls smoothly, and "Warnings & errors" narrows it to the 4xx/5xx/failed requests.
- [ ] Line selection, Copy and Download work; the download contains the whole log.

---

## Slice 3: Metrics, progress and ETA

**Goal:** the numbers and charts are real.

**Crawler (calls only)**
- Every 5–10s while a step runs, call `rec.progress(...)`:
  - **crawl:** `codes`, `discovered`, `queue` and `render_ms_median`;
  - **other steps:** `items_done` and `rate`.
- Values are cumulative.
- Call `rec.rate_limited(until)` when a backoff starts, and `rec.rate_limited(None)` when it ends.
- Pass `items_total` to `step_started` for the processing steps (the crawled page count) and for Lighthouse (the sample size).

**Backend**
- Writer handlers for `progress` (updates `crawl_steps` and inserts into `crawl_samples`) and `rate_limited`.
- When a crawl starts, set `crawls.expected_pages` to the median of the last 5 successful crawls (SPEC §5.4).
- The summary now fills in:
  - **`progress_pct`:** weighted by `expected_sec`;
  - **`eta_at`**;
  - **`pages`:** done, expected, errors, `error_pct`;
  - **`rate_limited_until`**;
  - **`history`:** the last 20 crawl durations plus their median.
- `GET …/steps/{step_id}/samples?since=`.

**Frontend**
- **Facts row:** Progress, "done ~HH:MM", Pages "/ ~expected" with its tooltip, Errors.
- **Metrics tab:**
  - crawl: `CrawlChart` (rate + queue + a "usual rate" line), `CodesBar`, and facts;
  - other steps: the rate chart.
- **Sparkline:** `HistoryChart compact`.
- **Rate-limit alert** on the crawl step when `rate_limited_until` is in the future.

**Acceptance**
- [ ] On a typical crawl, the ETA is within ±10% by the halfway point.
- [ ] Each fact appears once on the page (SPEC D6).
- [ ] Charts update while the Metrics tab is open, and stop polling when it closes.

---

## Slice 4: Pages table with redirects

**Goal:** per-URL results, including redirect chains and client- vs server-side redirects.

**Crawler (calls only)**
- Call `rec.page(...)` once for **every** URL the crawler finishes with: success, redirect, 4xx/5xx, timeout, loop or skipped.
- Pass the data the crawler already has:
  - the first response status and `kind`;
  - `hops` as `{from, to, via, side}` (`via` = the status code for server hops; `"meta refresh"` or `"JavaScript"` for client hops);
  - `final_url`, `fetch_ms`, `render_ms`;
  - a short `note` (skip reason, retries, timeout).
- How the crawler finds these is unchanged.

**Backend**
- A writer handler for `page`, which derives `redirect_side` and `hop_count` from `hops`.
- Endpoints (SPEC §6.4):
  - `GET …/pages` (`filter`, `q`, `page`, `page_size=50`);
  - `GET …/pages/counts`;
  - `GET …/pages.csv` (streamed).

**Frontend**
- In `PagesTable`, replace the in-browser `pageAt()` / `.filter()` / `.slice()` with:
  - a `usePages(crawlId, { filter, q, page })` query;
  - a `usePageCounts(crawlId, q)` query;
  - `total` passed to `Pagination.Root count`.
- CSV download → `/pages.csv`. Copy copies the URLs on the current page.
- Delete `src/lib/pages.ts`; keep the `PageRow` type, matching the API.

**Acceptance**
- [ ] Filters show correct counts and reset to page 1; search covers all pages.
- [ ] A 3-hop server chain expands to `/a → 302 → /b → 307 → /c/ → 308 → /c`. A JS redirect shows Status 200 and a "Client" badge. Loops show "Loop" and count under Errors.
- [ ] One-hop redirects don't expand (SPEC D12).
- [ ] Paging stays stable while the crawl adds rows.

---

## Slice 5: Lighthouse (sample + full site) and retry

**Goal:** both Lighthouse paths, and recovery from failures.

**Crawler / Lighthouse runner (calls only)**
- Wrap the existing sample run and full-site run in `step_started("lighthouse" | "lighthouse_full")` … `step_finished()`.
- Call `rec.lighthouse_result(scope, url, scores)` per audited page, and `progress(...)` every few seconds.
- How pages are picked and audited is unchanged.

**Backend**
- A writer handler for `lighthouse`. The summary includes the full-site job's derived status (SPEC §6.1).
- **`POST …/jobs {type: "lighthouse_full"}`:**
  - starts your existing full-site run;
  - `409` if one is already running, or the crawl didn't succeed.
- `GET …/lighthouse?scope=sample|full` returns the median scores.
- **`POST …/retry {from_step}`:**
  - resets that step and the later ones, and increments `attempt`;
  - writes the retry marker log line (SPEC §4.3);
  - asks your orchestrator to resume from that step.

**Frontend**
- **Scores tab** on `lighthouse` and `lighthouse_full`, from `/lighthouse`.
- **Last row of the step list:**
  - "Optional · after the run finishes", or "Optional · needs a successful run";
  - "Optional · ~3h 40m" with **Run**;
  - then a normal job row once started.
- **Starting the full audit:** the Run button, the `⋯` menu item and the "Run full audit" alert all call `POST /jobs`, then select the new row.
- **`Retry from {step}`** in the header calls `POST /retry`.

**Acceptance**
- [ ] A normal crawl ends with sample scores coloured on Lighthouse's scale.
- [ ] Run starts the full audit as its own row, with live progress, logs and scores. The crawl stays "Succeeded".
- [ ] Retrying a failed processing step starts from that step, keeps the crawl output, and the log shows "attempt 2".
- [ ] A second full-audit request while one is running is refused (button disabled; API `409`).

---

## After the slices
- Remove `src/lib/crawl.ts` once nothing imports it.
- Add a daily retention job (SPEC §5.5).
- Optional: permalinks to log lines (`#L120`), cancel, and an accessibility tab using stored axe results.
