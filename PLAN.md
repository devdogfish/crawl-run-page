# Plan: what to build, in what order

Status: agreed · 2026-11-05

This is the one plan for moving the prototype into the real app: every ticket, its order, and when each tier is done. It replaces `SLICES.md`, whose acceptance criteria are now the **Done when** lists under each tier.

Designs it points to:
- [SPEC.md](SPEC.md): the crawl run page (UI, log format, tables, endpoints).
- [docs/pages-and-issues.md](docs/pages-and-issues.md): the read side behind Pages, page detail and Issues (core, storage, element ids).
- [docs/ai.md](docs/ai.md): the three AI systems (navigation, the MCP server, Ask AI).
- Decisions: [docs/adr/](docs/adr/). Terms: [CONTEXT.md](CONTEXT.md).

It starts from the existing backend (FastAPI + SQLite + Playwright, `backend/`, the v2 "intelligence" stack). The question that orders it: **what has to be built before the next fresh crawl starts, and what can wait until it's running or finished?**

---

## 1. Verdict: don't rewrite the backend. Rewrite its edges.

The v2 backend splits cleanly into three parts, and they deserve different treatment.

| Part | What it is today | Verdict |
|---|---|---|
| **Capture** (writes, during the crawl) | `Crawl`, `PlaywrightPageVisitor`, `HttpxDiscovery`, `CrawlStore`, `ArtifactStore`, `UrlIdentity`. One navigation per page captures raw + rendered HTML, redirect chain (HTTP + meta/JS), axe desktop + mobile, links, assets, images, performance evidence. | **Keep.** This is the expensive part to get right and it already captures more than the UI needs. Add a few fields (§3), don't restructure. |
| **Analysis** (post-crawl, reads stored data only) | `CheckSuite` + `checks/*`, `FindingsLedger`, `ChangedPageLedger`, Lighthouse, `RuleStore`/`RuleMatcher`. Re-runnable with `POST /crawls/{id}/analyze`. | **Keep the engines, add one more step** that produces the shapes the UI reads (elements with HTML hash and pattern, stable pages, snapshots). Because it re-runs on stored data, none of this blocks the crawl. |
| **Read side** (API, live updates, read models) | `api.py` routes shaped for the Vue app, WebSocket fan-out of in-memory events, `overview.py`/`OverviewFacts` cache. | **Replace.** New routers and a new read-model core speaking this frontend's language ([pages-and-issues.md](docs/pages-and-issues.md) §3). Old routes stay until the Vue app is retired, then go. |

Why not a full rewrite: the deletion test. Delete `Crawl` + `CrawlStore` and every subtle thing they handle (pause at visit boundaries, compare-and-set status transitions, crash recovery, rate-limit auto-pause, redirect settle windows, duplicate final URLs, artifact dedup) has to be rediscovered. Delete `api.py` and `overview.py` and nothing is lost that the new UI needs: it asks different questions.

### What changes in SPEC.md's plan

SPEC.md §4–5 were written assuming a crawler we couldn't touch, so they add a separate `crawl_events.py` with its own writer thread and `crawls.db`. Now that we know the backend, that's the wrong seam (see [ADR 0001](docs/adr/0001-extend-v2-backend.md)):

- **No second database, no second writer.** New tables (`crawl_steps`, `crawl_samples`) go into `intelligence.db` and are written through `CrawlStore`.
- **The seam already exists: `Crawl`'s injected `publish` callback.** Today it goes straight to `CrawlService._publish_engine_event` → WebSocket subscribers. Put a **run recorder** behind it that persists steps, progress samples and log lines; WebSocket fan-out becomes optional. `Crawl` barely changes.
- **Pipeline stages become steps.** `CrawlService` already moves through stages (`crawling` → `checking` → `done`); each becomes a `crawl_steps` row with start/finish times.
- **`checkpoint()` isn't needed for pause.** `Crawl` already handles pause/resume/stop at a visit boundary through `CrawlStore.transition()`. Only "reload throughput settings on resume" is new.
- **Live updates: poll + SSE, as SPEC D17 decided.** Persisted state survives reconnects and server restarts; the in-memory WebSocket fan-out doesn't. Don't build the new UI on the WebSocket.

The SPEC's UI, log format (§4.3), table shapes (§5.2) and endpoint payloads (§6) still stand.

---

## 2. The rule that orders everything

> **If it isn't recorded during the crawl, it's gone. Everything derived from stored data can be built later and re-run.**

So the tickets fall into three tiers:

| Tier | Built | Examples |
|---|---|---|
| **0 · Before the crawl starts** | Capture-time data that can't be recovered afterwards, and the settings that decide what's crawled | step timings, progress samples, request log, skipped URLs, stylesheets, the dialog's settings |
| **1 · While it runs** | Read side of the crawl run page, so you can watch it | summary, crawls list, logs, Pages tab, pause/resume |
| **2 · After it finishes** | Read models over stored data; re-run with `analyze` until right | pages across crawls, snapshots, issues, elements, shared markup, rule catalog, custom rules, preview |
| **3 · Later** | Everything else | MCP, full-site Lighthouse job, retry from step, retention, removing v1 |

---

## 3. Vocabulary: backend names vs CONTEXT.md

The two sides use the same words for different things. Don't rename tables now (risky, no payoff mid-integration); **translate at the read-model core**, so the new API and the UI only ever say the CONTEXT.md words. Rename in code opportunistically later.

| CONTEXT.md | Backend today | Watch out |
|---|---|---|
| **Rule** (a named check: axe, Lighthouse or our own) | `Check` / `CheckInfo` / `CHECKS`, axe rules, Lighthouse audits | Backend `rules` means something else (next row). |
| **Custom rule** | `rules` table, `RuleStore`, `RuleMatcher` | Already exists server-side; the frontend keeps them in `localStorage`. |
| **Issue** (one rule failing on one page in one crawl) | `finding_keys` / `FindingsLedger` | |
| **Element** | `finding_occurrences`, `axe_instances` | |
| **Issue status** new / existing / fixed | `FindingsLedger.compare` | Same three values. |
| **Priority** P1–P4, fixed 1:1 from **severity** | `CheckInfo.priority` is set directly; axe has `impact` | Our checks need a severity; derive it from their priority (P1 → critical …). Axe `impact` = severity. |
| **Category** (4 values) | One per check module, more granular (`broken_links`, `i18n`, `indexing` …) | Needs a mapping table in the rule catalog. |
| **Page** (stable across crawls) + **Snapshot** (one crawl's view) | `pages` rows per crawl, keyed by `UrlIdentity.fetch_key` | Stable page ids are new. |
| **Change** new / changed / removed | `page_changes` / `ChangedPageLedger` | "Changed" should hash the main content, not the whole document. |
| **Step** | "stage" (`crawling`, `checking`, `done`) | |
| **Site** (`rbccm`, `rbccm-qa`, …) | `SITE_PROFILES` (rbccm, sterbccm); the crawl stores a URL | Add a site id to `crawls`. |

---

## 4. Tickets

Sizes: **S** ≤ half a day, **M** ~1 day, **L** 2–3 days. "Verify" means: check the existing code first; it may already be done.

### Tier 0 · Before the fresh crawl

The goal is a crawl whose data is complete for everything the new UI will show, even though the UI isn't wired up yet. Do them in this order; T0.1 and T0.2 unblock the rest.

| # | Ticket | Size | Why it can't wait |
|---|---|---|---|
| **T0.1** | **Schema migrations.** `create_schema` is `CREATE … IF NOT EXISTS`, which doesn't add columns to existing tables. Add a `PRAGMA user_version` migration list (numbered `ALTER`/`CREATE` steps, run at startup). **Back up `intelligence.db` and `data/artifacts/` first.** | S | Every other Tier 0 ticket adds columns or tables to a database that has old crawls in it. Those old crawls are your baselines and ETA history: don't lose them. |
| **T0.2** | **Crawl settings from the dialog reach the crawler.** Extend `CrawlRequest` with the dialog's fields (`site`, `url`, `discovery`, `exclude`, `render_js`, `respect_robots`, `delay_ms`, `timeout_s`, `concurrency`, `max_retries`, `lighthouse_sample`) plus `trigger`. Persist them as one `settings` JSON on `crawls`, plus a `site` column. Map onto `VisitPolicy` and the seed logic: `exclude` filters the queue and sitemap entries; `discovery` turns sitemap seeding / link following on or off; `respect_robots` gates on `RobotsResult`. `lighthouse_sample` replaces the `lighthouse=true` flag. `concurrency` is locked at the engine's current value (Decision 2). **Verify** `max_retries` (today "up to 3 attempts") and `render_js` (always Playwright): if the engine can't honour a field yet, reject non-default values with a `422` instead of silently ignoring them. | M | These decide *what* gets crawled. A crawl started with the wrong exclusions or discovery mode can't be fixed afterwards. |
| **T0.3** | **Steps.** Add `crawl_steps` (SPEC §5.2, in `intelligence.db`). Map the real pipeline to steps, replacing the prototype's Parse/Transform/Load/Publish: **Discover** (robots + sitemaps seed) → **Crawl** (queue loop) → **External links** (`_run_external_checks`) → **Checks** (reclassify + `CheckSuite`) → **Compare** (`FindingsLedger.record/compare` + `ChangedPageLedger`) → **Lighthouse** (sample). Full-site Lighthouse stays a job. Write start/finish/status/error from the places `CrawlService` already changes stage and `Crawl.run()` already moves between phases. | M | Step durations are what "usual duration" and the ETA are computed from. If this crawl doesn't record them, the *next* crawl has no ETA either. |
| **T0.4** | **Run recorder behind `publish`.** One small module that `CrawlService` passes as `Crawl`'s `publish` callback. It persists what `Crawl` already emits: `progress`/`stats` every 5–10 s → `crawl_steps` (latest counters) + `crawl_samples` (time series: items done, rate, queue); counters as **cumulative** totals (`codes` 2xx/3xx/4xx/429/5xx/timeout, `discovered`, `queue`, `render_ms_median`). Throttle to one sample per 5 s. It can still forward to the WebSocket fan-out so the Vue app keeps working. **Verify** what the `progress`/`stats` events carry today; add the missing counters inside `Crawl`. | M | The throughput/queue chart, response-code bar and rate history are time series. You can't reconstruct them later. |
| **T0.5** | **Request log in the one format.** Every HTTP request (each redirect hop, each retry, sitemap/robots fetches, external HEAD checks) → one `crawl_logs` line with `step_id`, `level`, `status`, `url`, `data`, in SPEC §4.3's format (`200 GET /x (412 ms)`, `301 GET /a → /b (88 ms)`, `ERR GET /x (30.0 s, timed out)`); lifecycle lines (`—   START`, `SEED`, `PROGRESS` every 15–30 s, `THROTTLE`, `PAUSE`, `RESUME`, `DONE`). One formatter function; no hand-formatted strings at call sites. **Verify** `crawl_logs`' current columns and add `step_id`, `status`, `url`, `data` if missing. Batch inserts (the recorder can buffer for ~1 s) so 50K lines don't slow the crawl. | M | Logs are only ever written once. |
| **T0.6** | **Every URL gets an outcome row, including skipped ones.** The Pages tab needs one row per URL with `kind` (ok / redirect / client_error / server_error / timeout / loop / skipped), first status, `hops` with `side` (server for HTTP, client for meta refresh / JavaScript), `final_url`, `fetch_ms`, `render_ms`, `note`. Most of it exists across `visits`, `redirect_hops` and `persist_failed_visit`. **Gaps to verify:** URLs skipped by the `ASSET` regex (today only logged as `non_html`), by `exclude`, by robots.txt, off-origin finals, duplicate finals and the `max_requests` guard each need a row with a reason; `fetch_ms` (TTFB) and `render_ms` per visit. Store it in the existing tables plus a view, or a `crawl_pages` table (SPEC §5.2) written alongside `persist_visit`: either is fine as long as it's written during the crawl. | M | A skipped URL that isn't recorded is invisible forever. |
| **T0.7** | **Store stylesheets.** Save each stylesheet body the page loads, content-addressed in `ArtifactStore` (same gzip + hash as HTML), with a page → stylesheet link (`page_assets` already lists them). Deduped, a whole site's CSS is a few MB. **Don't store script bodies**: the preview iframe is sandboxed without `allow-scripts`, so JavaScript never runs there, and the rendered DOM already holds its effects. Keep scripts' URL, hash and size (already captured for the minification check). Images, video and fonts stay unstored (SPEC §6.6). | S | The live render shows the page as crawled. Pointing it at the live site's CSS works until the CSS changes, and then old crawls render wrong. |
| **T0.8** | **Element data on axe instances.** For each failing element, **verify** the stored target selector and the HTML snippet (keep at least ~2 KB untrimmed, so the HTML hash is stable). The HTML hash, the element pattern (selector without positions) and shared-markup counts are derived later (T2.3). No screenshots or element boxes (Decision 1). | S | Selector and HTML come from the live DOM. |
| **T0.9** | **Smoke crawl.** Start a small crawl on the QA site (`max_requests` ≈ 300, www.sterbccm.com) and check with SQL: steps have times, samples arrive every ~5 s, every request has a log line, skipped URLs have rows, stylesheets are stored, settings are persisted, `analyze` still runs. Then start the full crawl. | S | Cheaper than finding a gap 20 minutes into the real crawl. |

Optional before the crawl, if it's a long one: **T1.6 (live settings on resume)**. Today a 429 auto-pauses the crawl; resuming with the same delay just hits 429 again.

**Done when** (Tier 0):
- [ ] The smoke crawl (T0.9) has step times, samples every ~5 s, a log line per request, a row per skipped URL, stored stylesheets and its settings, and `analyze` still runs.
- [ ] The crawler is no slower with the recorder running (records are buffered, never written inline per request).

### Tier 1 · While it runs (the crawl run page)

| # | Ticket | Size |
|---|---|---|
| **T1.1** | **New router + base path.** v1 already owns `/api/...` and v2 `/api/v2/...`. Mount the new routes at `/api/v3` (one constant in the frontend), with short-lived read-only connections, as v2 already does. | S |
| **T1.2** | **Sites + crawls list.** `GET /sites` (from `SITE_PROFILES` + the four site ids; add `rbcits`/`rbcits-qa` profiles), `GET /crawls?site=&status=&q=&page=` with counts and facts (SPEC §6.0). `POST /crawls` → `CrawlService.create_crawl` with T0.2's settings. | M |
| **T1.3** | **Crawl summary** `GET /crawls/{id}` (SPEC §6.1) from `crawls` + `crawl_steps` + latest samples: `progress_pct` weighted by usual step durations, `eta_at`, `pages.expected` (median of the last 5 successful crawls of the site), `history`. `ETag`/`304`. Map v2's statuses (`interrupted`, `stopped` …) to the UI's. | M |
| **T1.4** | **Backfill history** for crawls made before T0.3: crawl durations and page counts from `crawls` and `pages`, so the first fresh crawl already shows an expected page count and an ETA. One-off script. | S |
| **T1.5** | **Logs** `GET /crawls/{id}/logs` with `step`, `after`, `before`, `limit`, `level`, `q`, `status` + `GET …/logs/download`. Polling `?after=` first; SSE (`…/logs/stream`) when the polling version works. | M |
| **T1.6** | **Pause / resume / settings** → the existing `transition()`. `PATCH …/settings` only while paused, editable keys only, writes the `UPDATE` log line; `Crawl` re-reads throughput settings when it resumes. | S |
| **T1.7** | **Pages tab** `GET …/pages?filter=&q=&page=`, `…/pages/counts`, `…/pages.csv` over T0.6's rows (SPEC §6.4). | M |
| **T1.8** | **Samples** `GET …/steps/{step}/samples?since=` for the Metrics tab. | S |
| **T1.9** | **Frontend:** replace `crawls-list.ts`, `crawl.ts`, `pages.ts` and `sites.ts` with queries (TanStack Query, `refetchInterval: 2000` while running); delete `PrototypeBar`; enable New crawl. | L |

**Done when** (Tier 1):
- [ ] The site switcher lists every site with its logo; switching changes the crawls list and facts, and is remembered after a reload.
- [ ] `/<site>/crawls` shows real crawls with working search, status filters, counts, pagination and CSV; a row opens its run page.
- [ ] A running crawl's step statuses change within ~2 s without a reload. After a failure, the failed step is selected and later steps show "Not run · an earlier step failed".
- [ ] Logs: new lines appear within ~1 s and the view follows the bottom; scrolling up pauses it and shows "↓ N new lines". After a network drop, the stream resumes without gaps or duplicates.
- [ ] Every request has one log line with its outcome first (`200 GET …`, `301 GET … → …`, `ERR GET … (timed out)`); lifecycle lines are muted. ~50K lines scroll smoothly, and "Warnings & errors" narrows to failures. Selection, Copy and Download work; the download is the whole log.
- [ ] Progress, ETA, pages, errors and the rate-limit alert come from real numbers; on a typical crawl the ETA is within ±10% by halfway. Each fact appears once on the page. Charts poll only while the Metrics tab is open.
- [ ] Pages tab: filters show correct counts and reset to page 1; search covers all pages. A 3-hop server chain expands; a JS redirect shows Status 200 and a "Client" badge; loops show "Loop" and count as errors; one-hop redirects don't expand. Paging stays stable while rows are added.
- [ ] New crawl starts from the current site's URL and opens the new run page. Pause stops new requests within ~1 s and the clock stops; Resume continues. While paused, Target and Discovery can't change (UI locked, API `422`); throughput settings can, and the change shows in the log and the rate after resuming.

### Tier 2 · After the crawl (Pages, Issues, page detail)

All of this reads stored data. Build it against the finished crawl and re-run `analyze` until the numbers are right.

| # | Ticket | Size |
|---|---|---|
| **T2.1** | **Rule catalog.** One table of every rule: our checks (`CHECKS`), axe rules, Lighthouse audits, with title, **category** (the 4), **severity**, priority, WCAG criterion, why, how to fix, references. Severity for our checks comes from their current priority. | M |
| **T2.2** | **Stable pages and snapshots.** A `page` table (site + normalised path, stable id across crawls) and `snapshot` (crawl, page, status, title, h1, page type, content hash of the **main content**) built by a new pipeline step from existing `pages` rows and stored HTML. Backfill for old crawls so baselines work. | M |
| **T2.3** | **Elements.** A pipeline step that turns `axe_instances` and check results into `element` rows: `html_hash`, `pattern` (selector with `:nth-*` positions removed), shared-markup counts per crawl, and a **stable element `id`**: a short hash of `(page, rule, selector, html_hash)`, the same in every crawl, so links and the assistant's references survive new crawls ([pages-and-issues.md](docs/pages-and-issues.md) §3 "Ids"). Settle the id before anything links to it. Issue status (new / existing / fixed) by element identity `(page, rule, selector, html_hash)`, consistent with `FindingsLedger.compare` (or replacing it for the new API). | L |
| **T2.4** | **Read-model core** `core/pages.py` and `core/issues.py` (`find_pages`, `get_page`, `find_issues`, `get_issue` by element id, latest crawl by default) and `core/handoff.py` (the prompt text for an issue or a page, shared by Copy as prompt, Ask AI and the MCP prompt), tested through their interface against a seeded database ([pages-and-issues.md](docs/pages-and-issues.md) §3, §5). Plus a site-level `issues_by_rule` for the Issues page and rule detail. | L |
| **T2.5** | **Routes** for Pages, page detail, Issues, rule detail, `GET /api/v3/issues/{id}`; exports (`?format=prompt|json`). Frontend swaps `site-pages.ts`, `page-issues.ts`, `site-issues.ts` for queries, and `resolveIssue` in `refs.ts` for `GET /api/v3/issues/{id}` (chips and fix cards get a loading state); the page detail's `?issue=` takes the element id instead of a position in the list. | L |
| **T2.6** | **Preview endpoint.** Serve a snapshot's rendered HTML with stylesheet links rewritten to `/api/v3/assets/{hash}` (T0.7) and a `<base>` for images; Source view serves the raw HTML. Frontend: remove the Screenshot mode from `page-detail.tsx` / `page-preview.tsx`; the issue-panel crop uses the live render. | M |
| **T2.7** | **Custom rules on the server.** Move them from `localStorage` to the existing `RuleStore`/`RuleMatcher`. Add what the dialog has and the backend may not: scope (content / attributes / source), found vs missing, page type filter, priority, category. Match counts per page from `rule_match_cache`. | M |
| **T2.8** | **Lighthouse scores** `GET …/lighthouse?scope=sample` from `LighthouseStore`, and per-page performance on Pages. | S |
| **T2.9** | **Ask AI on the corporate gateway** ([ai.md](docs/ai.md) §5, §6, [ADR 0003](docs/adr/0003-three-ai-systems.md)). Includes `assistant/gateway.py` with its fake, which navigation reuses. `GET /api/v3/assistant/seed` (visible prompts from `core/handoff.py`), `POST /api/v3/chat` (adds the system prompt, accepts only user and assistant messages, streams server-sent events), `GET /api/v3/assistant/system`. `gateway.py` is the only code that knows the gateway, with `fake_gateway.py` for tests. Frontend: seeds from the seed route; `streamAnswer` in `mock-ai.ts` becomes the chat call; delete the scripted answers. Needs T2.4; answers to the gateway questions in ai.md §6 first. | M |

**Done when** (Tier 2):
- [ ] Comparing two crawls gives the same counts in the tabs and in the API.
- [ ] An element present in the baseline and gone now shows under Fixed.
- [ ] Header and footer elements are marked Shared and point to the template.
- [ ] A link to an element made before a new crawl still opens that element, or shows it as fixed.
- [ ] Every filter and the URL state survive a reload.
- [ ] Ask AI (T2.9): Fix, Explain and Summarize send exactly the prompt the panel shows; answers stream in; chips and fix cards resolve from ids on any page; a gateway error shows as a short message.

### Tier 3 · Later

AI systems ([docs/ai.md](docs/ai.md)). Both need T2.4; neither needs the other or T2.9:

| # | Ticket | Size |
|---|---|---|
| **T3.1** | **MCP server** (ai.md §4): read tools for sites, crawls, logs, pages, issues, rules and Lighthouse over the core; the `fix_issue` prompt from `core/handoff.py`; stdio entry and the `/mcp` mount. Write tools only later, behind auth. | M |
| **T3.2** | **URL map** (ai.md §2): `url-map.json` with every route, parameter and allowed value; the pages read their parameters from it; the backend builds `ui_url` from it. Needed by T3.3, and by T3.1's `ui_url`. | S |
| **T3.3** | **Navigation, Cmd/Ctrl+K** (ai.md §3): the palette with instant matches; `POST /api/v3/navigate` via `gateway.complete_json`, validated against the URL map on the server and in the browser; filter chips before going. Reuses T2.9's gateway client, or builds it first if T2.9 isn't done. | M |

**Done when** (AI):
- [ ] MCP: the Inspector lists the tools with typed inputs; `find_issues` accepts a full URL, a path or an id and defaults to the latest crawl; a missing page returns an error naming the latest crawl that has it; in Claude Code, "list the P1 issues on <page> and fix the first one" works end to end.
- [ ] Navigation: the five examples in ai.md §3.1 land on the right URL; an answer with an unknown parameter or value never reaches the address bar; with the gateway down, instant matches still work.

Other later work:
- **Full-site Lighthouse job** and **retry from step** (SPEC §6.5). Done when: Run starts the full audit as its own row with live progress, logs and scores, and the crawl stays "Succeeded"; a second request while one runs is refused (`409`); retrying a failed step starts from that step, keeps the crawl output, and the log shows "attempt 2".
- **Concurrent crawling:** a worker pool sized by `settings.concurrency`, with per-host pacing and the rate-limit guard working across workers; then unlock the field in the dialog.
- **Retention:** delete logs, samples and per-URL rows of crawls older than 30–90 days.
- **Retire** v1 (`main.py` routes, `crawler.py`, `db.py`, `LegacyArchive`), the WebSocket fan-out, and `overview.py`/`OverviewFacts` once nothing reads them. `ManualWcagStore` has no screen in the new UI yet: keep its tables, drop its routes later if nothing needs them.
- **Rename** internals toward the glossary (`checks` → rules, `findings` → issues) when touching those files anyway.

---

## 5. Decisions (agreed 2026-11-05)

1. **No screenshots; Live render is the only preview mode** ([ADR 0002](docs/adr/0002-live-render-only-preview.md)). The crawler captures no screenshots or element boxes. The page preview renders the stored HTML with the stored stylesheets (T0.7), and the crop in the issue panel comes from the live render too. The frontend drops the Screenshot / Live render toggle.
2. **Concurrency is locked for now.** The dialog shows the engine's current value read-only, and the API rejects any other value with a `422`. A real worker pool (per-host pacing, rate-limit guard across workers) is a Tier 3 ticket.
3. **The old `intelligence.db` is kept and migrated in place** (T0.1). Its crawls are the baselines for new/fixed and the history for ETAs.
