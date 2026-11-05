# Extend the existing v2 backend instead of adding a separate event store

SPEC.md §4–5 proposed a standalone `crawl_events.py` with its own writer thread and `crawls.db`, on the assumption that the crawler couldn't be touched. The existing v2 backend already has a persistence layer (`CrawlStore` over `intelligence.db`), an injected `publish` seam on `Crawl`, and pause/resume through compare-and-set status transitions, so we put a run recorder behind `publish` and add the new tables (`crawl_steps`, `crawl_samples`) to `intelligence.db` instead. A second database and writer would split one crawl's state across two files with two transaction boundaries, and duplicate pause logic the engine already has.

## Consequences

- The new UI reads persisted state by polling (and SSE for logs), not the in-memory WebSocket fan-out, which stays only for the old Vue app.
- Schema changes to `intelligence.db` need real migrations (`PRAGMA user_version`), because it holds the crawls that serve as baselines.
