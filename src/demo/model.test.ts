import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  SITES,
  exportCsv,
  filterPages,
  getCrawls,
  getPages,
  getTrend,
  groupIssues,
  scorePage,
  summarize,
  type DemoPage,
  type Finding,
} from "./model";

const contrast: Finding = {
  id: "contrast",
  ruleId: "contrast",
  title: "Text contrast",
  category: "accessibility",
  severity: "warning",
  evidence: "Text, icons and \"more\"\nSimulated",
  recommendation: "Darken the text.",
};

const brokenLink: Finding = {
  id: "broken-link",
  ruleId: "broken-link",
  title: "Broken link",
  category: "links",
  severity: "critical",
  evidence: "A simulated link target returned 404.",
  recommendation: "Fix the destination.",
};

const canonical: Finding = {
  id: "canonical",
  ruleId: "canonical",
  title: "Missing canonical URL",
  category: "seo",
  severity: "notice",
  evidence: "Sample HTML has no canonical URL.",
  recommendation: "Set a canonical URL.",
};

function page(id: string, title: string, findings: Finding[], section: DemoPage["section"] = "Insights"): DemoPage {
  return {
    id,
    siteId: "rbccm",
    title,
    url: `https://www.rbccm.com/en/${id}`,
    path: `/en/${id}`,
    section,
    status: 200,
    responseMs: 280,
    score: scorePage(findings),
    findings,
  };
}

describe("demo inventory", () => {
  it("keeps both sites and their crawl IDs separate", () => {
    const pageIds = new Set<string>();
    for (const site of SITES) {
      const crawls = getCrawls(site.id);
      const pages = getPages(site.id);
      expect(pages.length).toBeGreaterThanOrEqual(20);
      expect(pages).toEqual(getPages(site.id, crawls[0].id));
      expect(getPages(site.id, "unknown")).toEqual([]);
      for (const item of pages) {
        expect(item.siteId).toBe(site.id);
        expect(new URL(item.url).hostname).toBe(`www.${site.host}`);
        expect(pageIds.has(item.id)).toBe(false);
        pageIds.add(item.id);
      }
    }

    expect(getPages("rbccm", getCrawls("rbcis")[0].id)).toEqual([]);
    expect(getPages("rbcis", getCrawls("rbccm")[0].id)).toEqual([]);
  });

  it("links each crawl to a unique set of scored page-rule pairs", () => {
    for (const { id } of SITES) {
      const crawls = getCrawls(id);
      expect(crawls).toHaveLength(8);
      expect(crawls[0].date).toBe("2026-11-10T08:00:00Z");
      expect(crawls.map((crawl) => crawl.date)).toEqual(crawls.map((crawl) => crawl.date).sort().reverse());

      for (const crawl of crawls) {
        const pages = getPages(id, crawl.id);
        expect(pages).toHaveLength(crawl.pages);
        const findings = pages.flatMap((item) => item.findings);
        expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
        for (const item of pages) {
          expect(item.score).toBe(scorePage(item.findings));
          expect(item.findings.some(({ ruleId }) => ruleId === "slow-response")).toBe(item.responseMs > 800);
        }
      }
    }
  });
});

describe("demo filters and totals", () => {
  const hybrid = page("research", "Research", [contrast, brokenLink]);
  const second = page("global-equities", "Global Equities", [contrast, canonical], "Services");
  const healthy = page("outlook", "Market Outlook", []);
  const pages = [hybrid, second, healthy];

  it("matches search case-insensitively by title or URL and intersects section", () => {
    expect(filterPages(pages, { ...DEFAULT_FILTERS, search: "  MARKET OUTLOOK  " })).toEqual([healthy]);
    expect(filterPages(pages, { ...DEFAULT_FILTERS, search: "/en/global-equities", section: "Services" })).toEqual([second]);
    expect(filterPages(pages, { ...DEFAULT_FILTERS, search: "research", section: "Services" })).toEqual([]);
  });

  it("requires the same finding to match both category and severity", () => {
    const filters = { ...DEFAULT_FILTERS, section: "Insights" as const, category: "accessibility" as const };
    expect(filterPages(pages, { ...filters, severity: "critical" })).toEqual([]);

    const result = filterPages(pages, { ...filters, severity: "warning" });
    expect(result).toEqual([{ ...hybrid, findings: [contrast], score: scorePage([contrast]) }]);
    expect(hybrid.findings).toEqual([contrast, brokenLink]);
  });

  it("totals visible findings and groups them by rule in severity order", () => {
    expect(summarize(pages)).toMatchObject({
      pages: 3,
      issues: 4,
      critical: 1,
      healthy: 1,
      score: Math.round((hybrid.score + second.score + healthy.score) / 3),
      responseMs: 280,
    });
    expect(summarize(pages).categories.map(({ id, issues, pages }) => [id, issues, pages])).toEqual([
      ["accessibility", 2, 2], ["seo", 1, 1], ["performance", 0, 0], ["links", 1, 1],
    ]);
    expect(groupIssues(pages).map(({ ruleId, pages, findings, pageIds }) => [ruleId, pages, findings, pageIds])).toEqual([
      ["broken-link", 1, 1, ["research"]],
      ["contrast", 2, 2, ["research", "global-equities"]],
      ["canonical", 1, 1, ["global-equities"]],
    ]);
    const filtered = filterPages(pages, { ...DEFAULT_FILTERS, category: "links" });
    expect(summarize(filtered)).toMatchObject({ pages: 1, issues: 1, critical: 1, healthy: 0 });
    expect(groupIssues(filtered)).toHaveLength(1);
  });

  it("represents empty metrics without implying a perfect score", () => {
    expect(summarize([])).toMatchObject({ pages: 0, issues: 0, critical: 0, healthy: 0, score: null, responseMs: null });
    expect(groupIssues([])).toEqual([]);
    const trend = getTrend("rbccm", { ...DEFAULT_FILTERS, search: "no matching page" }, 7);
    expect(trend).toHaveLength(4);
    expect(trend.every(({ pages, issues, score }) => pages === 0 && issues === 0 && score === null)).toBe(true);
  });
});

describe("demo trend", () => {
  it("applies identical filters to each snapshot and shows the selected time window", () => {
    const filters = { ...DEFAULT_FILTERS, section: "Services" as const, category: "performance" as const };
    for (const { id } of SITES) {
      const crawls = getCrawls(id).reverse();
      const trend = getTrend(id, filters, 30);

      expect(trend).toEqual(crawls.map((crawl) => {
        const { score, issues, pages } = summarize(filterPages(getPages(id, crawl.id), filters));
        return { date: crawl.date, score, issues, pages };
      }));
      expect(getTrend(id, filters, 7)).toEqual(trend.slice(-4));
    }
  });

  it("ends at the selected crawl and excludes snapshots after it", () => {
    const crawls = getCrawls("rbccm");
    const selected = crawls[3];
    const trend = getTrend("rbccm", DEFAULT_FILTERS, 7, selected.id);
    expect(trend.map(({ date }) => date)).toEqual([crawls[4].date, selected.date]);
    expect(getTrend("rbcis", DEFAULT_FILTERS, 30, selected.id)).toEqual([]);
  });
});

describe("demo CSV", () => {
  it("escapes commas, quotes and newlines and includes healthy pages", () => {
    const csv = exportCsv([
      page("research", 'Markets, "Today"', [contrast, brokenLink]),
      page("outlook", "Market Outlook", []),
    ]);

    expect(csv).toContain('"Markets, ""Today"""');
    expect(csv).toContain('"Text, icons and ""more""\nSimulated"');
    expect(csv.split("\r\n")).toHaveLength(4);
    expect(csv.split("\r\n").at(-1)).toContain('"Market Outlook"');
    expect(csv.split("\r\n").at(-1)).toMatch(/"100","{2},"{2},"{2},"{2},"{2},"Simulated"$/);
    expect(exportCsv([])).toBe(csv.split("\r\n")[0]);
  });
});
