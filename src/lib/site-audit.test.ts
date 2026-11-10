import { expect, test } from "vitest";
import { crawlsFor, crawlFixture } from "@/lib/crawls-list";
import { RULE_CATALOG, pageIssues } from "@/lib/page-issues";
import { byRule, elementOf, hitsFor } from "@/lib/site-issues";
import { CATEGORIES, currentIssueCounts, issuesIn, linksTo, normalizeTarget, pageView, pagesFor, totalIssues } from "@/lib/site-pages";
import { SITE_IDS } from "@/lib/sites";

test("Pages counts the same distinct current issues as Page Detail and Issues", () => {
  const site = "rbccm", crawl = 811;
  const page = pageView(site, 23062, crawl, null)!;
  const { html, instances } = pageIssues(page, crawl, null);
  const siteRows = byRule(hitsFor(site, crawl, null).filter((hit) => hit.p.i === page.i), "all");

  expect(html).toContain('data-ix="0"');
  expect(instances.filter((element) => element.rule === "button-name")).toHaveLength(6);
  expect(siteRows.map((row) => row.rule.id).sort()).toEqual(["button-name", "heading-order", "render-blocking-resources"]);
  expect(siteRows.reduce((sum, row) => sum + row.elements, 0)).toBe(9);
  expect(totalIssues(page)).toBe(3);
  expect(currentIssueCounts(page).byPriority).toEqual({ P1: 1, P2: 0, P3: 2, P4: 0 });
  expect(CATEGORIES.map(({ id }) => issuesIn(page, id))).toEqual([2, 1, 0, 0]);
});

test("missing Lighthouse coverage leaves performance unknown and does not report fixed findings", () => {
  const site = "rbccm", crawl = 811, baseline = 810;
  const page = pageView(site, 1, crawl, baseline)!;
  expect(page.vitals).toBeNull();
  expect(pageView(site, page.i, baseline, null)?.vitals).toBeTruthy();
  expect(issuesIn(page, "performance")).toBeNull();
  expect(pageIssues(page, crawl, baseline).instances
    .filter((element) => RULE_CATALOG[element.rule].category === "performance")).toEqual([]);
});

test("a failed fetch has no crawl findings and preserves the separately captured document", () => {
  const site = "rbccm", crawl = 800;
  const page = pageView(site, 27184, crawl, null)!;
  const detail = pageIssues(page, crawl, null);

  expect(page.status).toBe(503);
  expect(totalIssues(page)).toBe(0);
  expect(detail.instances).toEqual([]);
  expect(detail.html).toContain("Global Research");
  expect(hitsFor(site, crawl, null).some((hit) => hit.p.i === page.i)).toBe(false);
});

test("rule patterns retain both shared and page-specific occurrences", () => {
  const hits = hitsFor("rbccm", 811, null).filter((hit) => hit.rule === "heading-order" && hit.pattern === "h2 followed by h4");
  const [row] = byRule(hits, "all");

  expect(row.patterns).toMatchObject([{ shared: true, specific: true }]);
  expect(byRule(hits.filter((hit) => hit.shared), "all")[0].patterns).toMatchObject([{ shared: true, specific: false }]);
  expect(byRule(hits.filter((hit) => !hit.shared), "all")[0].patterns).toMatchObject([{ shared: false, specific: true }]);
});

test("removed pages are excluded from current counts and retain fixed element links to the baseline", () => {
  const site = "rbccm", crawl = 810, baseline = 809;
  const page = pageView(site, 457, crawl, baseline)!;
  expect(page.change).toBe("removed");
  expect(totalIssues(page)).toBe(0);
  const { instances } = pageIssues(page, crawl, baseline);
  const before = pageIssues(pageView(site, page.i, baseline, null)!, baseline, null).instances;
  expect(instances).not.toHaveLength(0);
  expect(instances.map(({ k, status }) => [k, status])).toEqual(before.map(({ k }) => [k, "fixed"]));

  const hits = hitsFor(site, crawl, baseline).filter((hit) => hit.p.i === page.i);
  expect(byRule(hits, "all")).toEqual([]);
  expect(byRule(hits, "fixed").reduce((sum, row) => sum + row.elements, 0)).toBe(before.length);
  for (const hit of hits) {
    expect(instances.find((element) => element.k === elementOf(hit, "fixed"))?.status).toBe("fixed");
  }
});

test("new pages only have current new elements", () => {
  const site = "rbccm", crawl = 811, baseline = 810;
  const page = pageView(site, 457, crawl, baseline)!;
  expect(page.change).toBe("new");
  const { instances } = pageIssues(page, crawl, baseline);
  expect(instances).not.toHaveLength(0);
  expect(instances.every((element) => element.status === "new")).toBe(true);
});

test("crawl rows, Pages, and Lighthouse metrics use the same snapshot IDs", () => {
  for (const site of SITE_IDS) {
    for (const crawl of crawlsFor(site)) {
      const id = Number(crawl.id);
      const fixture = crawlFixture(site, id)!;
      const pages = pagesFor(site, id, null);
      expect(pages).toHaveLength(crawl.pages);
      expect(pages.map((page) => page.i)).toEqual(fixture.pageIds);
      expect(pages.filter((page) => page.vitals).map((page) => page.i)).toEqual(fixture.lighthousePageIds);
    }
  }
});

test("Links to uses captured anchors and distinguishes hosts with the same path", () => {
  const pages = pagesFor("rbccm", 811, null);
  const path = linksTo(normalizeTarget("/en/careers/"), pages);
  const sameSite = linksTo(normalizeTarget("https://www.rbccm.com/en/careers"), pages);
  const otherSite = linksTo(normalizeTarget("https://www.rbcis.com/en/careers"), pages);

  expect(sameSite).toEqual(path);
  expect(sameSite.target?.i).toBe(1);
  expect(sameSite.from.has(0)).toBe(true);
  expect(sameSite.from.has(1)).toBe(false);
  expect(otherSite.target).toBeNull();
  expect(otherSite.from.size).toBe(0);
});
