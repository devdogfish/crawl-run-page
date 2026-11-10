import sources from "./sources.json";

export type SiteId = "rbccm" | "rbcis";

export const SITES: { id: SiteId; name: string; host: string; url: string }[] = [
  { id: "rbccm", name: "RBC Capital Markets", host: "rbccm.com", url: "https://www.rbccm.com/en/" },
  { id: "rbcis", name: "RBC Investor Services", host: "rbcis.com", url: "https://www.rbcis.com/en/" },
];

export const PROVENANCE = sources.provenance;

export type Category = "accessibility" | "seo" | "performance" | "links";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "accessibility", label: "Accessibility" },
  { id: "seo", label: "SEO" },
  { id: "performance", label: "Performance" },
  { id: "links", label: "Links" },
];

export type Severity = "critical" | "warning" | "notice";

export const SECTIONS = ["Insights", "Services", "About", "Resources"] as const;
export type Section = (typeof SECTIONS)[number];

export type Finding = {
  id: string;
  ruleId: string;
  title: string;
  category: Category;
  severity: Severity;
  evidence: string;
  recommendation: string;
};

export type DemoPage = {
  id: string;
  siteId: SiteId;
  title: string;
  url: string;
  path: string;
  section: Section;
  status: number;
  responseMs: number;
  score: number;
  findings: Finding[];
};

export type Crawl = {
  id: string;
  siteId: SiteId;
  date: string;
  durationSeconds: number;
  pages: number;
};

export type Filters = {
  search: string;
  section: Section | "all";
  category: Category | "all";
  severity: Severity | "all";
};

export const DEFAULT_FILTERS: Filters = {
  search: "",
  section: "all",
  category: "all",
  severity: "all",
};

type Rule = Omit<Finding, "id"> & { rate: number };

const RULES: Rule[] = [
  {
    ruleId: "control-name",
    title: "Control missing an accessible name",
    category: "accessibility",
    severity: "critical",
    evidence: "Simulated browser check found an icon-only control without a name in the accessibility tree.",
    recommendation: "Add descriptive visible text or an accessible label to the control.",
    rate: 0.12,
  },
  {
    ruleId: "color-contrast",
    title: "Text below contrast threshold",
    category: "accessibility",
    severity: "warning",
    evidence: "Sample text in the simulated audit measured 3.2:1 against its background.",
    recommendation: "Adjust the text or background color to reach 4.5:1 for normal text.",
    rate: 0.19,
  },
  {
    ruleId: "heading-order",
    title: "Skipped heading level",
    category: "accessibility",
    severity: "notice",
    evidence: "Simulated document outline jumped from a level-one heading to a level-three heading.",
    recommendation: "Use heading levels that follow the content hierarchy.",
    rate: 0.10,
  },
  {
    ruleId: "meta-description",
    title: "Missing meta description",
    category: "seo",
    severity: "warning",
    evidence: "Sample HTML has no meta description in the document head.",
    recommendation: "Write a unique description of the page and add it to the document head.",
    rate: 0.19,
  },
  {
    ruleId: "canonical-url",
    title: "Missing canonical URL",
    category: "seo",
    severity: "notice",
    evidence: "The simulated document head has no canonical link.",
    recommendation: "Set an absolute canonical URL for the preferred version of the page.",
    rate: 0.15,
  },
  {
    ruleId: "slow-response",
    title: "Slow server response",
    category: "performance",
    severity: "warning",
    evidence: "Simulated time to first byte exceeded 800 ms.",
    recommendation: "Profile server-side work and cache content that can be reused safely.",
    rate: 0.18,
  },
  {
    ruleId: "unoptimized-image",
    title: "Oversized image asset",
    category: "performance",
    severity: "notice",
    evidence: "Sample trace served a 2.1 MB image at less than half its intrinsic width.",
    recommendation: "Serve compressed images sized for the viewport and pixel density.",
    rate: 0.21,
  },
  {
    ruleId: "broken-link",
    title: "Broken internal link",
    category: "links",
    severity: "critical",
    evidence: "A sample internal link target returned HTTP 404 in the simulated crawl.",
    recommendation: "Point the link to a working destination or remove it if it is obsolete.",
    rate: 0.09,
  },
  {
    ruleId: "redirect-chain",
    title: "Internal link follows a redirect chain",
    category: "links",
    severity: "notice",
    evidence: "A sample internal link followed two redirects before reaching its destination.",
    recommendation: "Update the link to point directly to its final destination.",
    rate: 0.16,
  },
];

const SNAPSHOTS = [
  { date: "2026-11-10", omittedPages: 0, issueFactor: 1 },
  { date: "2026-11-08", omittedPages: 1, issueFactor: 1.09 },
  { date: "2026-11-06", omittedPages: 1, issueFactor: 1.05 },
  { date: "2026-11-04", omittedPages: 2, issueFactor: 1.18 },
  { date: "2026-10-30", omittedPages: 3, issueFactor: 1.25 },
  { date: "2026-10-25", omittedPages: 4, issueFactor: 1.16 },
  { date: "2026-10-18", omittedPages: 6, issueFactor: 1.34 },
  { date: "2026-10-12", omittedPages: 8, issueFactor: 1.40 },
];

const severityWeight: Record<Severity, number> = { critical: 24, warning: 10, notice: 4 };

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  }
  return result >>> 0;
}

export function scorePage(findings: readonly Pick<Finding, "severity">[]): number {
  return Math.max(0, 100 - findings.reduce((sum, finding) => sum + severityWeight[finding.severity], 0));
}

function buildSiteSnapshots(siteId: SiteId) {
  const inventory = sources[siteId].map((source) => {
    const url = new URL(source.url);
    const id = `${siteId}-${hash(source.url).toString(36)}`;

    return {
      id,
      siteId,
      title: source.title,
      url: source.url,
      path: url.pathname + url.search,
      section: source.section as Section,
    };
  });

  // Assign a discovery order independent of the display order of the inventory.
  const discovery = inventory.map(({ id }) => id).sort((a, b) => hash(a) - hash(b));

  return SNAPSHOTS.map(({ date, omittedPages, issueFactor }) => {
    const included = new Set(discovery.slice(0, discovery.length - omittedPages));
    const pages = inventory.filter(({ id }) => included.has(id)).map((page): DemoPage => {
      const findings = RULES.flatMap(({ rate, ...rule }) => {
        const sample = hash(`${rule.ruleId}:${page.url}`) / 2 ** 32;
        const siteFactor = siteId === "rbccm" ? 1 : 0.85;
        return sample < rate * issueFactor * siteFactor ? [{ id: `${page.id}-${rule.ruleId}`, ...rule }] : [];
      });
      const latency = hash(`${page.id}:${date}`);
      const isSlow = findings.some(({ ruleId }) => ruleId === "slow-response");

      return {
        ...page,
        status: 200,
        responseMs: isSlow ? 840 + latency % 570 : 160 + latency % 570,
        score: scorePage(findings),
        findings,
      };
    });

    const crawl: Crawl = {
      id: `${siteId}-${date}`,
      siteId,
      date: `${date}T08:00:00Z`,
      durationSeconds: 21 + pages.length * 2 + hash(`${siteId}:${date}`) % 15,
      pages: pages.length,
    };

    return { crawl, pages };
  });
}

const history = {
  rbccm: buildSiteSnapshots("rbccm"),
  rbcis: buildSiteSnapshots("rbcis"),
};

export function getCrawls(siteId: SiteId): Crawl[] {
  return history[siteId].map(({ crawl }) => crawl);
}

function getSnapshot(siteId: SiteId, crawlId?: string) {
  const snapshots = history[siteId];
  return crawlId ? snapshots.find(({ crawl }) => crawl.id === crawlId) : snapshots[0];
}

export function getPages(siteId: SiteId, crawlId?: string): DemoPage[] {
  return getSnapshot(siteId, crawlId)?.pages ?? [];
}

export function filterPages(pages: readonly DemoPage[], filters: Filters): DemoPage[] {
  const query = filters.search.trim().toLowerCase();
  const restrictFindings = filters.category !== "all" || filters.severity !== "all";

  return pages.flatMap((page) => {
    if (filters.section !== "all" && page.section !== filters.section) return [];
    if (query && !page.title.toLowerCase().includes(query) && !page.url.toLowerCase().includes(query)) return [];
    if (!restrictFindings) return [page];

    const findings = page.findings.filter((finding) =>
      (filters.category === "all" || finding.category === filters.category) &&
      (filters.severity === "all" || finding.severity === filters.severity));
    if (findings.length === 0) return [];
    return [{ ...page, findings, score: scorePage(findings) }];
  });
}

export function summarize(pages: readonly DemoPage[]) {
  const findings = pages.flatMap((page) => page.findings);
  const average = (sum: number) => pages.length ? Math.round(sum / pages.length) : null;

  return {
    pages: pages.length,
    issues: findings.length,
    critical: findings.filter(({ severity }) => severity === "critical").length,
    healthy: pages.filter((page) => page.findings.length === 0).length,
    score: average(pages.reduce((sum, page) => sum + page.score, 0)),
    responseMs: average(pages.reduce((sum, page) => sum + page.responseMs, 0)),
    categories: CATEGORIES.map(({ id, label }) => ({
      id,
      label,
      issues: findings.filter(({ category }) => category === id).length,
      pages: pages.filter((page) => page.findings.some(({ category }) => category === id)).length,
    })),
  };
}

type IssueGroup = Pick<Finding, "ruleId" | "title" | "category" | "severity" | "recommendation"> & {
  pages: number;
  findings: number;
  pageIds: string[];
};

export function groupIssues(pages: readonly DemoPage[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const page of pages) {
    for (const { ruleId, title, category, severity, recommendation } of page.findings) {
      const group = groups.get(ruleId) ?? {
        ruleId, title, category, severity, recommendation, pages: 0, findings: 0, pageIds: [],
      };

      group.findings += 1;
      if (!group.pageIds.includes(page.id)) {
        group.pageIds.push(page.id);
        group.pages += 1;
      }
      groups.set(ruleId, group);
    }
  }

  return [...groups.values()].sort((a, b) =>
    severityWeight[b.severity] - severityWeight[a.severity] ||
    b.pages - a.pages ||
    a.title.localeCompare(b.title));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function getTrend(siteId: SiteId, filters: Filters, rangeDays: 7 | 30, crawlId?: string) {
  const snapshot = getSnapshot(siteId, crawlId);
  if (!snapshot) return [];
  const end = Date.parse(snapshot.crawl.date);

  return history[siteId]
    .filter(({ crawl }) => {
      const elapsed = end - Date.parse(crawl.date);
      return elapsed >= 0 && elapsed < rangeDays * DAY_MS;
    })
    .reverse()
    .map(({ crawl, pages }) => {
      const { score, issues, pages: count } = summarize(filterPages(pages, filters));
      return { date: crawl.date, score, issues, pages: count };
    });
}

function csvRow(fields: (string | number)[]): string {
  return fields.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(",");
}

export function exportCsv(pages: readonly DemoPage[]): string {
  const header = csvRow([
    "Page title", "URL", "Path", "Section", "HTTP status", "Response time (ms)", "Score",
    "Issue", "Category", "Severity", "Evidence", "Recommendation", "Audit data",
  ]);
  const rows = pages.flatMap((page) => {
    const findings = page.findings.length ? page.findings : [null];

    return findings.map((finding) => csvRow([
      page.title, page.url, page.path, page.section, page.status, page.responseMs, page.score,
      finding?.title ?? "", finding?.category ?? "", finding?.severity ?? "",
      finding?.evidence ?? "", finding?.recommendation ?? "", "Simulated",
    ]));
  });
  return [header, ...rows].join("\r\n");
}
