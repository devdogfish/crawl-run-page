// PROTOTYPE DATA for /[site]/pages: every page of the site, in any finished crawl, and the delta between two crawls.
// In the real app this is the `pages` table joined across two crawl_ids (see SPEC.md):
//   new      = URL in crawl A, not in baseline B
//   removed  = URL in B, not in A
//   changed  = URL in both, content hash differs
// Curated public URLs and a small legacy/QA inventory, with simulated snapshot history.
import { crawlFixture, crawlFixturesFor, crawlsFor, type CrawlRow, type PageVitals } from "@/lib/crawls-list";
import { currentIssueCounts } from "@/lib/page-issues";
import { SITES, SITE_IDS, type SiteId } from "@/lib/sites";
import publicPages from "@/data/public-pages.json";
import samplePages from "@/data/sample-pages.json";
import { getStoredSnapshot } from "@/lib/stored-html";

export { currentIssueCounts } from "@/lib/page-issues";

// ───────── Page types: matched on the URL path, first prefix wins ─────────
export type PageType = "article" | "podcast" | "video" | "research" | "news" | "event" | "people" | "other";
export const PAGE_TYPES: { id: PageType; label: string; prefix: string | null }[] = [
  { id: "article", label: "Articles", prefix: "/en/insights/" },
  { id: "research", label: "Research", prefix: "/en/research/" },
  { id: "news", label: "News releases", prefix: "/en/news/" },
  { id: "podcast", label: "Podcasts", prefix: "/en/podcasts/" },
  { id: "video", label: "Videos", prefix: "/en/videos/" },
  { id: "event", label: "Events", prefix: "/en/events/" },
  { id: "people", label: "People", prefix: "/en/people/" },
  { id: "other", label: "Other pages", prefix: null }, // nothing above matched
];
export const typeOf = (path: string): PageType => {
  if (path === "/en/insights/podcasts" || path.startsWith("/en/insights/podcasts/")) return "podcast";
  if (path === "/en/insights/rbc-research") return "research";
  return PAGE_TYPES.find((t) => t.prefix && path.startsWith(t.prefix))?.id ?? "other";
};
export const typeLabel = (type: PageType) => ({
  article: "Article", research: "Research", news: "News", podcast: "Podcast",
  video: "Video", event: "Event", people: "Person", other: "Other",
})[type];

// Year in the URL (/en/insights/2024/…). Filter goes back 10 years.
export const YEARS = Array.from({ length: 11 }, (_, k) => 2026 - k);
export const yearOf = (path: string) => { const m = path.match(/\/(20\d{2})\//); return m ? Number(m[1]) : null; };

// ───────── Rules (defined elsewhere in the app): a regex counted on each page's HTML ─────────
export const RULES = [
  { id: "copyright", name: "Outdated copyright year", pattern: "©\\s?20(1\\d|2[0-4])" },
  { id: "legacy-domain", name: "Links to legacy .page URLs", pattern: "href=\"[^\"]+\\.page\"" },
  { id: "placeholder", name: "Placeholder text", pattern: "lorem ipsum|\\bTBD\\b|\\bTODO\\b" },
  { id: "phone", name: "Hard-coded phone numbers", pattern: "\\(\\d{3}\\) \\d{3}-\\d{4}" },
  { id: "old-brand", name: "Old brand name", pattern: "RBC Dexia" },
] as const;
export type RuleId = (typeof RULES)[number]["id"];

// ───────── Issue categories ─────────
export type Category = "accessibility" | "performance" | "seo" | "security";
export const CATEGORIES: { id: Category; label: string; short: string }[] = [
  { id: "accessibility", label: "Accessibility", short: "accessibility" },
  { id: "performance", label: "Performance", short: "performance" },
  { id: "seo", label: "SEO & canonicals", short: "SEO" },
  { id: "security", label: "Security & compliance", short: "security" },
];

// ───────── Curated pages and crawl snapshots ─────────
type ProductionSite = "rbccm" | "rbcits";
export type SitePage = {
  i: number;
  path: string;
  title: string;
  h1: string;
  type: PageType;
  sourceUrl?: string;
};

function productionInventory(site: ProductionSite): SitePage[] {
  return [
    ...publicPages[site].map(({ id, title, h1, url }) => {
      const { pathname, search } = new URL(url);
      const path = pathname + search;
      return { i: id, path, title, h1, type: typeOf(path), sourceUrl: url };
    }),
    ...samplePages.legacy[site].map(({ id, path, title }) => ({ i: id, path, title, h1: title, type: typeOf(path) })),
  ];
}

const productionPages = { rbccm: productionInventory("rbccm"), rbcits: productionInventory("rbcits") };

function qaInventory(site: "rbccm-qa" | "rbcits-qa", production: ProductionSite): SitePage[] {
  const sources = new Map(productionPages[production].map((page) => [page.i, page]));
  const entries: { id: number; sourceId: number; path?: string }[] = samplePages.qa[site];
  return entries.map(({ id, sourceId, path }) => {
    const source = sources.get(sourceId)!;
    return { ...source, i: id, path: path ?? source.path };
  });
}

const inventory: Record<SiteId, Map<number, SitePage>> = Object.fromEntries(
  Object.entries({
    ...productionPages,
    "rbccm-qa": qaInventory("rbccm-qa", "rbccm"),
    "rbcits-qa": qaInventory("rbcits-qa", "rbcits"),
  }).map(([site, pages]) => [site, new Map(pages.map((page) => [page.i, page]))]),
) as Record<SiteId, Map<number, SitePage>>;

export const siteSize = (site: SiteId) => inventory[site].size;
export const hasPage = (site: SiteId, pageId: number) => inventory[site].has(pageId);

export type Change = "new" | "changed" | "removed" | "same";
export type PageView = SitePage & {
  site: SiteId;
  url: string;
  status: number;
  change: Change | null;
  born: number;
  lastChanged: number | null;
  vitals: PageVitals | null;
  perf: number | null; // simulated performance score, null when not audited
  baselinePerf: number | null;
};

export const crawlChoices = (site: SiteId): CrawlRow[] => crawlsFor(site).filter((crawl) => crawl.status === "success");
export const defaultCrawl = (site: SiteId) => crawlChoices(site)[0];
export const baselinesFor = (site: SiteId, crawlId: string) => crawlChoices(site).filter((crawl) => Number(crawl.id) < Number(crawlId));
export const defaultScope = (site: SiteId) => {
  const a = defaultCrawl(site).id;
  return { crawl: a, vs: baselinesFor(site, a)[0]?.id ?? "none" };
};

export function lighthouseCoverage(site: SiteId, crawlId: number) {
  const fixture = crawlFixture(site, crawlId);
  return { audited: fixture?.lighthousePageIds.length ?? 0, pages: fixture?.pageIds.length ?? 0 };
}

// Compatibility for callers with a crawl ID. The ID ranges do not overlap across sites.
export const fullLighthouse = (crawlId: number) => SITE_IDS.some((site) => {
  const fixture = crawlFixture(site, crawlId);
  if (!fixture?.lighthousePageIds.length) return false;
  const eligible = fixture.pageIds.filter((id) => inventory[site].get(id)?.sourceUrl);
  return fixture.lighthousePageIds.length === eligible.length;
});

function ruleRegex(id: RuleId) {
  return new RegExp(RULES.find((rule) => rule.id === id)!.pattern, "gi");
}

export const ruleMatches = (page: SitePage, rule: RuleId) => {
  const html = page.sourceUrl ? getStoredSnapshot({ url: page.sourceUrl })?.html : undefined;
  return html ? [...html.matchAll(ruleRegex(rule))].length : 0;
};

function pageChanges(site: SiteId, id: number, at: number) {
  const snapshots = crawlFixturesFor(site)
    .filter((crawl) => crawl.status === "success" && Number(crawl.id) <= at && crawl.pageIds.includes(id));
  const first = Number(snapshots.at(-1)?.id);
  const born = first === oldestFinished.get(site) ? -Infinity : first;
  const changed = snapshots.find((crawl) => crawl.changedPageIds.includes(id));
  return { born, lastChanged: changed ? Number(changed.id) : Number.isFinite(born) ? born : null };
}

const oldestFinished = new Map(SITE_IDS.map((site) => [
  site, Number(crawlFixturesFor(site).findLast((crawl) => crawl.status === "success")?.id),
]));

export function pagesFor(site: SiteId, a: number, b: number | null): PageView[] {
  const current = crawlFixture(site, a);
  const baseline = b == null ? undefined : crawlFixture(site, b);
  const ids = new Set([...(current?.pageIds ?? []), ...(baseline?.pageIds ?? [])]);
  return [...ids].map((id) => pageView(site, id, a, b)!);
}

export function pageView(site: SiteId, id: number, a: number, b: number | null): PageView | null {
  const page = inventory[site].get(id);
  if (!page) return null;
  const current = crawlFixture(site, a);
  const baseline = b == null ? undefined : crawlFixture(site, b);
  const inCurrent = current?.pageIds.includes(id) ?? false;
  const inBaseline = baseline?.pageIds.includes(id) ?? false;
  if (!inCurrent && !inBaseline) return null;

  const snapshot = inCurrent ? current! : baseline!;
  const { born, lastChanged } = pageChanges(site, id, Number(snapshot.id));
  const change = b == null ? null : !inCurrent ? "removed" : !inBaseline ? "new" : lastChanged != null && lastChanged > b ? "changed" : "same";
  const vitals = inCurrent ? current!.vitalsByPage[id] ?? null : null;
  const baselinePerf = inBaseline ? baseline!.vitalsByPage[id]?.performanceScore ?? null : null;
  return {
    ...page, site, url: SITES[site].url + page.path, status: snapshot.errorPageIds.includes(id) ? 503 : 200,
    change, born, lastChanged, vitals, perf: vitals?.performanceScore ?? null, baselinePerf,
  };
}

export const issuesIn = (p: PageView, c: Category) => currentIssueCounts(p).byCategory[c];
export const totalIssues = (p: PageView) => currentIssueCounts(p).total;
export const severity = (p: PageView, c: Category | null) => {
  const counts = currentIssueCounts(p);
  return c ? (counts.byCategory[c] ?? -1) + (c === "accessibility" ? counts.critical * 10 : 0) : counts.total + counts.critical * 10;
};

// "Links to": paste a full URL or a path. Real backend: SELECT from_page FROM links WHERE to_url = ?
const normalizedPath = (path: string) => path.replace(/\/+$/, "") || "/";
const linkHost = (url: URL) => {
  const host = url.host.replace(/^www\./, "");
  return host === "rbcits.com" ? "rbcis.com" : host;
};

export function normalizeTarget(input: string) {
  const s = input.trim();
  if (!s) return "";
  try {
    const bareHost = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(s);
    const url = new URL(bareHost ? `https://${s}` : s, "https://x.invalid");
    return `${url.host === "x.invalid" ? "" : linkHost(url)}${normalizedPath(url.pathname)}`;
  } catch { return s; }
}

export function linksTo(target: string, rows: PageView[]) {
  const siteRelative = target.startsWith("/");
  const isTarget = (page: PageView) => (siteRelative ? normalizedPath(new URL(page.url).pathname) : normalizeTarget(page.url)) === target;
  const from = new Set<number>();
  for (const page of rows) {
    if (!page.sourceUrl || isTarget(page)) continue;
    const source = new URL(page.sourceUrl);
    const html = getStoredSnapshot({ url: page.sourceUrl })?.html ?? "";
    const links = html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi);
    for (const link of links) {
      try {
        const href = new URL((link[1] ?? link[2]).replaceAll("&amp;", "&"), source);
        const same = siteRelative
          ? linkHost(href) === linkHost(source) && normalizedPath(href.pathname) === target
          : normalizeTarget(href.href) === target;
        if (same) { from.add(page.i); break; }
      } catch { /* invalid href in the captured HTML */ }
    }
  }
  return { target: rows.find(isTarget) ?? null, from };
}
