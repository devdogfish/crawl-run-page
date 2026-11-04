# Implementation slices

Five vertical slices to move the prototype into the real app. Each one ships something visible, can be reviewed on its own, and leaves the page working. Endpoint, table and payload details are in `SPEC.md` (§4 data model, §5 API, §6 logging).

The frontend for every slice already exists in this repo. The work is mostly backend endpoints, plus swapping the simulator for real data.

| # | Slice | Backend | Frontend | Done when |
|---|---|---|---|---|
| 1 | Page shell + summary | `crawls`, `crawl_steps`, `GET /crawls/{id}` | header, facts, step list | the page shows a real crawl's status and steps, live |
| 2 | Logs | `crawl_logs`, logging handler, logs + SSE + download | `LogViewer` on real data | live logs follow, search, copy and download |
| 3 | Metrics + progress | `crawl_samples`, counters, ETA, history | Metrics tab, progress/ETA, sparkline | charts and ETA come from real numbers |
| 4 | Pages table | `crawl_pages` incl. redirect hops, pages/counts/CSV | Pages tab | redirects, errors and skips can be filtered, paged and exported |
| 5 | Lighthouse + retry | sample step, follow-up job, scores, retry | Scores tab, full-site row, Retry | sample scores, full audit and retry work end to end |

---

## Slice 1: Page shell and crawl summary

**Goal:** the route renders a real crawl, and statuses update while it runs.

**Backend**
- Tables `crawls` and `crawl_steps` (SPEC §4). The orchestrator writes step transitions:
  - `pending → waiting → running → success | failed`;
  - the steps after a failure become `blocked`.
- `GET /api/crawls/{crawl_id}` (SPEC §5.1): id, site, status, trigger, config, timestamps, `elapsed_sec`, `pages.done` and `steps[]`. Leave `progress_pct`, `eta_at` and `history` null for now (slice 3).
- Add `ETag` / `304` support.

**Frontend**
- Move `src/app/crawls/[crawlId]/page.tsx` into your app at the same route. Copy `src/components/*` and `src/lib/types.ts`.
- **Delete** `PrototypeBar`, `SCENARIOS` and the `useCrawlRun` simulator usage.
- Add a `useCrawl(crawlId)` hook that polls the summary every 2s while `status === "running"`. Map `steps[]` to the existing `StepInfo` shape (`useSteps` is the mapping point).
- Breadcrumb `Crawls › {crawl_id}` links to your crawl list.
- Until slices 2–4 land, the tabs show their empty states.

**Acceptance**
- [ ] Opening `/crawls/<real id>` shows the correct status badge, facts (Started, Duration, Pages, Config) and step list.
- [ ] While a crawl runs, step statuses change within ~2s, without a reload.
- [ ] The running step is auto-selected; clicking another step keeps that selection.
- [ ] A failed crawl shows the failed step, and the later steps show "Not run · an earlier step failed".

---

## Slice 2: Logs

**Goal:** real, live logs for every step, with no console scraping.

**Backend**
- Table `crawl_logs`, and the `CrawlLogHandler` with batched inserts (SPEC §6).
  - Set `crawl_id_var` and `step_var` where each step starts.
  - Keep the console handler.
- Apply the logging policy (SPEC D21):
  - **log:** milestones, a summary every 15–30s, each 5xx/timeout/render crash, retries, rate limits and step failures;
  - **don't log:** successes, redirects, skips or individual 4xx (count them instead).
- Endpoints (SPEC §5.3):
  - `GET …/logs` with `after`, `before`, `limit`, `level` and `q`;
  - `GET …/logs/stream` (SSE with `Last-Event-ID`);
  - `GET …/logs/download`.

**Frontend**
- `LogViewer` takes `lines`; feed it from a `useStepLogs(crawlId, stepId)` hook that:
  1. loads the tail (`limit=1000`);
  2. opens an `EventSource` on `/logs/stream` while the step is running, and appends lines;
  3. loads `before=<first id>` when the list reaches the top (Virtuoso `startReached`).
- Move search and "Warnings & errors" to server-side query params, debouncing search by 300ms.
- Download: point at `/logs/download` instead of building the blob in the browser. "Download all" in the header omits `step`.

**Acceptance**
- [ ] While running, new lines appear within about 1s and the view follows the bottom. Scrolling up pauses following and shows "↓ N new lines".
- [ ] After a network drop, the stream resumes without gaps or duplicates (`Last-Event-ID`).
- [ ] A step with more than 50K lines stays smooth, and scrolling up loads older lines.
- [ ] Line selection, Copy and Download work; the download contains the whole log, not just the loaded part.

---

## Slice 3: Metrics, progress and ETA

**Goal:** the numbers and charts are real.

**Backend**
- Each running step writes:
  - **`crawl_samples`** every 5–10s: crawl rate (pages/s) and queue; rows/s for processing steps.
  - **`crawl_steps.counters`**: response-code buckets (`2xx`, `3xx`, `4xx`, `429`, `5xx`, `timeout`), `discovered`, `queue`, `rate`, and `rate_limited_until` when backing off.
- At crawl start, set:
  - `crawls.expected_pages` = **median** pages of the last 5 successful crawls;
  - `crawl_steps.expected_sec` = median duration per step.
- The summary endpoint now fills in:
  - **`progress_pct`:** weighted by `expected_sec`;
  - **`eta_at`:** remaining pages ÷ median of the recent rate, plus the expected seconds of the remaining steps;
  - **`pages.errors` / `error_pct`**;
  - **`history`:** the last 20 crawl durations plus their median.
- `GET …/steps/{step_id}/samples?since=`.

**Frontend**
- **Facts row:** Progress (bar and %), "done ~HH:MM", Pages "/ ~expected" with its tooltip, Errors.
- **Metrics tab:**
  - crawl: `CrawlChart` (rate + queue, plus a "usual rate" line = expected_pages ÷ median crawl seconds), `CodesBar`, and facts (rate, discovered, queue, median render);
  - other steps: `StageAreaChart`.
- **Sparkline:** `HistoryChart compact` with "duration / median".
- **Rate-limit alert** on the crawl step when `rate_limited_until` is set.

**Acceptance**
- [ ] On a typical crawl, the ETA is within ±10% by the halfway point.
- [ ] Each fact appears once on the page (SPEC D6).
- [ ] Charts update while the Metrics tab is open, and stop polling when it closes.

---

## Slice 4: Pages table with redirects

**Goal:** per-URL results, including redirect chains and client- vs server-side redirects.

**Backend**
- The crawler writes one `crawl_pages` row per URL (SPEC §4), batched:
  - the status of the first response; `kind`;
  - `hops[]` from the HTTP redirect chain (`via` = status code, `side = server`);
  - after the Playwright render, an extra hop if `page.url` changed: `via` = `meta refresh` or `JavaScript`, `side = client`;
  - `redirect_side` = server, client or mixed;
  - a loop is detected when a URL is revisited (cap at 10 hops);
  - `note` for skip reasons, retries and timeouts.
- Endpoints (SPEC §5.4):
  - `GET …/pages` (`filter`, `q`, `page`, `page_size=50`);
  - `GET …/pages/counts`;
  - `GET …/pages.csv` (streamed).

**Frontend**
- In `PagesTable`, replace the in-browser `pageAt()` / `.filter()` / `.slice()` with:
  - a `usePages(crawlId, { filter, q, page })` query;
  - a `usePageCounts(crawlId, q)` query for the filter badges;
  - `total` passed to `Pagination.Root count`.
- CSV download → `/pages.csv`. Copy copies the URLs on the current page.
- Delete `src/lib/pages.ts`; keep the `PageRow` type, matching the API.

**Acceptance**
- [ ] Filters show correct counts and reset to page 1; search works across all pages, not just the loaded one.
- [ ] A 3-hop server chain expands to `/a → 302 → /b → 307 → /c/ → 308 → /c`. A JS redirect shows Status 200 and a "Client" badge. A loop shows "Loop" and counts under Errors.
- [ ] One-hop redirects don't expand (SPEC D12).
- [ ] Paging stays stable while the crawl adds rows.

---

## Slice 5: Lighthouse (sample + full site) and retry

**Goal:** both Lighthouse paths, and recovery from failures.

**Backend**
- **The `lighthouse` step** runs after Load on a **stratified sample** (default 200 pages across page templates; configurable in `crawls.config`). It writes `lighthouse_results (scope='sample')` and its median scores to `counters.scores`.
- **`POST …/jobs {type: "lighthouse_full"}`:**
  - allowed only when the crawl succeeded and no full job is running (otherwise `409`);
  - reuses the crawl output, runs in a separate worker, and is never part of the crawl;
  - shows up in `steps[]` as `kind: "job"` with its own logs, samples (pages/min) and progress;
  - `expected_sec` comes from the median per-page time of previous full audits.
- `GET …/lighthouse?scope=sample|full`.
- **`POST …/retry {from_step}`:**
  - resets that step and the ones after it, and increments `attempt`;
  - reuses the crawl output (never re-crawls when the failure happened after the crawl);
  - writes the retry marker line to the step's log.

**Frontend**
- **Scores tab** on `lighthouse` and `lighthouse_full`: 4 `ProgressCircle`s from `/lighthouse`.
- **Last row of the step list:**
  - "Optional · after the run finishes", or "Optional · needs a successful run";
  - "Optional · ~3h 40m" with **Run**;
  - then a normal job row once started.
- **Starting the full audit:** the **Run** button, the `⋯` menu item and the "Run full audit" alert all call `POST /jobs`, then select the new row.
- **`Retry from {step}`** in the header calls `POST /retry`. The step pane's failure alert explains that the crawl output is kept.

**Acceptance**
- [ ] A normal crawl ends with the sample's scores coloured on Lighthouse's scale.
- [ ] Clicking Run starts the full audit as its own row, with live progress, logs and scores. The crawl itself stays "Succeeded".
- [ ] A failure in Transform shows a retry option; retrying starts at Transform, keeps the crawl, and the log shows "attempt 2".
- [ ] A second full-audit request while one is running is refused (button disabled; API `409`).

---

## After the slices
- Remove `src/lib/crawl.ts` once nothing imports it.
- Add retention jobs for `crawl_logs` and `crawl_samples` (30–90 days).
- Optional: permalinks to a log line (`#L120`), a cancel action, and an accessibility tab using the stored axe results.
