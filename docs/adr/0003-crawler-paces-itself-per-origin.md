# The crawler paces itself per origin, and Lighthouse is its own step

Inside the company network the crawler doesn't go through Akamai, so nothing slows it down, and all production sites share one origin: an earlier crawl with no limit took every production site down at once. The old per-worker delay didn't protect the origin (64 workers × 250 ms still allowed up to 256 requests a second, and requests piled up when the origin slowed) and didn't deliver the speed the user set, because Lighthouse, axe and fixed waits ran inside the same loop. So the crawler service keeps one gate per origin that every crawl on it shares: a speed limit in page loads per second (a ceiling the user sets, never above the origin's own ceiling, which an admin sets) and a cap on pages loading at once. Static files don't count toward the speed limit. Strain (responses much slower than at the start of the crawl, or server errors and timeouts) halves the cap, and the crawl pauses for a person to resume if it lasts.

Lighthouse runs as its own step after the crawl step, loading its pages again through the same gate, instead of inside the crawl's page load. Doing it in one load would save a few hundred requests per crawl but tie Lighthouse into the pacing code; the speed limit, not the total number of requests, is what keeps the origin safe.

## Consequences

- One crawler service per environment, holding the gates in memory. A crawler run locally has its own gate, so a local crawl and a server crawl of production add up; we accept that risk.
- Nothing returns a 429 inside the network, so the run page shows strain, not "rate limited".
- The crawl settings lose delay, concurrency and Lighthouse sample size; they keep the speed limit, timeout and retries, and add Lighthouse coverage (off, a Lighthouse sample, or every page). A crawl audited with a sample can later get a full audit.
- Lighthouse audits run with a fixed number of workers per machine, recorded with the crawl, so performance scores compare between crawls.
