// Cmd+K search: instant, deterministic, ranked. Turns what someone types or pastes into places in the app.
//   search("p1 accessibility") → [{ url: "/rbccm/issues?cat=accessibility&pri=P1", chips: [...], … }]
// Every result URL passes validateUrl. When nothing scores well (isWeak), the palette asks the AI (./ai.ts).
// Pieces: ./parse.ts reads filters out of the words, ./index.ts holds the lookups, this file turns it all
// into candidate places and ranks them.
import { loadRules } from "@/lib/custom-rules";
import { resolveIssue } from "@/lib/refs";
import { RULE_CATALOG, SEVERITIES } from "@/lib/page-issues";
import { PRIORITY, PRIORITY_COLOR } from "@/lib/priority";
import { CATEGORIES, PAGE_TYPES } from "@/lib/site-pages";
import { crawlsFor } from "@/lib/crawls-list";
import { SITES, type SiteId } from "@/lib/sites";
import { asSite, baseOf, contentWords, crawlOwner, matchRules, pageIndex, siteOf, siteOfHost, siteShort, words, HOSTS } from "./index";
import { parse, type SectionId, type Intent } from "./parse";
import { buildUrl, validateUrl, type Chip } from "./url-map";

export type Kind = "page" | "issue" | "rule" | "crawl" | "section" | "site" | "filter" | "recent";
// mark: the same small marker the Ask AI chips use (a coloured dot, and a priority), shown instead of the type icon
export type Mark = { dot: string; tag?: string; tagColor?: string };
export type Result = { url: string; title: string; subtitle?: string; kind: Kind; score: number; chips: Chip[]; mark?: Mark };
export type SearchContext = { site: string; url: string };

export const WEAK = 0.6; // below this, the palette also asks the AI
export const UNSURE = 0.95; // for queries of 3+ words: below this the palette asks the AI too, and its answer goes on top
export const isWeak = (r: Result[]) => !r.length || r[0].score < WEAK;
const NON_NAV_CAP = 0.45; // "how do I fix…", "delete crawl 806": questions and commands aren't places

type Cand = Omit<Result, "chips">;
const cand = (url: string, title: string, subtitle: string | undefined, kind: Kind, score: number, mark?: Mark): Cand => ({ url, title, subtitle, kind, score, mark });
const sevDot = (sev: string) => `${SEVERITIES.find((x) => x.id === sev)?.color ?? "gray"}.solid`;
export const ruleMark = (r: { severity: string }): Mark => ({ dot: sevDot(r.severity), tag: PRIORITY[r.severity as keyof typeof PRIORITY], tagColor: PRIORITY_COLOR[PRIORITY[r.severity as keyof typeof PRIORITY]] });
export const CRAWL_DOT: Record<string, string> = { running: "blue.solid", paused: "orange.solid", success: "green.solid", failed: "red.solid", cancelled: "gray.solid" };

// ───────── Recents (this browser) ─────────
const RECENT_KEY = "crawler.palette.recent";
type Recent = { url: string; title: string; subtitle?: string };
export function loadRecents(): Recent[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((r) => r && typeof r.url === "string" && validateUrl(r.url).ok).slice(0, 8) : []; } catch { return []; }
}
export function saveRecent(r: Pick<Result, "url" | "title" | "subtitle">) {
  try {
    const next = [{ url: r.url, title: r.title, subtitle: r.subtitle }, ...loadRecents().filter((x) => x.url !== r.url)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
}

// Builds the lookups for a site now (the palette calls this on open, so the first query isn't the slow one)
export const preload = (site: string) => { pageIndex(asSite(site)); };

// ───────── Pasted things ─────────
const KNOWN_HOST = new RegExp(`^(?:www\\.)?(?:${Object.keys(HOSTS).map((h) => h.replace(/\./g, "\\.")).join("|")}|localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?(?:[/?#]|$)`, "i");
const looksPasted = (q: string) => !/\s/.test(q) && (/^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^www\./i.test(q) || q.startsWith("/") || /^(?:en|fr)\//.test(q) || KNOWN_HOST.test(q));

function pageResult(site: SiteId, p: { i: number; path: string; title: string }, score: number): Cand {
  return cand(`/${site}/pages/${p.i}`, p.title, `${p.path} · ${siteShort(site)}`, "page", score);
}

// A path on a crawled site: the page, a folder ("/en/podcasts/2024/") as a Pages filter, or a path search
function pathCandidates(site: SiteId, rawPath: string): Cand[] {
  let path = rawPath.split(/[?#]/)[0];
  try { path = decodeURI(path); } catch { /* keep */ }
  path = path.replace(/\/+$/, "") || "/";
  const hit = pageIndex(site).byPath.get(path);
  if (hit) return [pageResult(site, hit, 1)];
  const segs = path.split("/").filter(Boolean);
  const type = PAGE_TYPES.find((t) => t.prefix === `/${segs[0]}/${segs[1] ?? ""}/`);
  const rest = segs.slice(2);
  if (type && (rest.length === 0 || (rest.length === 1 && /^20\d\d$/.test(rest[0])))) {
    const v = buildUrl("pages", site, {}, { type: type.id, year: rest[0] });
    if (v.ok) return [cand(v.url, "Pages", `${type.label}${rest[0] ? ` · ${rest[0]}` : ""} · ${siteShort(site)}`, "filter", 0.95)];
  }
  const v = buildUrl("pages", site, {}, { q: path });
  return v.ok ? [cand(v.url, "Pages", `URLs containing ${path} · ${siteShort(site)}`, "filter", 0.8)] : [];
}

function pastedCandidates(q: string, ctx: SiteId): Cand[] {
  const s = q.startsWith("/") || /^(?:en|fr)\//.test(q) ? (q.startsWith("/") ? q : "/" + q) : q;
  if (s.startsWith("/")) {
    const v = validateUrl(s);
    if (v.ok) return [cand(v.url, v.route.label, undefined, "section", 1)];
    return pathCandidates(ctx, s);
  }
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#]+)([^#]*)/i.exec(s);
  if (!m) return [];
  const host = m[1].replace(/:\d+$/, "");
  const site = siteOfHost(host);
  if (site) {
    const path = m[2].split("?")[0];
    if (!path || path === "/") return [cand(`/${site}/analytics`, SITES[site].name, "Analytics", "site", 1)];
    return pathCandidates(site, m[2]);
  }
  // any other host (the app itself, in dev or deployed): the path and query are an app URL
  const v = validateUrl(m[2] || "/");
  return v.ok ? [cand(v.url, v.route.label, undefined, "section", 1)] : [];
}

// ───────── Numbers: crawls and issue ids ─────────
function numberCandidates(q: string): Cand[] {
  const m = /^(?:crawl\s*#?|#)?(\d+)$/i.exec(q.trim());
  if (!m) return [];
  const n = m[1], explicit = /^(?:crawl|#)/i.test(q.trim()), out: Cand[] = [];
  const owner = crawlOwner(n);
  if (owner) {
    const c = crawlsFor(owner).find((x) => x.id === n)!;
    const site = owner;
    out.push(cand(`/${site}/crawls/${n}`, `Crawl #${n}`, `${siteShort(site)} · ${STATUS_LABEL[c.status]} · ${c.startedAt.toISOString().slice(0, 10)}`, "crawl", explicit ? 1 : 0.95, { dot: CRAWL_DOT[c.status] }));
  }
  if (!explicit && n.length >= 5 && resolveIssue(n)) {
    const r = resolveIssue(n)!;
    out.push(cand(r.href(), r.rule.title, `${r.page.path} · ${siteShort(r.site)}`, "issue", 1, ruleMark(r.rule)));
  }
  return out;
}

// ───────── "crawl" on its own: the likeliest next click is a recent crawl ─────────
export const STATUS_LABEL: Record<string, string> = { running: "Running", paused: "Paused", success: "Succeeded", failed: "Failed", cancelled: "Cancelled" };
export const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function recentCrawls(it: Intent, ctx: SiteId): Cand[] {
  if (it.section !== "crawls" || it.f.crawl || it.leftover.length || !it.consumed) return [];
  const site = it.base !== undefined || it.qa ? siteOf(it.base ?? baseOf(ctx), it.qa) : ctx;
  return crawlsFor(site).slice(0, 5).map((c, k) => cand(`/${site}/crawls/${c.id}`, `Crawl #${c.id}`,
    `${STATUS_LABEL[c.status]} · ${DAY.format(c.startedAt)}${c.status === "success" || c.status === "failed" ? ` · ${(c.pages / 1000).toFixed(1)}K pages` : ""}`, "crawl", 0.7 - k * 0.01, { dot: CRAWL_DOT[c.status] }));
}

// ───────── References copied from Ask AI: @issue:ID, @rule:ID, @page:ID, @crawl:ID ─────────
const REF = /^@(issue|rule|page|crawl)\s*:\s*([\w-]+)$/i;
function refCandidates(q: string, ctx: SiteId): Cand[] {
  const m = REF.exec(q.trim());
  if (!m) return [];
  const kind = m[1].toLowerCase(), id = m[2];
  if (kind === "issue") {
    const r = /^\d+$/.test(id) ? resolveIssue(id) : null;
    return r ? [cand(r.href(), r.rule.title, `${r.page.path} · ${siteShort(r.site)}`, "issue", 1, ruleMark(r.rule))] : [];
  }
  if (kind === "rule") { const c = ruleCand(id.toLowerCase(), ctx, 1); return c ? [c] : []; }
  if (kind === "page") {
    const p = /^\d+$/.test(id) ? pageIndex(ctx).all.find((x) => x.i === Number(id)) : undefined;
    return p ? [pageResult(ctx, p, 1)] : [];
  }
  return numberCandidates(`crawl ${id}`);
}

// ───────── Rules ─────────
const ruleCand = (id: string, site: SiteId, score: number, params: Record<string, string> = {}): Cand | null => {
  const custom = loadRules(site).find((r) => r.id === id);
  if (custom) return cand(`/${site}/issues`, custom.name, custom.pattern, "rule", score);
  const r = RULE_CATALOG[id];
  const v = buildUrl("rule", site, { ruleId: id }, params);
  if (!r || !v.ok) return null;
  const cat = CATEGORIES.find((c) => c.id === r.category)!.label;
  return cand(v.url, r.title, `${cat} · ${r.id}`, "rule", score, ruleMark(r));
};

function ruleCandidates(q: string, site: SiteId): Cand[] {
  const lower = q.trim().toLowerCase();
  const out: Cand[] = [];
  const exact = Object.values(RULE_CATALOG).find((r) => r.id === lower || r.title.toLowerCase() === lower || r.id.replace(/-/g, " ") === lower);
  if (exact) { const c = ruleCand(exact.id, site, 1); if (c) out.push(c); }
  for (const m of matchRules(contentWords(q)).slice(0, 3)) { const c = ruleCand(m.id, site, m.score); if (c) out.push(c); }
  return out;
}

// ───────── Parsed filters, sections and sites ─────────
// When the words name several sections ("pages that changed with seo problems"), try each: the one that can use
// the most of what was said scores highest.
function intentCandidate(it: Intent, ctx: SiteId): Cand | null {
  if (!it.consumed) return null;
  if (it.sections.length < 2) return intentFor(it, ctx, it.section);
  const all = it.sections.map((s) => intentFor(it, ctx, s)).filter((c): c is Cand => !!c);
  return all.sort((a, b) => b.score - a.score)[0] ?? null;
}

function intentFor(it: Intent, ctx: SiteId, named: SectionId | undefined): Cand | null {
  const f = { ...it.f };
  delete f.sinceLast;
  const crawlSite = f.crawl ? crawlOwner(f.crawl) : null;
  const explicit = it.base !== undefined || it.qa;
  const site: SiteId = explicit ? siteOf(it.base ?? baseOf(ctx), it.qa) : (crawlSite ?? ctx);
  const used = new Set<string>();
  const take = (...keys: string[]) => Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => { used.add(k); return [k, f[k]]; }));
  const finish = (url: ReturnType<typeof buildUrl>, title: string, subtitle: string, kind: Kind, base: number, q = 1): Cand | null => {
    if (!url.ok) return null;
    const unsupported = Object.keys(f).filter((k) => !used.has(k)).length + (it.isNew && !used.has("isNew") ? 1 : 0);
    const conf = it.consumed / (it.consumed + it.leftover.length + unsupported);
    return cand(url.url, title, subtitle, kind, base * conf * q);
  };
  const where = siteShort(site);

  if (it.rule) {
    const r = RULE_CATALOG[it.rule.id];
    const params: Record<string, string> = take("type", "crawl", "vs");
    if (f.seg || it.isNew) { params.seg = f.seg ?? "new"; used.add("seg"); used.add("isNew"); }
    const url = buildUrl("rule", site, { ruleId: r.id }, params);
    const cat = CATEGORIES.find((c) => c.id === r.category)!.label;
    return finish(url, r.title, `${PRIORITY[r.severity]} · ${cat} · ${where}`, "rule", 0.97, it.rule.q);
  }

  let section = named;
  const hasPagesKey = ["year", "rule", "links", "change", "sort"].some((k) => f[k]);
  const hasIssuesKey = ["pri", "cat", "markup", "seg"].some((k) => f[k]);
  if (!section) {
    if (f.v || f.range) section = "analytics";
    else if (hasPagesKey) section = "pages";
    else if (hasIssuesKey) section = "issues";
    else if (f.type || it.isNew) section = "pages";
    else if (f.crawl) section = "crawls";
    else if (explicit) return finish(buildUrl("analytics", site), SITES[site].name, "Analytics", "site", 1);
    else return null;
  }
  const exactness = it.sectionFuzzy ? 0.85 : 1;

  switch (section) {
    case "issues": {
      const params: Record<string, string> = take("crawl", "vs", "cat", "pri", "markup", "type");
      if (f.seg || it.isNew) { params.seg = f.seg ?? "new"; used.add("seg"); used.add("isNew"); }
      const kind: Kind = Object.keys(params).length ? "filter" : "section";
      return finish(buildUrl("issues", site, {}, params), "Issues", where, kind, kind === "filter" ? 0.96 : exactness);
    }
    case "pages": {
      const params: Record<string, string> = take("crawl", "vs", "type", "year", "rule", "links", "change", "sort");
      if (!params.change && it.isNew) { params.change = "new"; used.add("isNew"); }
      if (!params.sort && f.cat) { params.sort = "cat:" + f.cat; used.add("cat"); }
      const kind: Kind = Object.keys(params).length ? "filter" : "section";
      return finish(buildUrl("pages", site, {}, params), "Pages", where, kind, kind === "filter" ? 0.96 : exactness);
    }
    case "analytics": {
      const params: Record<string, string> = take("v");
      if (f.range && ["7", "30", "all"].includes(f.range)) { params.range = f.range; used.add("range"); }
      const kind: Kind = Object.keys(params).length ? "filter" : "section";
      return finish(buildUrl("analytics", site, {}, params), "Analytics", where, kind, kind === "filter" ? 0.96 : exactness);
    }
    case "crawls": {
      if (f.crawl) { used.add("crawl"); return finish(buildUrl("crawl", site, { crawlId: f.crawl }), `Crawl #${f.crawl}`, where, "crawl", 1); }
      return finish(buildUrl("crawls", site), "Crawls", `All crawls · ${where}`, "crawl", exactness);
    }
    default: {
      const label = "Settings";
      return finish(buildUrl(section, site), label, where, "section", exactness);
    }
  }
}

// ───────── Pages by title (what's left when nothing above understood the words) ─────────
function titleCandidates(q: string, site: SiteId): Cand[] {
  const toks = words(q).filter((w) => w.length >= 2);
  if (!toks.length || q.trim().length < 3) return [];
  const out: Cand[] = [];
  for (const p of pageIndex(site).all) {
    if (toks.every((t) => p.hay.includes(t))) { out.push(pageResult(site, p, 0.7)); if (out.length >= 4) break; }
  }
  return out;
}

const KIND_ORDER: Kind[] = ["issue", "page", "rule", "crawl", "filter", "section", "site", "recent"];

// Browsing (empty query): where you were, then the sections
function browse(site: SiteId): Cand[] {
  const out: Cand[] = loadRecents().map((r, k) => cand(r.url, r.title, r.subtitle, "recent", 0.5 - k * 0.01));
  for (const id of ["analytics", "crawls", "pages", "issues", "settings"] as const) {
    const v = buildUrl(id, site);
    if (v.ok) out.push(cand(v.url, v.route.label, SITES[site].short, "section", 0.1));
  }
  return out;
}

export function search(query: string, ctx: SearchContext): Result[] {
  const q = query.trim();
  const site = asSite(ctx.site);
  let cands: Cand[];
  if (!q) cands = browse(site);
  else {
    cands = [];
    const refs = refCandidates(q, site);
    if (refs.length) cands.push(...refs);
    else if (looksPasted(q)) cands.push(...pastedCandidates(q, site));
    else {
      cands.push(...numberCandidates(q));
      cands.push(...ruleCandidates(q, site));
      const it = parse(q);
      const c = intentCandidate(it, site);
      if (c) cands.push(c);
      cands.push(...recentCrawls(it, site));
      if (it.nonNav) cands = cands.map((x) => ({ ...x, score: Math.min(x.score, NON_NAV_CAP) }));
      else if (!cands.some((x) => x.score >= 0.9)) cands.push(...titleCandidates(q, site));
      const toks = words(q);
      for (const r of loadRecents()) if (toks.length && toks.every((t) => (r.title + " " + r.url).toLowerCase().includes(t))) cands.push(cand(r.url, r.title, r.subtitle, "recent", 0.55));
      if (!it.nonNav && q.length >= 3 && !cands.some((x) => x.score >= 0.9)) {
        // last resort: search the text in the URL list
        const v = buildUrl("pages", site, {}, { q });
        if (v.ok) cands.push(cand(v.url, "Pages", `URLs containing “${q}” · ${siteShort(site)}`, "filter", 0.3));
      } else if (it.nonNav) {
        const v = buildUrl("pages", site, {}, { q });
        if (v.ok) cands.push(cand(v.url, "Pages", `URLs containing “${q}” · ${siteShort(site)}`, "filter", 0.2));
      }
    }
  }
  // validate, dedupe (best score wins), rank
  const best = new Map<string, Result>();
  for (const c of cands) {
    const v = validateUrl(c.url);
    if (!v.ok) continue;
    const prev = best.get(v.url);
    if (!prev || c.score > prev.score) best.set(v.url, { ...c, url: v.url, chips: v.chips });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).slice(0, 8);
}
