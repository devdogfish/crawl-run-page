import { describe, expect, it } from "vitest";
import { attention, diff, history, links, snapshot } from "./analytics";
import { RULE_CATALOG } from "./page-issues";
import { PRIORITIES, PRIORITY } from "./priority";
import { hitsFor } from "./site-issues";
import { crawlChoices, defaultCrawl, pagesFor, totalIssues } from "./site-pages";

const site = "rbcits-qa";
const crawl = Number(defaultCrawl(site).id);

describe("analytics issue filters", () => {
  it.each(PRIORITIES.flatMap((priority) => (["shared", "page"] as const).map((markup) => ({priority, markup}))))("uses the same $priority $markup hits for every issue count", ({priority, markup}) => {
    const issueFilter = { pri: [priority], markup };
    const hits = hitsFor(site, crawl, null).filter((hit) =>
      hit.shared === (markup === "shared") && PRIORITY[RULE_CATALOG[hit.rule].severity] === priority);
    const count = new Set(hits.map(({ p, rule }) => `${p.i}:${rule}`)).size;
    const affectedPages = new Set(hits.map(({ p }) => p.i));
    const snap = snapshot(site, {}, issueFilter);

    expect(snap.pages).toBe(pagesFor(site, crawl, null).length);
    expect(snap.issues).toBe(count);
    expect(snap.elements).toBe(hits.reduce((sum, hit) => sum + hit.elements, 0));
    expect(snap.priority[priority].pages).toBe(affectedPages.size);
    expect(snap.priority[priority].issues).toBe(count);
    expect(snap.rules.reduce((sum, rule) => sum + rule.pages, 0)).toBe(count);
    expect(Object.values(snap.category).reduce((sum, cat) => sum + cat.issues, 0)).toBe(count);
    expect(snap.p1Pages).toBe(priority === "P1" ? affectedPages.size : 0);
    expect(snap.worstPages).toEqual({ P1: 0, P2: 0, P3: 0, P4: 0, [priority]: affectedPages.size, none: snap.pages - affectedPages.size });
    expect(snap.shared.issues).toBe(markup === "shared" ? count : 0);
    expect(snap.specific.issues).toBe(markup === "page" ? count : 0);
    expect(snap.fixes.length > 0).toBe(markup === "shared" && count > 0);
    expect(history(site, snap).at(-1)).toMatchObject({ P1: 0, P2: 0, P3: 0, P4: 0, [priority]: count });

    const rows = attention(site, {}, issueFilter, snap.pages);
    expect(new Set(rows.map(({ page }) => page.i))).toEqual(affectedPages);
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(count);

    const delta = diff(site, {}, issueFilter);
    expect(delta.byPriority[priority]).toEqual({ added: delta.added, fixed: delta.fixed });
  });

  it("separates cache entries by issue filters and ignores the priority selection order", () => {
    const scoped = snapshot(site, {}, { pri: ["P3", "P2"], markup: "shared" });

    expect(snapshot(site, {}, { pri: ["P2", "P3"], markup: "shared" })).toBe(scoped);
    expect(snapshot(site, {}, { pri: ["P2", "P3"], markup: "page" })).not.toBe(scoped);
    expect(snapshot(site)).not.toBe(scoped);
  });
});


describe("cross-view snapshot consistency", () => {
  it("history points use the same scoped snapshot as the corresponding crawl", () => {
    const filter = { type: "article" as const };
    const scope = { pri: ["P2", "P3"] as const, markup: "page" as const };
    for (const point of history(site, snapshot(site, filter, scope))) {
      const current = snapshot(site, filter, scope, point.crawl);
      expect(point.pages).toBe(current.pages);
      expect(point.score).toBe(current.score);
      expect(point.P2).toBe(current.priority.P2.issues);
      expect(point.P3).toBe(current.priority.P3.issues);
    }
  });

  it("preserves crawl, baseline, page scope and multi-priority through drilldowns", () => {
    const scope = { crawl: String(crawl), vs: "none", type: "article" as const, year: "2025", pri: "P2,P3", markup: "page" as const };
    const L = links(site, scope);
    for (const url of [L.issues(), L.rule("image-alt"), L.page(0), L.pages({ type: "article", sub: "2025" })]) {
      const params = new URL(url, "https://demo.test").searchParams;
      for (const [key, value] of Object.entries(scope)) expect(params.get(key), `${url}: ${key}`).toBe(value);
    }
  });

  it("can select an older crawl instead of silently using the latest", () => {
    const older = Number(crawlChoices(site).at(-1)!.id);
    const snap = snapshot(site, {}, {}, older);
    expect(snap.crawl).toBe(older);
    expect(snap.pages).toBe(pagesFor(site, older, null).length);
  });
});


it("Overview totals equal the Pages inventory and Issues rollup across all sites", () => {
  for (const site of ["rbccm", "rbccm-qa", "rbcits", "rbcits-qa"] as const) {
    const crawl = Number(defaultCrawl(site).id);
    const snap = snapshot(site);
    const pages = pagesFor(site, crawl, null);
    const hits = hitsFor(site, crawl, null);
    expect(snap.pages).toBe(pages.length);
    expect(snap.issues).toBeGreaterThan(0);
    expect(snap.issues).toBe(pages.reduce((sum, page) => sum + totalIssues(page), 0));
    expect(snap.shared.elements + snap.specific.elements).toBe(snap.elements);
    expect(snap.shared.elements).toBe(hits.filter((hit) => hit.shared).reduce((sum, hit) => sum + hit.elements, 0));
    expect(snap.shared.issues).toBe(new Set(hits.filter((hit) => hit.shared).map((hit) => `${hit.p.i}:${hit.rule}`)).size);
  }
});


it("section totals include the root URL instead of dropping it from the donut", () => {
  const snap = snapshot("rbcits", { type: "other" });
  expect(snap.groups.reduce((sum, group) => sum + group.pages, 0)).toBe(snap.pages);
  expect(snap.groups.reduce((sum, group) => sum + group.p1Pages, 0)).toBe(snap.p1Pages);
  expect(snap.groups.find((group) => group.filter.sub === "__root__")?.label).toBe("Root pages");
});
