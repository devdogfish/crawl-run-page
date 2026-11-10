import { describe, expect, it } from "vitest";
import { archivedRun } from "./crawl";
import { crawlsFor } from "./crawls-list";
import { pageRowsFor } from "./pages";
import { pagesFor } from "./site-pages";
import { getStoredSnapshot } from "./stored-html";

describe("archived crawl replay", () => {
  it.each(["success", "failed", "cancelled"] as const)("uses the saved %s run's rows, HTTP status, timestamps and duration", (status) => {
    const site = "rbccm";
    const crawl = crawlsFor(site).find((row) => row.status === status)!;
    const id = Number(crawl.id);
    const pages = pageRowsFor(site, id);
    const run = archivedRun(status, { pages, durationSec: crawl.durationSec, startedAt: crawl.startedAt });

    expect(pages.map((page) => [page.id, page.path, page.status])).toEqual(pagesFor(site, id, null).map((page) => [page.i, page.path, page.status]));
    expect(pages.map((page) => page.fetchMs)).toEqual(pagesFor(site, id, null).map((page) => page.status < 400 ? getStoredSnapshot(page)?.responseMs ?? null : null));
    expect(run.t).toBe(crawl.durationSec);
    expect(run.crawl.done).toBe(crawl.pages);
    expect(run.crawl.logs.filter((line) => line.msg.includes(" GET "))).toHaveLength(crawl.pages);
    expect(run.crawl.codes["5xx"]).toBe(pages.filter((page) => page.status === 503).length);
    expect(run.crawl.logs.every((line) => line.t >= 0 && line.t <= run.t)).toBe(true);
    expect(run.tail.find((stage) => stage.id === "lighthouse")?.logs.filter((line) => line.msg.includes(" AUDIT "))).toHaveLength(pages.filter((page) => page.performance != null).length);
    expect(run.crawl.status === "cancelled").toBe(status === "cancelled");
    expect(run.tail.some((stage) => stage.status === "failed")).toBe(status === "failed");
  });
});
