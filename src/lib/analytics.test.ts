import { describe, expect, it } from "vitest";
import { attention, diff, history, snapshot } from "./analytics";
import { RULE_CATALOG } from "./page-issues";
import { PRIORITY } from "./priority";
import { hitsFor } from "./site-issues";
import { defaultCrawl, pagesFor } from "./site-pages";

const site = "rbcits-qa";
const crawl = Number(defaultCrawl(site).id);

describe("analytics issue filters", () => {
  it.each(["shared", "page"] as const)("uses the same P2 %s hits for every issue count", (markup) => {
    const issueFilter = { pri: ["P2"] as const, markup };
    const hits = hitsFor(site, crawl, null).filter((hit) =>
      hit.shared === (markup === "shared") && PRIORITY[RULE_CATALOG[hit.rule].severity] === "P2");
    const count = new Set(hits.map(({ p, rule }) => `${p.i}:${rule}`)).size;
    const affectedPages = new Set(hits.map(({ p }) => p.i));
    const snap = snapshot(site, {}, issueFilter);

    expect(count).toBeGreaterThan(0);
    expect(snap.pages).toBe(pagesFor(site, crawl, null).length);
    expect(snap.issues).toBe(count);
    expect(snap.elements).toBe(hits.reduce((sum, hit) => sum + hit.elements, 0));
    expect(snap.priority.P2.pages).toBe(affectedPages.size);
    expect(snap.priority.P2.issues).toBe(count);
    expect(snap.rules.reduce((sum, rule) => sum + rule.pages, 0)).toBe(count);
    expect(Object.values(snap.category).reduce((sum, cat) => sum + cat.issues, 0)).toBe(count);
    expect(snap.p1Pages).toBe(0);
    expect(snap.worstPages).toEqual({ P1: 0, P2: affectedPages.size, P3: 0, P4: 0, none: snap.pages - affectedPages.size });
    expect(snap.shared.issues).toBe(markup === "shared" ? count : 0);
    expect(snap.specific.issues).toBe(markup === "page" ? count : 0);
    expect(snap.fixes.length > 0).toBe(markup === "shared");
    expect(history(site, snap).at(-1)).toMatchObject({ P1: 0, P2: count, P3: 0, P4: 0 });

    const rows = attention(site, {}, issueFilter, snap.pages);
    expect(new Set(rows.map(({ page }) => page.i))).toEqual(affectedPages);
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(count);

    const delta = diff(site, {}, issueFilter);
    expect(delta.byPriority.P2).toEqual({ added: delta.added, fixed: delta.fixed });
  });

  it("separates cache entries by issue filters and ignores the priority selection order", () => {
    const scoped = snapshot(site, {}, { pri: ["P3", "P2"], markup: "shared" });

    expect(snapshot(site, {}, { pri: ["P2", "P3"], markup: "shared" })).toBe(scoped);
    expect(snapshot(site, {}, { pri: ["P2", "P3"], markup: "page" })).not.toBe(scoped);
    expect(snapshot(site)).not.toBe(scoped);
  });
});
