// PROTOTYPE DATA for /[site]/pages: every page of the site, in any finished crawl, and the delta between two crawls.
// In the real app this is the `pages` table joined across two crawl_ids (see SPEC.md):
//   new      = URL in crawl A, not in baseline B
//   removed  = URL in B, not in A
//   changed  = URL in both, content hash differs
// Deterministic from the page index, so rows don't change between renders.
import { crawlsFor, type CrawlRow } from "@/lib/crawls-list";
import type { SiteId } from "@/lib/sites";

const rand = (i: number, salt: number) => {
  let x = (i + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const hashStr = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

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
export const typeOf = (path: string): PageType => PAGE_TYPES.find((t) => t.prefix && path.startsWith(t.prefix))?.id ?? "other";
export const typeLabel = (t: PageType) => ({ article: "Article", research: "Research", news: "News", podcast: "Podcast", video: "Video", event: "Event", people: "Person", other: "Other" })[t];

// Year in the URL (/en/insights/2024/…). Filter goes back 10 years.
export const YEARS = Array.from({ length: 11 }, (_, k) => 2026 - k);
export const yearOf = (path: string) => { const m = path.match(/\/(20\d{2})\//); return m ? Number(m[1]) : null; };

// ───────── Rules (defined elsewhere in the app): a regex counted on each page's HTML ─────────
export const RULES = [
  { id: "copyright", name: "Outdated copyright year", pattern: "©\\s?20(1\\d|2[0-4])", rate: 0.09 },
  { id: "legacy-domain", name: "Links to legacy .page URLs", pattern: "href=\"[^\"]+\\.page\"", rate: 0.05 },
  { id: "placeholder", name: "Placeholder text", pattern: "lorem ipsum|\\bTBD\\b|\\bTODO\\b", rate: 0.004 },
  { id: "phone", name: "Hard-coded phone numbers", pattern: "\\(\\d{3}\\) \\d{3}-\\d{4}", rate: 0.03 },
  { id: "old-brand", name: "Old brand name", pattern: "RBC Dexia", rate: 0.012 },
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

// ───────── Generator ─────────
const TOPICS = ["Canadian housing", "Energy transition", "Interest rates", "AI in capital markets", "Oil and gas M&A", "Private credit", "Fed policy",
  "Critical minerals", "Tariffs and trade", "Bank earnings", "ESG reporting", "Infrastructure finance", "Tech IPOs", "Healthcare deals", "Real estate credit",
  "US election", "Bond markets", "Currency outlook", "Mining capex", "Pension funds", "Consumer spending", "Data centres", "Utilities", "Shipping rates",
  "Agriculture", "Venture debt", "Sovereign wealth", "Carbon markets", "Insurance", "Payments"];
const FORMATS = ["outlook", "what investors need to know", "five charts", "a closer look", "midyear review", "the road ahead", "key takeaways",
  "by the numbers", "risks to watch", "Q&A with our analysts", "sector update", "deal review", "market brief", "deep dive", "week ahead",
  "fireside chat", "year in review", "first look", "explained", "the bull case"];
const REGIONS = ["", "in Canada", "in the US", "in Europe", "in Asia", "in Latin America", "globally", "in the UK"];
const FIRST = ["Sarah", "Michael", "Priya", "David", "Emma", "Jean", "Wei", "Olivia", "Marc", "Aisha", "Tom", "Laura", "Ravi", "Claire", "Ben"];
const LAST = ["Chen", "Tremblay", "Patel", "Roy", "Martin", "Singh", "Gagnon", "Wong", "Campbell", "Lee", "Fraser", "Nguyen", "Bouchard", "Smith"];
const OTHER = ["about-us", "careers", "contact", "our-firm", "sectors/energy", "sectors/technology", "sectors/healthcare", "sectors/mining",
  "products/equity-research", "products/fixed-income", "products/foreign-exchange", "products/investment-banking", "locations/toronto",
  "locations/new-york", "locations/london", "locations/sydney", "legal/privacy", "legal/terms-of-use", "legal/accessibility", "search", "sitemap"];
const PREFIX: Record<PageType, string> = { article: "/en/insights", research: "/en/research", news: "/en/news", podcast: "/en/podcasts", video: "/en/videos", event: "/en/events", people: "/en/people", other: "/en" };
const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type SitePage = {
  i: number;
  path: string;
  title: string;
  h1: string;
  type: PageType;
  status: number;
  born: number; // first crawl id that found it (-Infinity: before the history starts)
  removedAt: number; // first crawl id that no longer finds it
  changeRate: number; // chance its content hash changes between two crawls
  issues: Record<Exclude<Category, "performance">, number>;
  perfIssues: number; // only reported for pages Lighthouse audited
  critical: number;
};

function makePage(i: number, ids: number[]): SitePage {
  const r = rand(i, 1);
  const type: PageType = i < OTHER.length ? "other" : r < 0.38 ? "article" : r < 0.58 ? "research" : r < 0.7 ? "news" : r < 0.76 ? "podcast" : r < 0.81 ? "video" : r < 0.86 ? "event" : r < 0.93 ? "people" : "other";
  const year = Math.max(2016, 2026 - Math.floor(rand(i, 2) ** 1.6 * 11));
  let title: string, path: string;
  if (type === "people") {
    title = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
    path = `${PREFIX.people}/${slug(title)}${i >= FIRST.length * LAST.length ? `-${Math.floor(i / (FIRST.length * LAST.length))}` : ""}`;
  } else if (type === "other") {
    const o = OTHER[i % OTHER.length];
    const n = Math.floor(i / OTHER.length);
    title = o.split("/").pop()!.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    path = `/en/${o}${n ? `/${n}` : ""}`;
  } else {
    const t = TOPICS[i % TOPICS.length], f = FORMATS[Math.floor(i / TOPICS.length) % FORMATS.length], g = REGIONS[Math.floor(i / 600) % REGIONS.length];
    title = `${t}${g ? ` ${g}` : ""}: ${f}`;
    const dup = Math.floor(i / 4800);
    path = `${PREFIX[type]}/${year}/${slug(title)}${dup ? `-${dup + 1}` : ""}`;
  }
  const h1 = rand(i, 3) < 0.06 ? title.split(":")[0] : title; // a few pages have a shorter H1
  const sr = rand(i, 4);
  const status = sr < 0.006 ? 404 : sr < 0.018 ? 301 : sr < 0.02 ? 500 : 200;
  const min = ids[0], span = ids[ids.length - 1] - min;
  const born = i >= OTHER.length && rand(i, 5) < 0.03 ? min + 1 + Math.floor(rand(i, 6) * span) : -Infinity;
  const removedAt = i >= OTHER.length && rand(i, 7) < 0.02 ? Math.max(born === -Infinity ? min + 1 : born + 1, min + 1 + Math.floor(rand(i, 8) * span)) : Infinity;
  const changeRate = type === "other" ? 0.08 : type === "people" ? 0.02 : year >= 2025 ? 0.012 : 0.002;
  const heavy = rand(i, 10) < 0.1;
  const a11y = 2 + Math.floor(rand(i, 11) * 7) + (heavy ? 8 + Math.floor(rand(i, 12) * 30) : 0);
  const critical = rand(i, 13) < (heavy ? 0.6 : 0.08) ? 1 + Math.floor(rand(i, 14) * (heavy ? 6 : 2)) : 0;
  return {
    i, path, title, h1, type, status, born, removedAt, changeRate, critical,
    issues: {
      accessibility: a11y,
      seo: rand(i, 15) < 0.14 ? 1 + Math.floor(rand(i, 16) * 3) : 0,
      security: rand(i, 17) < 0.03 ? 1 + Math.floor(rand(i, 18) * 2) : 0,
    },
    perfIssues: 1 + Math.floor(rand(i, 19) ** 2 * 9),
  };
}

export const ruleMatches = (p: SitePage, rule: RuleId) => {
  const k = RULES.findIndex((r) => r.id === rule);
  return rand(p.i, 100 + k) < RULES[k].rate ? 1 + Math.floor(rand(p.i, 200 + k) ** 3 * 14) : 0;
};

// Finished crawls you can look at, newest first
export const crawlChoices = (site: SiteId): CrawlRow[] => crawlsFor(site).filter((c) => c.status === "success");

// Every 10th crawl ran Lighthouse on the whole site; the others on a sample
export const fullLighthouse = (crawlId: number) => crawlId % 10 === 0;
export const LH_SAMPLE = 200;

export const siteSize = (site: SiteId) => (site === "rbcits" ? 19_400 : 48_300);
const cache = new Map<SiteId, { pages: SitePage[]; ids: number[] }>();
function universe(site: SiteId) {
  let u = cache.get(site);
  if (!u) {
    const ids = crawlsFor(site).map((c) => Number(c.id)).sort((a, b) => a - b);
    const n = siteSize(site);
    u = { pages: Array.from({ length: n }, (_, i) => makePage(i, ids)), ids };
    cache.set(site, u);
  }
  return u;
}

export type Change = "new" | "changed" | "removed" | "same";
export type PageView = SitePage & {
  change: Change | null; // null when not comparing
  lastChanged: number | null; // crawl id where the content hash last changed (null: before the history starts)
  perf: number | null; // null: Lighthouse didn't audit this page in this crawl
};

const exists = (p: SitePage, c: number) => p.born <= c && c < p.removedAt;
function lastChange(p: SitePage, crawl: number, ids: number[]) {
  for (let k = ids.length - 1; k >= 0; k--) {
    const id = ids[k];
    if (id > crawl) continue;
    if (id <= p.born) return p.born === -Infinity ? null : p.born;
    if (rand(p.i, 1000 + id) < p.changeRate) return id;
  }
  return p.born === -Infinity ? null : p.born;
}

// Pages in crawl A, plus (when comparing) the pages that were in B but are gone from A
export function pagesFor(site: SiteId, a: number, b: number | null): PageView[] {
  const u = universe(site);
  const out: PageView[] = [];
  for (const p of u.pages) { const v = view(u, p, a, b); if (v) out.push(v); }
  return out;
}

// One page, for the page detail view (null if it's in neither crawl)
export const pageView = (site: SiteId, i: number, a: number, b: number | null) => {
  const u = universe(site);
  return u.pages[i] ? view(u, u.pages[i], a, b) : null;
};

function view(u: { pages: SitePage[]; ids: number[] }, p: SitePage, a: number, b: number | null): PageView | null {
  const inA = exists(p, a), inB = b != null && exists(p, b);
  if (!inA && !inB) return null;
  const at = inA ? a : b!;
  const lastChanged = lastChange(p, at, u.ids);
  const change: Change | null = b == null ? null : !inA ? "removed" : !inB ? "new" : lastChanged != null && lastChanged > b ? "changed" : "same";
  const audited = fullLighthouse(at) || rand(p.i, at) < LH_SAMPLE / u.pages.length;
  return { ...p, change, lastChanged, perf: audited ? p.perfIssues : null };
}

export const issuesIn = (p: PageView, c: Category) => (c === "performance" ? p.perf : p.issues[c]);
export const totalIssues = (p: PageView) => p.issues.accessibility + p.issues.seo + p.issues.security + (p.perf ?? 0);
export const severity = (p: PageView, c: Category | null) => (c ? (issuesIn(p, c) ?? -1) + (c === "accessibility" ? p.critical * 10 : 0) : totalIssues(p) + p.critical * 10);

// "Links to": paste a full URL or a path. Real backend: SELECT from_page FROM links WHERE to_url = ?
export function normalizeTarget(input: string) {
  const s = input.trim();
  if (!s) return "";
  try {
    const u = new URL(s, "https://x.invalid");
    const internal = u.host === "x.invalid" || /(^|\.)rbc(cm|is|its)\.com$/.test(u.hostname);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return internal ? path : `${u.host}${path}`;
  } catch { return s; }
}
export function linksTo(target: string, rows: PageView[]) {
  const h = hashStr(target);
  const page = rows.find((p) => p.path === target);
  // Nav/footer pages are linked from almost everywhere; people and articles from a handful of pages
  const p = !page ? 0.0015 : page.type === "other" ? (OTHER.indexOf(target.replace(/^\/en\//, "")) >= 0 && target.split("/").length <= 3 ? 0.9 : 0.04) : page.type === "people" ? 0.002 : 0.0009;
  return { target: page ?? null, from: new Set(rows.filter((r) => r.path !== target && rand(r.i, h % 100_000) < p).map((r) => r.i)) };
}
