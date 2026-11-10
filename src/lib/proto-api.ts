// DEV ONLY: the prototype's data, shaped like the backend's Core (backend/crawler_ai/core.py).
// vite.config.ts serves every export here as POST /__proto/<name> with the JSON args as body; the Python
// PrototypeCore calls them, so the MCP server and Ask AI can be tried against this data before the real app exists.
//
// Results are snake_case JSON matching backend/crawler_ai/models.py, and every one carries `ui_url`, built the way
// the app builds links (refs.ts href, analytics.ts links()). Element ids are issueId(site, pageId, k) so the
// frontend's resolveIssue understands them.
// ON INTEGRATION: delete this file; the real app's core returns the same shapes.
import { RULE_CATALOG, issueSlots, pageIssues, type Instance, type Rule } from "@/lib/page-issues";
import { crawlsFor, type CrawlRow } from "@/lib/crawls-list";
import { PRIORITY, PRIORITIES, type Priority } from "@/lib/priority";
import { issueId, resolveIssue } from "@/lib/refs";
import { byRule, hitsFor } from "@/lib/site-issues";
import {
  PAGE_TYPES, baselinesFor, crawlChoices, currentIssueCounts, defaultCrawl, pagesFor, pageView, severity, typeLabel,
  type Category, type PageView,
} from "@/lib/site-pages";
import { SITES, SITE_IDS, type SiteId } from "@/lib/sites";

type Args = Record<string, unknown>;
// the dev plugin sends any thrown Error back as 400 {"error": message}; messages say what to do next
const fail = (m: string): never => { throw new Error(m); };

// ───────── Inputs ─────────
function siteOf(a: Args): SiteId {
  const s = String(a.site ?? "");
  return (SITE_IDS as string[]).includes(s) ? (s as SiteId) : fail(`Unknown site "${s}". Sites: ${SITE_IDS.join(", ")}.`);
}
const limitOf = (a: Args, dflt: number, max: number) => Math.max(1, Math.min(max, Number(a.limit) || dflt));
const text = (a: Args, k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined);

// crawl (default: latest finished) and its baseline (the finished crawl before it)
function scope(site: SiteId, a: Args) {
  const choices = crawlChoices(site);
  const want = text(a, "crawl") ?? (typeof a.crawl === "number" ? String(a.crawl) : undefined);
  const crawl = want && want !== "latest" ? choices.find((c) => c.id === want) : defaultCrawl(site);
  if (!crawl) return fail(`Crawl ${want} isn't a finished crawl of ${site}. Finished crawls: ${choices.slice(0, 8).map((c) => c.id).join(", ")}… (use find_crawls).`);
  const cur = Number(crawl.id);
  const base = baselinesFor(site, crawl.id)[0];
  return { crawl: cur, baseline: base ? Number(base.id) : null, isDefault: crawl.id === defaultCrawl(site).id };
}

// ───────── Links, built like the app does ─────────
const qs = (q: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const pageHref = (site: SiteId, id: number, crawl: number) => `/${site}/pages/${id}${qs({ crawl })}`;
const elementHref = (site: SiteId, pageId: number, crawl: number, baseline: number | null, it: Instance) =>
  `/${site}/pages/${pageId}?crawl=${crawl}${baseline != null ? `&vs=${baseline}` : ""}&issue=${it.k + 1}`;

// ───────── Shapes ─────────
const crawlJson = (c: CrawlRow) => ({
  id: c.id, site: c.site, status: c.status, started_at: c.startedAt.toISOString(), duration_sec: c.durationSec, pages: c.pages,
  error_pct: c.errorPct, trigger: c.trigger, progress_pct: c.progressPct, ui_url: `/${c.site}/crawls/${c.id}`,
});

const ruleJson = (r: Rule, site: SiteId, full = true) => ({
  id: r.id, title: r.title, category: r.category, severity: r.severity, priority: PRIORITY[r.severity], source: r.source, wcag: r.criterion ?? null,
  ...(full ? { why: r.why, how_to_fix: r.howToFix, references: r.refs } : {}),
  ui_url: `/${site}/issues/${r.id}`,
});

const trim = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ELEMENTS_PER_ISSUE = 6;

function pageJson(site: SiteId, p: PageView, crawl: number, baseline: number | null, detail: boolean) {
  const counts = currentIssueCounts(p);
  return {
    id: p.i, site, path: p.path, url: p.url, title: p.title, h1: p.h1, type: p.type, type_label: typeLabel(p.type), http_status: p.status,
    change: p.change, last_changed_crawl: p.lastChanged,
    issues: p.change === "removed" ? null : { ...counts.byPriority, total: counts.total },
    by_category: p.change === "removed" ? null : counts.byCategory,
    crawl, baseline, ui_url: pageHref(site, p.i, crawl),
    ...(detail ? { year: p.path.match(/\/(20\d{2})\//)?.[1] ?? null } : {}),
  };
}

function issuesOf(site: SiteId, p: PageView, crawl: number, baseline: number | null, instances: Instance[], first?: number) {
  const byRule = new Map<string, Instance[]>();
  for (const it of instances) byRule.set(it.rule, [...(byRule.get(it.rule) ?? []), it]);
  const out = [...byRule.entries()].map(([id, list]) => {
    const r = RULE_CATALOG[id];
    if (first != null) list = [...list.filter((x) => x.k === first), ...list.filter((x) => x.k !== first)];
    return {
      page: p.i, page_path: p.path, crawl, rule: id, title: r.title, priority: PRIORITY[r.severity], severity: r.severity, category: r.category,
      wcag: r.criterion ?? null, how_to_fix: r.howToFix, references: r.refs,
      elements_total: list.length,
      elements: list.slice(0, ELEMENTS_PER_ISSUE).map((it) => ({
        id: issueId(site, p.i, it.k), selector: it.selector, html: trim(it.snippet), status: it.status, first_seen: it.firstSeen,
        shared_pages: it.shared, origin: it.origin, ui_url: elementHref(site, p.i, crawl, baseline, it),
      })),
      ui_url: elementHref(site, p.i, crawl, baseline, list[0]),
    };
  });
  return out.sort((x, y) => x.priority.localeCompare(y.priority) || y.elements_total - x.elements_total);
}

// ───────── Page lookup (id, full URL or path) ─────────
const viewCache = new Map<string, PageView[]>();
function views(site: SiteId, a: number, b: number | null) {
  const key = `${site}:${a}:${b}`;
  let v = viewCache.get(key);
  if (!v) { v = pagesFor(site, a, b); if (viewCache.size > 4) viewCache.clear(); viewCache.set(key, v); }
  return v;
}

function findPage(site: SiteId, ref: string, crawl: number, baseline: number | null): PageView {
  const s = ref.trim();
  if (/^\d+$/.test(s)) {
    const p = pageView(site, Number(s), crawl, baseline);
    if (p) return p;
    return fail(`Page ${s} isn't in crawl ${crawl} of ${site}${baseline != null ? ` or ${baseline}` : ""}. Use find_pages to look it up.`);
  }
  let path: string;
  try { path = new URL(s, "https://x.invalid").pathname.replace(/\/+$/, "") || "/"; } catch { path = s; }
  const clean = (value: string) => value.replace(/\/+$/, "") || "/";
  const hit = views(site, crawl, baseline).find((p) => clean(p.path) === path);
  if (hit) return hit;
  const maybe = views(site, crawl, null).find((p) => clean(p.path).toLowerCase() === path.toLowerCase());
  return fail(`No page with path ${path} in crawl ${crawl} of ${site}.${maybe ? ` Did you mean ${maybe.path}?` : " Use find_pages with q to search by path or title."}`);
}

// ───────── The Core ─────────
export function list_sites() {
  return SITE_IDS.map((id) => {
    const s = SITES[id], latest = defaultCrawl(id);
    return { id, name: s.name, url: s.url, qa: s.qa, latest_crawl: latest ? latest.id : null, ui_url: `/${id}/overview` };
  });
}

export function find_crawls(a: Args) {
  const site = siteOf(a);
  const status = text(a, "status");
  return crawlsFor(site).filter((c) => !status || c.status === status).slice(0, limitOf(a, 10, 50)).map(crawlJson);
}

export function get_crawl(a: Args) {
  const site = siteOf(a);
  const id = String(a.crawl ?? "");
  const c = crawlsFor(site).find((x) => x.id === id) ?? fail(`Crawl ${id} not found for ${site}. Use find_crawls to list crawl ids.`);
  return crawlJson(c);
}

export function find_pages(a: Args) {
  const site = siteOf(a);
  const { crawl, baseline, isDefault } = scope(site, a);
  const q = text(a, "q")?.toLowerCase(), type = text(a, "type"), year = text(a, "year"), change = text(a, "change"), category = text(a, "category") as Category | undefined;
  const sort = text(a, "sort") ?? "worst";
  if (type && !PAGE_TYPES.some((t) => t.id === type)) fail(`Unknown type "${type}". Types: ${PAGE_TYPES.map((t) => t.id).join(", ")}.`);
  let rows = views(site, crawl, baseline).filter((p) =>
    (!q || p.path.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) && (!type || p.type === type) &&
    (!year || (year === "none" ? !/\/20\d{2}\//.test(p.path) : p.path.includes(`/${year}/`))) && (change ? p.change === change : p.change !== "removed"));
  const key = (p: PageView) => {
    if (sort !== "p1") return severity(p, category ?? null);
    const counts = currentIssueCounts(p);
    return counts.critical * 1000 + counts.total;
  };
  if (sort === "path") rows = [...rows].sort((x, y) => x.path.localeCompare(y.path));
  else if (sort === "changed") rows = [...rows].sort((x, y) => (y.lastChanged ?? -1) - (x.lastChanged ?? -1));
  else rows = [...rows].sort((x, y) => key(y) - key(x) || x.i - y.i);
  const start = a.cursor ? Number(Buffer.from(String(a.cursor), "base64url").toString()) || 0 : 0;
  const limit = limitOf(a, 20, 50);
  const slice = rows.slice(start, start + limit);
  const uiSort = sort === "p1" ? "worst" : category && sort === "worst" ? `cat:${category}` : sort;
  return {
    site, crawl, baseline, total: rows.length,
    pages: slice.map((p) => pageJson(site, p, crawl, baseline, false)),
    next_cursor: start + limit < rows.length ? Buffer.from(String(start + limit)).toString("base64url") : null,
    ui_url: `/${site}/pages${qs({ crawl: isDefault ? null : crawl, type, year, q: text(a, "q"), sort: uiSort === "worst" ? null : uiSort, change })}`,
  };
}

export function get_page(a: Args) {
  const site = siteOf(a);
  const { crawl, baseline } = scope(site, a);
  return pageJson(site, findPage(site, String(a.page ?? ""), crawl, baseline), crawl, baseline, true);
}

export function find_issues(a: Args) {
  const site = siteOf(a);
  const { crawl, baseline } = scope(site, a);
  const p = findPage(site, String(a.page ?? ""), crawl, baseline);
  const pri = Array.isArray(a.priority) ? (a.priority as string[]) : a.priority ? [String(a.priority)] : [];
  const cat = Array.isArray(a.category) ? (a.category as string[]) : a.category ? [String(a.category)] : [];
  const status = text(a, "status");
  for (const x of pri) if (!PRIORITIES.includes(x as Priority)) fail(`Priority must be P1, P2, P3 or P4, got "${x}".`);
  const list = pageIssues(p, crawl, baseline).instances.filter((it) => {
    const r = RULE_CATALOG[it.rule];
    return (!pri.length || pri.includes(PRIORITY[r.severity])) && (!cat.length || cat.includes(r.category)) && (!status || it.status === status);
  });
  return { site, page: p.i, page_path: p.path, crawl, baseline, total_elements: list.length, issues: issuesOf(site, p, crawl, baseline, list), ui_url: pageHref(site, p.i, crawl) };
}

export function find_issues_by_rule(a: Args) {
  const site = siteOf(a);
  const id = String(a.rule ?? "");
  const rule = RULE_CATALOG[id] ?? fail(`Unknown rule "${id}". Use list_rules to see rule ids.`);
  const { crawl, baseline } = scope(site, a);
  const hits = hitsFor(site, crawl, baseline).filter((h) => h.rule === id && h.elements > 0);
  const byPage = new Map<number, { h: (typeof hits)[number]; elements: number; added: number }>();
  for (const h of hits) {
    const cur = byPage.get(h.p.i);
    if (cur) { cur.elements += h.elements; cur.added += h.added; } else byPage.set(h.p.i, { h, elements: h.elements, added: h.added });
  }
  const rows = [...byPage.values()].sort((x, y) => y.elements - x.elements || x.h.p.i - y.h.p.i);
  const start = a.cursor ? Number(Buffer.from(String(a.cursor), "base64url").toString()) || 0 : 0;
  const limit = limitOf(a, 15, 50);
  return {
    site, crawl, baseline, rule: ruleJson(rule, site, false),
    pages_affected: rows.length, elements: rows.reduce((n, r) => n + r.elements, 0),
    patterns: byRule(hits, "all")[0]?.patterns.slice(0, 10) ?? [],
    pages: rows.slice(start, start + limit).map((r) => ({
      page: r.h.p.i, path: r.h.p.path, elements: r.elements, new_elements: r.added, example_element: issueId(site, r.h.p.i, r.h.k),
      ui_url: pageHref(site, r.h.p.i, crawl),
    })),
    next_cursor: start + limit < rows.length ? Buffer.from(String(start + limit)).toString("base64url") : null,
    ui_url: `/${site}/issues/${id}`,
  };
}

export function get_issue(a: Args) {
  const id = String(a.element_id ?? "").trim();
  if (!/^\d+$/.test(id)) return fail(`"${id}" isn't an element id. Ids come from @issue references or find_issues / find_issues_by_rule results.`);
  const requested = a.crawl == null || a.crawl === "latest" ? undefined : Number(a.crawl);
  const comparison = a.baseline === undefined ? undefined : a.baseline === null || a.baseline === "none" ? null : Number(a.baseline);
  const resolved = resolveIssue(id, { crawl: requested, baseline: comparison });
  if (!resolved) return fail(`No recorded element with id ${id}${requested == null ? "" : ` in crawl ${requested}`}. Ids come from @issue references or find_issues / find_issues_by_rule results.`);
  const { site, page, crawl, baseline, it, rule } = resolved;
  const instances = issueSlots(page, crawl, baseline).filter((element) => element.rule === it.rule);
  const issue = issuesOf(site, page, crawl, baseline, instances, it.k)[0];
  return { site, page_url: page.url, source: rule.source, why: rule.why, ...issue, ui_url: resolved.href() };
}

export function list_rules(a: Args) {
  const cat = text(a, "category");
  const site = (text(a, "site") as SiteId | undefined) ?? "rbccm";
  return Object.values(RULE_CATALOG).filter((r) => !cat || r.category === cat).map((r) => ruleJson(r, site, false));
}

export function get_rule(a: Args) {
  const id = String(a.rule ?? "");
  const site = (text(a, "site") as SiteId | undefined) ?? "rbccm";
  return ruleJson(RULE_CATALOG[id] ?? fail(`Unknown rule "${id}". Use list_rules to see rule ids.`), site);
}
