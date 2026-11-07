# Crawler pacing, queue and schedules: requirements

Hand-off for implementation. It says what the crawler must do, not where the code goes. Terms are defined in [CONTEXT.md](../CONTEXT.md); the reasoning is in [ADR 0003](adr/0003-crawler-paces-itself-per-origin.md).

## Why

Inside the company network the crawler doesn't go through Akamai, so nothing slows it down and nothing ever answers with a 429. All production sites share one origin: an earlier crawl with no limit took every production site down at once. The old per-worker delay neither stopped requests piling up nor delivered the speed the user set. The crawler must now protect the origin itself.

Values marked *(starting value)* are defaults to begin with, not settled numbers.

## 1. Origins and their ceilings

- Every site belongs to one origin. All production sites share one origin; the QA sites share another.
- Each origin has two ceilings, set by an admin in config (not in the crawl dialog):
  - **speed ceiling**: page loads per second. Production 2 *(starting value)*, QA 1 *(starting value)*.
  - **loading cap**: pages loading at the same time. Production 4 *(starting value)*, QA 2 *(starting value)*.
- Every crawl and every Lighthouse step on an origin shares that origin's ceilings. Two crawls of two production sites together never exceed the production ceilings.
- One crawler service runs all crawls and holds the limits in memory. A crawler run locally has its own limits; a local crawl and a server crawl of production add up. That risk is accepted, so there is no guard for it.

## 2. Speed limit (per crawl)

- The user sets a speed limit in **pages per second** (decimals allowed, e.g. 0.5).
- It is a **ceiling, not a target**. The crawl goes as fast as it safely can, up to `min(crawl speed limit, origin speed ceiling)`.
- What counts toward it:
  - each page load (the HTML document request), including retries and redirects followed;
  - each request the page makes to the same origin whose response can't be cached (`no-store`, `no-cache`, `private`, or no `max-age`), such as XHR/API calls. These are only known after the page loads, so they are charged after the fact.
- What doesn't count: static files with `public, max-age` (CSS, JS, images, fonts) and requests to other hosts.
- The speed limit can only be changed while the crawl is paused (same as the other throughput settings).

## 3. Pages loading at once

- A page holds a loading slot from the start of its load until the page has loaded (network quiet). It releases the slot before any local work: saving HTML, axe, rules, Lighthouse scoring.
- No more pages than the origin's current loading cap are loading at once, across all crawls on that origin. If the origin slows down, slots are held longer and the crawl slows by itself. Requests can't pile up.

## 4. Strain

Strain is how the crawler notices the origin struggling, because nothing will send a 429.

- **Baseline**: the median response time of page loads in the crawl's first minute.
- **Strain** when, over the last 60 s:
  - the median page response time is more than 3× the baseline, or
  - more than 5% of page loads ended in a 5xx or a timeout.
- **On strain**: halve the origin's loading cap (minimum 1) and log it.
- **When strain clears**: raise the cap by 1 per minute without strain, up to the configured cap *(not discussed; suggested)*.
- **Strain lasting 3 minutes**: pause the crawl. It stays paused until a person resumes it (no auto-resume, including overnight).
- The run page shows strain, not "rate limited". Remove the 429-based "Rate limited" state.

## 5. The crawl step: one load per page

- Each page is loaded once in Chrome. That load gives the raw server HTML (from the document response), the rendered HTML, the axe results, the rule results, and the links to follow.
- The load waits until the network is quiet, not a fixed timer.
- **Time limits per page**: 30 s for the server response, 60 s for the whole page *(starting values)*. When one is hit, the tab is closed, the page gets a "timed out" issue, and the crawl carries on. Timeouts count toward strain.
- **Chrome restarts**: each worker's Chrome restarts after 200 pages, or sooner when its memory passes a limit.
- **Heavy-page rules**: ordinary performance rules with fixed thresholds, measured from the same load at no extra cost, e.g. page weight over 3 MB, more than 100 requests *(starting values)*.

## 6. The Lighthouse step

Lighthouse stays its own step after the crawl step. It loads its pages again, through the same origin limits as the crawl.

- **Lighthouse coverage** is chosen before the crawl starts and can't change during it:
  - **Off**: no Lighthouse step.
  - **Sample** (default): the Lighthouse sample (below).
  - **Every page**.
- **Lighthouse sample**, chosen after the crawl step, when every page is known:
  - every page that is new or changed since the baseline crawl;
  - plus a random 10% of the unchanged pages of each page type, at least 50 (or all of them if the type has fewer than 50);
  - Other pages get 15% instead of 10%.
  - First crawl of a site (no baseline): no page is "new or changed", so only the random sample is audited.
- **Cache**: audits keep the browser cache between pages, except the first sampled page of each page type, which starts with an empty cache (first-visit scores).
- **Workers**: a fixed number of Lighthouse workers per machine (start at 1 per 2 CPU cores), recorded with the crawl so scores compare between crawls.
- **Reporting**: Lighthouse scores for new or changed pages are shown separately from the scores for all audited pages, so progress is visible.
- **Full audit later**: a finished crawl audited with Off or Sample can later get a Lighthouse audit of every page. It belongs to that crawl, holds the site's slot (section 7) while it runs, and is refused while another Lighthouse step of that crawl is running. Results reflect the pages as they are at audit time.

## 7. Queue (one crawl per site)

- A site has at most **one crawl in progress** (running or paused) and at most **one crawl waiting**.
- Starting a crawl while one is in progress puts it in the waiting place. Starting another while one is already waiting is refused with a clear message.
- The waiting crawl starts when the one in progress succeeds, fails or is stopped. Its settings are fixed when it is queued.
- A waiting crawl can be cancelled.
- Different sites don't wait for each other. Crawls of sites on the same origin run at the same time and share the origin's limits.

## 8. Schedules

- Each site can have a schedule: **daily or weekly, at a set time**, in the server's time zone, with a saved set of crawl settings (speed limit, Lighthouse coverage, and so on). No cron expressions.
- When a schedule comes due, it starts a crawl the same way a person would (section 7). If a crawl of that site is already waiting, the scheduled crawl is **skipped**, and the site's history says so.
- If the service was off when a schedule came due, that crawl is skipped. No catch-up.
- No time windows: a scheduled crawl runs until it ends, at any hour. The speed limit keeps the origin safe.
- Schedules can be edited, turned off and deleted.

## 9. What the user sees

- **Crawl settings**: drop delay, concurrency (workers) and Lighthouse sample size. Keep timeout and retries. Add the speed limit (pages per second) and Lighthouse coverage.
- **Run page**: the actual pages per second next to the speed limit, and why it's lower when it is. For example: "at speed limit", "held by the origin's ceiling", "slowed: strain (median 2.4 s, 4× start)", "limited by processing", "paused: strain".
- **Log lines**: strain starts and ends, loading cap changes, pauses caused by strain, skipped schedules, timed-out pages, Chrome restarts.

## 10. Out of scope

Auto-resume after strain, catch-up crawls, time windows for schedules, limits shared across several machines, and a guard against local and server crawls of production running at once.

## 11. Checks that prove it works

- Two crawls of two production sites, each with a speed limit of 2, together never exceed 2 page loads per second.
- With the loading cap at 4, no more than 4 pages are ever loading at once on that origin, across all crawls.
- With a fast origin, a speed limit of 2 and Lighthouse off, the crawl holds close to 2 pages per second.
- If the origin's response time triples, the loading cap halves within a minute; if that lasts 3 minutes, the crawl pauses and waits for a person.
- Static files don't change the measured rate; a page's uncacheable API calls do.
- A page that never finishes loading is recorded as timed out, and the crawl carries on.
- A second manual start while a crawl is waiting is refused; a schedule that comes due then is skipped and shown in the history.
- The Lighthouse sample includes every new or changed page and at least 50 pages (or all) of each page type.
