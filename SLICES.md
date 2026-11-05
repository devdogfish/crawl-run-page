# Implementation slices

Five vertical slices to move the prototype into the real app. Each ships something visible and leaves the page working. Details are in `SPEC.md`: §4 instrumentation, §5 SQLite storage, §6 API.

The frontend already exists in this repo, and **the crawler's behaviour doesn't change**. The work is:

1. Add `crawl_events.py` (SPEC §4.1) and its writer (§5.3).
2. Call it at the right points in the existing crawler (§4.2).
3. Add the FastAPI endpoints.
4. Swap the prototype simulator for real data.

| # | Slice | Crawler: add calls | Backend | Frontend | Done when |
|---|---|---|---|---|---|
| 1 | Crawls list + run shell | `crawl_started`, `step_started/finished/failed` | schema, writer, `GET /crawls`, `GET /crawls/{id}` | crawls page, header, facts, step list | real crawls list, and a real crawl's status and steps show live |
| 2 | Logs | `DbLogHandler`, `log_request` / `log_line` / `log_event` | logs, SSE, download | `LogViewer` on real data | every step logs in the one format; live logs follow, search, copy and download |
| 3 | Metrics + ETA | `progress(...)`, `rate_limited(...)` | samples, ETA, medians, history | Metrics tab, progress/ETA, sparkline | charts and ETA come from real numbers |
| 4 | Pages table | `page(...)` per URL | pages, counts, CSV | Pages tab | redirects/errors/skips can be filtered, paged and exported |
| 5 | Controls + Lighthouse | `checkpoint()`, `lighthouse_result(...)` | create, pause/resume, settings, retry, jobs, scores | New crawl, Pause/Resume/Settings, Retry, Scores, full-site row | crawls can be started, paused, re-tuned, resumed and retried; Lighthouse works end to end |

---

## Slice 1: Schema, writer, crawls list and run page shell

**Goal:** `/crawls` lists real crawls, and `/crawls/{id}` renders a real crawl whose statuses update while it runs.

**Crawler (calls only)**
- Add `crawl_events.py` (SPEC §4.1) and start the writer thread once per process (§5.3).
- Call:
  - `rec = CrawlRecorder(crawl_id)` and `rec.crawl_started(environment, url, trigger, settings, steps)` where a crawl is created;
  - `rec.step_started(step_id)` / `rec.step_finished()` / `rec.step_failed(str(err))` around each step.

**Backend**
- Create the SQLite schema (SPEC §5.2) with the pragmas (§5.1).
- Writer handlers for `crawl_started`, `step_started`, `step_finished` and `step_failed`. When a crawl starts, compute `expected_sec` per step (§5.4).
- Table `sites` + `GET /api/sites` (SPEC §5.2, §6.0); seed RBC CM and RBC ITS with their environment URLs.
- `GET /api/crawls?site=` (SPEC §6.0): list with status/search/environment filters, counts, facts and pagination.
- `GET /api/crawls/{crawl_id}` (SPEC §6.1): id, environment, url, status, trigger, settings, timestamps, `elapsed_sec` and `steps[]`. Leave `progress_pct`, `eta_at`, `pages` and `history` null until slice 3. Use read-only connections, plus `ETag`/`304`.

**Frontend**
- Move `src/app/crawls/page.tsx` and `src/app/crawls/[crawlId]/page.tsx` into your app at the same routes. Copy `src/components/*`, `src/lib/types.ts` and `src/lib/settings.ts`.
- **Navbar:** mount `AppNavbar` inside `SiteProvider` (see `src/app/layout.tsx`). Load the sites from `GET /api/sites` instead of `src/lib/sites.ts`, and put the official logo files in `/public/sites/`.
- **Crawls page:** replace `CRAWLS` (from `src/lib/crawls-list.ts`) with a `useCrawls({ status, q, page })` query. Leave the **New crawl** button disabled until slice 5.
- **Run page:** **delete** `PrototypeBar`, `SCENARIOS`, the `?settings=` / `CRAWLS` lookup and the `useCrawlRun` simulator usage.
- Add a `useCrawl(crawlId)` hook that polls the summary every 2s while `status === "running"`. Map `steps[]` to the existing `StepInfo` shape in `useSteps`.
- The breadcrumb `Crawls › {crawl_id}` links to your crawl list.
- Tabs show their empty states until slices 2–4.

**Acceptance**
- [ ] The site switcher lists RBC CM and RBC ITS with their logos; switching changes the crawls list and facts, and is remembered after a reload.
- [ ] `/crawls` shows the current site's real crawls with working search, status filters, counts, pagination and CSV; a row opens its run page.
- [ ] `/crawls/<real id>` shows the correct status badge, Started, Duration, Target and step list.
- [ ] While a crawl runs, step statuses change within ~2s, without a reload.
- [ ] After a failure, the failed step is selected and the later steps show "Not run · an earlier step failed".
- [ ] The crawler is no slower with the writer running (records are queued, never written inline).

---

## Slice 2: Logs

**Goal:** real, live logs for every step, with no console scraping.

**Crawler (calls only)**
- Attach `DbLogHandler` to the `crawler` logger; the existing console output is unchanged.
- Add the three helpers (SPEC §4.1). They all produce the **one format** `<outcome> <ACTION> <subject> (<duration>, details)` (SPEC §4.3, D29):
  - `log_request(...)` for **every HTTP request** in the crawl and in Lighthouse, including each redirect hop and retry;
  - `log_line("OK"|"ERR", ACTION, subject, ms=…)` for each unit of work in the other steps: parse batches, dbt models, table writes, audits, dashboards, messages;
  - `log_event(ACTION, subject, …)` for lifecycle lines: START, SEED, PROGRESS every 15–30s, THROTTLE, DONE / STOP.
- Don't hand-format messages anywhere else.

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
- [ ] Every request has one line with its status code first (`200 GET …`, `301 GET … → …`, `ERR GET … (timed out)`), coloured by outcome (SPEC D28).
- [ ] Parse, Transform, Load, Lighthouse and Publish logs use the same shape (`OK  BUILD table … (31.0 s, …)`), and lifecycle lines (`—   START …`) are muted (SPEC D29).
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

## Slice 5: Controls (new crawl, pause/resume, settings, retry) and Lighthouse

**Goal:** users can start, pause, re-tune, resume and retry crawls; both Lighthouse paths work.

**Crawler (calls only)**
- Call `settings = rec.checkpoint()` before each request (and each unit of work in the other steps). It blocks while paused and returns the current throughput settings (SPEC §5.5).
- Use `settings["delay_ms"]`, `["timeout_s"]`, `["max_retries"]` for the next request, and match the worker pool to `settings["concurrency"]`. Lighthouse reads `["lighthouse_sample"]` when it starts.

**Lighthouse runner (calls only)**
- Wrap the existing sample run and full-site run in `step_started("lighthouse" | "lighthouse_full")` … `step_finished()`.
- Call `rec.lighthouse_result(scope, url, scores)` per audited page, and `progress(...)` every few seconds.
- How pages are picked and audited is unchanged.

**Backend**
- `POST /api/crawls` with `site` (SPEC §6.0) to start a crawl from the dialog.
- `POST …/pause`, `POST …/resume` and `PATCH …/settings` (SPEC §6.5). The settings endpoint accepts **only** the editable keys and only while paused. Each action writes its `—   PAUSE` / `UPDATE` / `RESUME` log line.
- Elapsed time and the ETA exclude `paused_sec`.
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
- **New crawl** in the navbar: `CrawlSettingsDialog mode="create"` for the current site → `POST /crawls` → navigate to the new crawl.
- **Run page header:** `Pause` while running; `Settings` + `Resume` while paused. `Settings` opens `CrawlSettingsDialog mode="paused"`: Target and Discovery locked, Throughput editable. Save calls `PATCH /settings`; "Save and resume" also calls `/resume`. The `⋯` menu opens the dialog read-only (`mode="view"`) at other times.
- **Scores tab** on `lighthouse` and `lighthouse_full`, from `/lighthouse`.
- **Last row of the step list:**
  - "Optional · after the run finishes", or "Optional · needs a successful run";
  - "Optional · ~3h 40m" with **Run**;
  - then a normal job row once started.
- **Starting the full audit:** the Run button, the `⋯` menu item and the "Run full audit" alert all call `POST /jobs`, then select the new row.
- **`Retry from {step}`** in the header calls `POST /retry`.

**Acceptance**
- [ ] New crawl: picking an environment fills the current site's URL; Start crawl opens the new run page.
- [ ] Pause stops new requests within about a second, the badge shows Paused and the clock stops. Resume continues from where it stopped.
- [ ] While paused, Target and Discovery can't be changed (UI locked, API `422`). Delay, timeout, concurrency, retries and Lighthouse sample can, and the change is visible in the log and in the crawl rate after resuming.
- [ ] A normal crawl ends with sample scores coloured on Lighthouse's scale.
- [ ] Run starts the full audit as its own row, with live progress, logs and scores. The crawl stays "Succeeded".
- [ ] Retrying a failed processing step starts from that step, keeps the crawl output, and the log shows "attempt 2".
- [ ] A second full-audit request while one is running is refused (button disabled; API `409`).

---

## After the slices
- Remove `src/lib/crawl.ts` once nothing imports it.
- Add a daily retention job (SPEC §5.6).
- Optional: permalinks to log lines (`#L120`), cancel, and an accessibility tab using stored axe results.
