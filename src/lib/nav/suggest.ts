// Autosuggest, pure and synchronous. What is suggested depends on what is being typed:
//   after "@"       suggestFor({ kind: null, text: "iss" }, ctx)      → [@issue:]            (the kinds, filtered by what is typed)
//   after "@rule:"  suggestFor({ kind: "rule", text: "ima" }, ctx)    → [matching saved rules]
//   a plain word    suggestFor({ word: "acc" }, ctx, "search")        → [Accessibility]      (filter words; search mode only)
// A "stem" suggestion completes "@issue:" (the entities of that kind follow); a "ref" one is an entity; the filter
// words complete the word before the caret as plain text.
import { loadRules } from "@/lib/custom-rules";
import { crawlsFor } from "@/lib/crawls-list";
import { RULE_CATALOG, sevRank } from "@/lib/page-issues";
import { hitsFor } from "@/lib/site-issues";
import { currentIssueCounts, defaultCrawl, pagesFor } from "@/lib/site-pages";
import { issueId, resolveIssue } from "@/lib/refs";
import { asSite, pageIndex } from "./index";
import { FACETS, type TokenMode } from "./chips";
import type { RefKind } from "./segments";
import { CRAWL_DOT, DAY, ruleMark, STATUS_LABEL, type Mark, type SearchContext } from "./search";
import type { SiteId } from "@/lib/sites";

export type Suggestion = {
  text: string; // what the typed text becomes
  label: string;
  hint?: string;
  kind: "filter" | "section" | "ref" | "stem"; // stem: "@issue:", completes the kind of a mention
  mark?: Mark;
  value?: string;
  ref?: RefKind; // the mention kind a "stem" chooses, or a "ref" belongs to
};

const INITIAL = 12; // what a mention lists before anything is typed
const LIST_MAX = 30; // and at most, while filtering (the list scrolls)
const CRAWLS_SHOWN = 8;
const FACETS_SHOWN = 6;
const STEMS: { name: RefKind; hint: string }[] = [
  { name: "issue", hint: "an issue by id" }, { name: "rule", hint: "a rule by name" },
  { name: "page", hint: "a page by title" }, { name: "crawl", hint: "a crawl by number" },
];

export type SuggestInput = { kind: RefKind | null; text: string } | { word: string };

export function suggestFor(input: SuggestInput, ctx: SearchContext, mode: TokenMode = "search"): Suggestion[] {
  if ("word" in input) return input.word && !input.word.startsWith("@") && mode === "search" ? facets(input.word) : [];
  return input.kind === null ? stems(input.text) : entities(input.kind, input.text, ctx);
}

function facets(word: string): Suggestion[] {
  const w = word.toLowerCase();
  if (w.length < 2 && w !== "p") return [];
  return FACETS
    .map((x, order) => ({ x, order, byLabel: x.label.toLowerCase().startsWith(w) || x.text.startsWith(w), byAlias: x.aliases.some((a) => a.startsWith(w)) }))
    .filter(({ byLabel, byAlias }) => byLabel || byAlias)
    .sort((a, b) => Number(!a.byLabel) - Number(!b.byLabel) || a.x.label.length - b.x.label.length || a.order - b.order)
    .slice(0, FACETS_SHOWN)
    .map(({ x }) => ({ text: x.text, label: x.label, hint: x.hint, kind: x.kind, value: x.value }));
}

function stems(text: string): Suggestion[] {
  const t = text.trim().toLowerCase();
  return STEMS.filter((s) => s.name.startsWith(t)).map((s) => ({ text: `@${s.name}:`, label: `@${s.name}:`, hint: s.hint, kind: "stem" as const, ref: s.name }));
}

// ───────── What each kind lists ─────────
// The site's issues, worst first (P1, then P2 …), at most three per rule so the list isn't one problem repeated
const issueCache = new Map<string, { id: string; page: number }[]>();
function sitewideIssues(site: SiteId) {
  let pool = issueCache.get(site);
  if (pool) return pool;
  const hits = hitsFor(site, Number(defaultCrawl(site).id), null)
    .filter((h) => !h.shared && RULE_CATALOG[h.rule])
    .sort((x, y) => sevRank(RULE_CATALOG[x.rule].severity) - sevRank(RULE_CATALOG[y.rule].severity) || y.elements - x.elements);
  const per = new Map<string, number>();
  pool = [];
  for (const h of hits) {
    const n = per.get(h.rule) ?? 0;
    if (n >= 3) continue;
    per.set(h.rule, n + 1);
    pool.push({ id: issueId(site, h.p.i, h.k), page: h.p.i });
  }
  issueCache.set(site, pool);
  return pool;
}

// The pages with the most critical issues first, then the most issues
const pageCache = new Map<string, number[]>();
function worstPages(site: SiteId) {
  let pages = pageCache.get(site);
  if (pages) return pages;
  pages = pagesFor(site, Number(defaultCrawl(site).id), null)
    .map((page) => ({ id: page.i, ...currentIssueCounts(page) })).filter(({ total }) => total > 0)
    .sort((a, b) => b.critical - a.critical || b.total - a.total || a.id - b.id).map(({ id }) => id);
  pageCache.set(site, pages);
  return pages;
}

function entities(kind: RefKind, text: string, ctx: SearchContext): Suggestion[] {
  const site = asSite(ctx.site), q = text.trim().toLowerCase(), cap = q ? LIST_MAX : INITIAL;
  const ref = (id: string, label: string, hint?: string, mark?: Mark): Suggestion => ({ text: `@${kind}:${id}`, label, hint, mark, kind: "ref", value: id, ref: kind });

  if (kind === "crawl") {
    if (!/^\d*$/.test(q)) return [];
    return crawlsFor(site).filter((c) => c.id.startsWith(q)).slice(0, q ? LIST_MAX : CRAWLS_SHOWN)
      .map((c) => ref(c.id, `#${c.id}`, `${STATUS_LABEL[c.status]} · ${DAY.format(c.startedAt)}`, { dot: CRAWL_DOT[c.status] }));
  }
  if (kind === "rule") {
    return loadRules(site)
      .filter((r) => !q || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.pattern.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, cap).map((r) => ref(r.id, r.name, r.pattern));
  }
  if (kind === "page") {
    const all = pageIndex(site).all;
    if (!q) {
      const byId = new Map(all.map((p) => [p.i, p]));
      const out: Suggestion[] = [];
      for (const i of worstPages(site)) { const p = byId.get(i); if (p) out.push(ref(String(p.i), p.title, p.path)); if (out.length >= cap) break; }
      return out;
    }
    const out: Suggestion[] = [];
    for (const p of all) {
      if (String(p.i).startsWith(q) || p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) { out.push(ref(String(p.i), p.title, p.path)); if (out.length >= cap) break; }
    }
    return out;
  }
  // issue: all the issues of the page you're looking at, else the worst on the site; a typed id that exists too
  const pageId = /^\/[^/]+\/pages\/(\d+)\/?$/.exec(ctx.url.split(/[?#]/)[0])?.[1];
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (id: string, detail: "selector" | "path") => {
    const r = resolveIssue(id);
    if (!r || seen.has(id)) return !!r;
    seen.add(id);
    out.push(ref(id, r.rule.title, detail === "path" ? r.page.path : r.it.selector, ruleMark(r.rule)));
    return true;
  };
  const matches = (id: string) => {
    if (!q) return true;
    const r = resolveIssue(id);
    return !!r && (id.startsWith(q) || r.rule.title.toLowerCase().includes(q) || r.page.path.toLowerCase().includes(q) || r.it.selector.toLowerCase().includes(q));
  };
  if (/^\d{5,}$/.test(q)) add(q, "path");
  if (pageId !== undefined) {
    for (let k = 0; k < 60 && out.length < LIST_MAX; k++) {
      const id = issueId(site, Number(pageId), k);
      if (!resolveIssue(id)) break;
      if (matches(id)) add(id, "selector");
    }
  }
  if (!out.length || pageId === undefined) {
    for (const w of sitewideIssues(site)) { if (matches(w.id)) add(w.id, "path"); if (out.length >= cap) break; }
  }
  return out.slice(0, pageId !== undefined && !q ? LIST_MAX : cap);
}
