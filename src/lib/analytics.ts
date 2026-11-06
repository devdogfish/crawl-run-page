// PROTOTYPE DATA for /[site]/analytics: how healthy the site is, and where it's heading.
//
// It's about the site, not the crawler: every number comes from the latest finished crawl (the same issues as the
// Issues page, via hitsFor), and the history is one point per earlier crawl. Nothing here is about how crawls ran.
//
// Health score (0–100), like Lighthouse: each page starts at 100 and loses points for every rule failing on it,
// by priority (P1 −25, P2 −10, P3 −3, P4 −1). The site's score is the average over its pages. A category's score
// uses only that category's rules; performance only counts the pages Lighthouse audited.
// "If shared markup were fixed" recomputes the score without the elements in markup shared across pages
// (header, footer, cookie banner), which are one fix each in the templates.
//
// History: the real backend stores these rollups per crawl. Here the latest point is computed from the issues and
// earlier points are modelled from it (P1s going down after a fix release, P3s creeping up with new content), so
// the trends have a shape to look at.
import { RULE_CATALOG, type Rule } from "@/lib/page-issues";
import { PRIORITIES, PRIORITY, PRIORITY_DOT, type Priority } from "@/lib/priority";
import { byRule, hitsFor, type Hit, type RuleRow } from "@/lib/site-issues";
import { CATEGORIES, PAGE_TYPES, baselinesFor, crawlChoices, defaultCrawl, fullLighthouse, pagesFor, yearOf, type Category, type PageType, type PageView } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

export const WEIGHT: Record<Priority, number> = { P1: 25, P2: 10, P3: 3, P4: 1 };
export const SCORE_HELP = "Each page starts at 100 and loses 25 points per P1 issue, 10 per P2, 3 per P3 and 1 per P4. The site's score is the average of its pages.";
// The score the site is working towards, drawn as a line on the trend and a tick on the score bar
export const TARGET = 85;
// The rule set the latest crawl was checked against. The real backend stores it per crawl; a change is marked on the trend.
export const RULESET = "v3";
// Points one rule costs the score: every page it fails on loses its weight, averaged over the scope's pages
export const ruleCost = (r: { pages: number; priority: Priority }, pages: number) => (r.pages * WEIGHT[r.priority]) / Math.max(1, pages);

// Health bands, shared by every chart that colours a score
export type Band = "good" | "fair" | "poor";
export const BANDS: { id: Band; label: string; range: string; color: string }[] = [
  { id: "good", label: "Good", range: "80–100", color: "green" },
  { id: "fair", label: "Needs work", range: "60–79", color: "orange" },
  { id: "poor", label: "Poor", range: "0–59", color: "red" },
];
export const bandOf = (score: number): Band => (score >= 80 ? "good" : score >= 60 ? "fair" : "poor");
export const bandColor = (score: number) => BANDS.find((b) => b.id === bandOf(score))!.color;

// Categories always in this order and colour (validated for colour-blind separation)
export const CAT_COLOR: Record<Category, string> = { accessibility: "blue.solid", performance: "teal.solid", seo: "purple.solid", security: "pink.solid" };
export const PRI_COLOR = PRIORITY_DOT;
export const PRI_LABEL: Record<Priority, string> = { P1: "Critical", P2: "Serious", P3: "Moderate", P4: "Minor" };

// ───────── Scope: the whole site, one page type, or one part of it (a year, or a folder of "other" pages) ─────────
export type Filter = { type?: PageType; sub?: string };
export const subOf = (p: { path: string; type: PageType }): string | null => {
  const y = yearOf(p.path);
  if (y) return String(y);
  return p.type === "other" ? p.path.split("/")[2] ?? null : null;
};
const inScope = (p: PageView, f: Filter) => (!f.type || p.type === f.type) && (!f.sub || subOf(p) === f.sub);
export const scopeKey = (f: Filter) => [f.type ?? "", f.sub ?? ""].join("/");
export const typeName = (t: PageType) => PAGE_TYPES.find((x) => x.id === t)!.label;
export const subName = (t: PageType, sub: string) => (t === "other" ? `/en/${sub}` : sub);
export const scopeName = (f: Filter) => (!f.type ? "Whole site" : f.sub ? `${typeName(f.type)} · ${subName(f.type, f.sub)}` : typeName(f.type));

// ───────── Links into the rest of the app (latest crawl, so the defaults apply) ─────────
const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const links = (site: SiteId) => ({
  issues: (q: { pri?: Priority; cat?: Category; type?: PageType; markup?: "shared" | "page"; q?: string; vs?: string; seg?: "new" | "fixed" } = {}) => `/${site}/issues${qs(q)}`,
  rule: (id: string, el?: string) => `/${site}/issues/${id}${qs({ el })}`,
  page: (i: number) => `/${site}/pages/${i}`,
  // A year narrows Pages with its year filter; a folder of other pages with a URL search
  pages: (f: Filter, sort?: string, extra: { vs?: string; change?: "new" | "changed" | "removed" } = {}) => {
    const year = f.sub && /^\d{4}$/.test(f.sub) ? f.sub : undefined;
    const q = f.sub && !year ? `/en/${f.sub}/` : undefined;
    return `/${site}/pages${qs({ type: f.type, year, q, sort, ...extra })}`;
  },
});

// ───────── The snapshot: everything the page shows about one scope, in the latest crawl ─────────
export type PriStat = { issues: number; elements: number; pages: number; rules: RuleRow[] };
export type CatStat = { issues: number; elements: number; pages: number; score: number; scoreNoShared: number; scored: number };
export type TemplateFix = { rule: Rule; priority: Priority; pattern: string; pages: number; elements: number; gain: number };
export type Group = { filter: Filter; label: string; pages: number; score: number; p1Pages: number; issues: number };
export type PageScore = { page: PageView; score: number; p1: number; issues: number };

export type Snapshot = {
  crawl: number; date: Date; filter: Filter;
  pages: number; score: number; scoreNoShared: number; p1Pages: number;
  bands: Record<Band, number>; // pages per health band
  worstPages: Record<Priority | "none", number>; // each page counted once, at its worst issue
  issues: number; elements: number;
  priority: Record<Priority, PriStat>;
  category: Record<Category, CatStat>;
  shared: { issues: number; elements: number }; specific: { issues: number; elements: number };
  fixes: TemplateFix[]; // shared markup, biggest score gain first
  groups: Group[]; // the scope's parts: page types at the top, then years or folders
  worst: PageScore[]; // lowest scores first
  rules: RuleRow[];
  broken: { notFound: number; serverError: number };
};

const zeroCat = (): CatStat => ({ issues: 0, elements: 0, pages: 0, score: 0, scoreNoShared: 0, scored: 0 });

const cache = new Map<string, Snapshot>();
export function snapshot(site: SiteId, filter: Filter = {}): Snapshot {
  const crawl = defaultCrawl(site);
  const a = Number(crawl.id);
  const key = `${site}:${a}:${scopeKey(filter)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const all = hitsFor(site, a, null).filter((h) => inScope(h.p, filter));
  // Pages in scope (every one, even with no issue) come from the hits' pages plus none: every page has at least the
  // shared header issue, so the hits cover them all.
  const byPage = new Map<number, Hit[]>();
  for (const h of all) { const l = byPage.get(h.p.i); if (l) l.push(h); else byPage.set(h.p.i, [h]); }

  const priority = Object.fromEntries(PRIORITIES.map((p) => [p, { issues: 0, elements: 0, pages: 0, rules: [] as RuleRow[] }])) as Record<Priority, PriStat>;
  const category = Object.fromEntries(CATEGORIES.map((c) => [c.id, zeroCat()])) as Record<Category, CatStat>;
  const bands: Record<Band, number> = { good: 0, fair: 0, poor: 0 };
  const worstPages: Record<Priority | "none", number> = { P1: 0, P2: 0, P3: 0, P4: 0, none: 0 };
  const shared = { issues: 0, elements: 0 }, specific = { issues: 0, elements: 0 };
  const fixAcc = new Map<string, { rule: string; pattern: string; pages: number; elements: number; gain: number }>();
  const groupAcc = new Map<string, { filter: Filter; pages: number; score: number; p1Pages: number; issues: number }>();
  const scores: PageScore[] = [];
  let scoreSum = 0, noSharedSum = 0, p1Pages = 0, notFound = 0, serverError = 0, elements = 0, issues = 0;

  for (const hs of byPage.values()) {
    const p = hs[0].p;
    if (p.status === 404) notFound++;
    if (p.status >= 500) serverError++;
    // Per rule on this page: its priority, and whether anything is left once shared markup is fixed
    const rules = new Map<string, { pri: Priority; cat: Category; specific: boolean; sharedPatterns: string[] }>();
    for (const h of hs) {
      const r = RULE_CATALOG[h.rule];
      let x = rules.get(h.rule);
      if (!x) { x = { pri: PRIORITY[r.severity], cat: r.category, specific: false, sharedPatterns: [] }; rules.set(h.rule, x); }
      if (h.shared) x.sharedPatterns.push(h.pattern); else x.specific = true;
      elements += h.elements;
      category[r.category].elements += h.elements;
      priority[x.pri].elements += h.elements;
      (h.shared ? shared : specific).elements += h.elements;
      const fk = `${h.rule}|${h.pattern}`;
      if (h.shared) {
        const f = fixAcc.get(fk) ?? { rule: h.rule, pattern: h.pattern, pages: 0, elements: 0, gain: 0 };
        f.pages++; f.elements += h.elements;
        fixAcc.set(fk, f);
      }
    }
    let lost = 0, lostNoShared = 0, p1 = 0;
    const catLost = new Map<Category, [number, number]>();
    for (const [id, x] of rules) {
      const w = WEIGHT[x.pri];
      lost += w;
      const stays = x.specific || x.sharedPatterns.length > 1;
      if (x.specific) lostNoShared += w;
      // Fixing this one shared pattern removes the rule from the page only if nothing else on the page fails it
      if (!stays) { const f = fixAcc.get(`${id}|${x.sharedPatterns[0]}`); if (f) f.gain += w; }
      const cl = catLost.get(x.cat) ?? [0, 0];
      cl[0] += w; if (x.specific) cl[1] += w;
      catLost.set(x.cat, cl);
      priority[x.pri].issues++;
      category[x.cat].issues++;
      issues++;
      (x.specific ? specific : shared).issues++;
      if (x.pri === "P1") p1++;
    }
    const score = Math.max(0, 100 - lost);
    scoreSum += score;
    noSharedSum += Math.max(0, 100 - lostNoShared);
    bands[bandOf(score)]++;
    if (p1) p1Pages++;
    worstPages[PRIORITIES.find((pri) => [...rules.values()].some((x) => x.pri === pri)) ?? "none"]++;
    for (const pri of new Set([...rules.values()].map((x) => x.pri))) priority[pri].pages++;
    for (const c of CATEGORIES) {
      const cs = category[c.id];
      if (c.id === "performance" && p.perf == null) continue; // not audited: no performance score
      const cl = catLost.get(c.id);
      if (cl) cs.pages++;
      cs.scored++;
      cs.score += Math.max(0, 100 - (cl?.[0] ?? 0));
      cs.scoreNoShared += Math.max(0, 100 - (cl?.[1] ?? 0));
    }
    scores.push({ page: p, score, p1, issues: rules.size });

    // The part of the scope this page belongs to
    const gf: Filter = !filter.type ? { type: p.type } : { type: p.type, sub: subOf(p) ?? undefined };
    if (filter.sub || (filter.type && !gf.sub)) continue;
    const gk = scopeKey(gf);
    const g = groupAcc.get(gk) ?? { filter: gf, pages: 0, score: 0, p1Pages: 0, issues: 0 };
    g.pages++; g.score += score; g.issues += rules.size; if (p1) g.p1Pages++;
    groupAcc.set(gk, g);
  }

  const pages = byPage.size || 1;
  for (const c of CATEGORIES) {
    const cs = category[c.id];
    cs.score = cs.scored ? Math.round(cs.score / cs.scored) : 100;
    cs.scoreNoShared = cs.scored ? Math.round(cs.scoreNoShared / cs.scored) : 100;
  }
  const rules = byRule(all, "all");
  for (const p of PRIORITIES) priority[p].rules = rules.filter((r) => r.priority === p).sort((x, y) => y.pages - x.pages);

  const snap: Snapshot = {
    crawl: a, date: crawl.startedAt, filter,
    pages: byPage.size, score: Math.round(scoreSum / pages), scoreNoShared: Math.round(noSharedSum / pages), p1Pages,
    bands, worstPages, issues, elements, priority, category, shared, specific,
    fixes: [...fixAcc.values()].map((f) => {
      const rule = RULE_CATALOG[f.rule];
      return { rule, priority: PRIORITY[rule.severity], pattern: f.pattern, pages: f.pages, elements: f.elements, gain: f.gain / pages };
    }).sort((x, y) => y.gain - x.gain),
    groups: [...groupAcc.values()].map((g) => ({
      filter: g.filter, label: g.filter.sub ? subName(g.filter.type!, g.filter.sub) : typeName(g.filter.type!),
      pages: g.pages, score: Math.round(g.score / g.pages), p1Pages: g.p1Pages, issues: g.issues,
    })).sort((x, y) => (x.filter.sub && y.filter.sub && /^\d/.test(x.filter.sub) ? y.filter.sub.localeCompare(x.filter.sub) : y.pages - x.pages)),
    worst: scores.sort((x, y) => x.score - y.score || y.issues - x.issues).slice(0, 12),
    rules: rules.sort((x, y) => x.priority.localeCompare(y.priority) || y.pages - x.pages),
    broken: { notFound, serverError },
  };
  if (cache.size > 20) cache.clear();
  cache.set(key, snap);
  return snap;
}

// ───────── History: one point per finished crawl, oldest first, ending with the snapshot ─────────
export type Point = {
  crawl: number; date: Date; label: string; daysAgo: number;
  score: number; pages: number;
  P1: number; P2: number; P3: number; P4: number; // issues (rule × page)
  cat: Record<Category, number>; // category scores
  note?: string; // something that changed the numbers without the site changing (rule set, scope) or a release
};

const rand = (i: number, salt: number) => {
  let x = (i + 1) * 2654435761 + salt * 97531;
  x = (x ^ (x >>> 15)) * 2246822519;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};
const noise = (i: number, salt: number, amp: number) => (rand(i, salt) * 2 - 1) * amp;

export function history(site: SiteId, snap: Snapshot): Point[] {
  const crawls = crawlChoices(site).slice().reverse(); // oldest first
  const latest = crawls[crawls.length - 1];
  const pts = crawls.map((c): Point => {
    const id = Number(c.id);
    const d = Math.round((latest.startedAt.getTime() - c.startedAt.getTime()) / 86_400_000);
    const now = d === 0;
    // Before a fix release ~16 days ago there were noticeably more P1s; P3s creep up as new content is published
    const m = {
      P1: now ? 1 : 1 + 0.009 * d + (d > 16 ? 0.14 : 0) + noise(id, 1, 0.025),
      P2: now ? 1 : 1 + 0.003 * d + noise(id, 2, 0.012),
      P3: now ? 1 : 1 - 0.0035 * d + noise(id, 3, 0.01),
      P4: now ? 1 : 1 - 0.001 * d + noise(id, 4, 0.01),
    };
    const counts = Object.fromEntries(PRIORITIES.map((p) => [p, Math.round(snap.priority[p].issues * m[p])])) as Record<Priority, number>;
    const pages = Math.round(snap.pages * (c.pages / latest.pages));
    const lost = PRIORITIES.reduce((t, p) => t + (counts[p] - snap.priority[p].issues) * WEIGHT[p], 0) / Math.max(1, snap.pages);
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
    return {
      crawl: id, date: c.startedAt, daysAgo: d, label: c.startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      score: now ? snap.score : clamp(snap.score - lost), pages, ...counts,
      cat: {
        accessibility: now ? snap.category.accessibility.score : clamp(snap.category.accessibility.score - 0.16 * d - (d > 16 ? 2 : 0) + noise(id, 5, 0.6)),
        performance: now ? snap.category.performance.score : clamp(snap.category.performance.score + 0.12 * d + noise(id, 6, 1.4)),
        seo: now ? snap.category.seo.score : clamp(snap.category.seo.score + 0.03 * d + noise(id, 7, 0.5)),
        security: now ? snap.category.security.score : clamp(snap.category.security.score + noise(id, 8, 0.3)),
      },
    };
  });
  // Modelled events: the fix release behind the P1 drop, and the rule-set update a week before it
  const mark = (days: number, note: string) => { const p = pts.find((x) => x.daysAgo <= days && x.daysAgo > 0); if (p && !p.note) p.note = note; };
  mark(16, "Template fix released");
  mark(24, `Rule set ${RULESET}: 4 new checks`);
  return pts;
}

// ───────── What changed since the previous crawl, per issue (one rule on one page) ─────────
export type Diff = { prev: number | null; added: number; fixed: number; persisting: number; byPriority: Record<Priority, { added: number; fixed: number }> };
export type DiffOpts = { vs?: number | null; pri?: Priority[]; markup?: "shared" | "page" };
export function diff(site: SiteId, filter: Filter = {}, o: DiffOpts = {}): Diff {
  const a = Number(defaultCrawl(site).id);
  const b = o.vs !== undefined ? o.vs : Number(baselinesFor(site, String(a))[0]?.id ?? NaN);
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, { added: 0, fixed: 0 }])) as Diff["byPriority"];
  if (b == null || Number.isNaN(b)) return { prev: null, added: 0, fixed: 0, persisting: 0, byPriority };
  // Per page and rule: is anything still failing, and was any of it there before?
  const acc = new Map<string, { rule: string; now: number; added: number; fixed: number }>();
  for (const h of hitsFor(site, a, b)) {
    if (!inScope(h.p, filter)) continue;
    if (o.markup && h.shared !== (o.markup === "shared")) continue;
    const k = `${h.p.i}|${h.rule}`;
    const x = acc.get(k) ?? { rule: h.rule, now: 0, added: 0, fixed: 0 };
    x.now += h.elements; x.added += h.added; x.fixed += h.fixed;
    acc.set(k, x);
  }
  let added = 0, fixed = 0, persisting = 0;
  for (const x of acc.values()) {
    const pri = PRIORITY[RULE_CATALOG[x.rule].severity];
    if (o.pri && !o.pri.includes(pri)) continue;
    // Same definition as the Issues list's New and Fixed segments: a rule on a page counts once if any element on it is new or was fixed
    if (x.added > 0) { added++; byPriority[pri].added++; }
    if (x.fixed > 0) { fixed++; byPriority[pri].fixed++; }
    if (x.now > 0 && x.added === 0 && x.fixed === 0) persisting++;
  }
  return { prev: b, added, fixed, persisting, byPriority };
}

// Pages added and changed against a baseline crawl, within a scope
export function pageChanges(site: SiteId, filter: Filter = {}, vs?: number | null) {
  const a = Number(defaultCrawl(site).id);
  const b = vs !== undefined ? vs : Number(baselinesFor(site, String(a))[0]?.id ?? NaN);
  if (b == null || Number.isNaN(b)) return { added: 0, changed: 0, removed: 0 };
  let added = 0, changed = 0, removed = 0;
  for (const p of pagesFor(site, a, b)) {
    if (!inScope(p, filter)) continue;
    if (p.change === "new") added++; else if (p.change === "changed") changed++; else if (p.change === "removed") removed++;
  }
  return { added, changed, removed };
}

// Ranges the page can look back over
export type Range = "7" | "30" | "all";
export const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "all", label: "All" },
];
export const inRange = (pts: Point[], r: Range) => (r === "all" ? pts : pts.filter((p) => p.daysAgo <= Number(r)));

// Least-squares slope per day of one series, and what it means for the latest value
export function forecast(pts: Point[], pick: (p: Point) => number) {
  if (pts.length < 3) return null;
  const xs = pts.map((p) => -p.daysAgo), ys = pts.map(pick);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((t, x, k) => t + (x - mx) * (ys[k] - my), 0), den = xs.reduce((t, x) => t + (x - mx) ** 2, 0);
  const perDay = den ? num / den : 0;
  const last = ys[ys.length - 1];
  return { perDay, perWeek: perDay * 7, daysToZero: perDay < 0 ? last / -perDay : null };
}

export const fmtInt = (x: number) => Math.round(x).toLocaleString("en-US");
export const pct = (x: number, of: number) => (of ? Math.round((x / of) * 100) : 0);

// ───────── Core Web Vitals, from the Lighthouse audits in the latest crawl ─────────
// PROTOTYPE DATA: the app stores a count of Lighthouse issues per page, not the measured values, so each audited
// page gets stable modelled values here. The real backend would store LCP, CLS and TBT from each audit.
// Lighthouse is a lab test: it measures LCP, CLS and Total Blocking Time. INP needs real users, so TBT stands in for it.
// Thresholds are Google's "good" and "poor" limits (Lighthouse uses the same for TBT).
export type VitalId = "lcp" | "cls" | "tbt";
export const VITALS: { id: VitalId; name: string; full: string; unit: string; good: number; poor: number; fmt: (v: number) => string; help: string }[] = [
  { id: "lcp", name: "LCP", full: "Largest Contentful Paint", unit: "s", good: 2.5, poor: 4, fmt: (v) => `${v.toFixed(1)} s`, help: "How long until the main content is visible. Good is 2.5 s or less, poor is over 4 s." },
  { id: "cls", name: "CLS", full: "Cumulative Layout Shift", unit: "", good: 0.1, poor: 0.25, fmt: (v) => v.toFixed(2), help: "How much the page jumps around while loading. Good is 0.1 or less, poor is over 0.25." },
  { id: "tbt", name: "TBT", full: "Total Blocking Time", unit: "ms", good: 200, poor: 600, fmt: (v) => `${Math.round(v)} ms`, help: "How long scripts freeze the page after it appears. Lighthouse measures this in the lab instead of INP (which needs real visitors). Good is 200 ms or less, poor is over 600 ms." },
];
// Heavier page types load slower (charts, media)
const HEAVY: Partial<Record<PageType, number>> = { research: 1.15, video: 1.35, podcast: 1.2, event: 1.1, people: 0.9 };
const vitalValue = (id: VitalId, p: { i: number; type: PageType }) => {
  const r = rand(p.i, { lcp: 31, cls: 32, tbt: 33 }[id]);
  const k = HEAVY[p.type] ?? 1;
  return id === "lcp" ? (0.9 + 4.2 * r ** 1.8) * k : id === "cls" ? 0.4 * r ** 2.5 * Math.min(k, 1.2) : 900 * r ** 2.2 * k;
};

export type VitalStat = { id: VitalId; p75: number; good: number; ni: number; poor: number; rating: "good" | "ni" | "poor" };
export type Vitals = { audited: number; pages: number; full: boolean; stats: VitalStat[] };
const vitalsCache = new Map<string, Vitals>();
export function vitals(site: SiteId, filter: Filter = {}): Vitals {
  const crawl = defaultCrawl(site);
  const a = Number(crawl.id);
  const key = `${site}:${a}:${scopeKey(filter)}`;
  const hit = vitalsCache.get(key);
  if (hit) return hit;
  const all = pagesFor(site, a, null).filter((p) => inScope(p, filter));
  const audited = all.filter((p) => p.perf != null);
  const stats = VITALS.map((v): VitalStat => {
    const vals = audited.map((p) => vitalValue(v.id, p)).sort((x, y) => x - y);
    let good = 0, poor = 0;
    for (const x of vals) { if (x <= v.good) good++; else if (x > v.poor) poor++; }
    const p75 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.75))] : 0; // Google judges the 75th percentile
    return { id: v.id, p75, good, ni: vals.length - good - poor, poor, rating: p75 <= v.good ? "good" : p75 > v.poor ? "poor" : "ni" };
  });
  const out = { audited: audited.length, pages: all.length, full: fullLighthouse(a), stats };
  if (vitalsCache.size > 20) vitalsCache.clear();
  vitalsCache.set(key, out);
  return out;
}

// ───────── Pages to fix first: ranked by how many critical (P1) issues they have, then serious (P2), then the rest ─────────
// No score involved: just counts of rules failing on the page, by priority, and the names of the most serious ones.
export type AttentionRow = { page: PageView; counts: Record<Priority, number>; total: number; top: string[] };
export function attention(site: SiteId, filter: Filter = {}, pris?: Priority[], limit = 8): AttentionRow[] {
  const a = Number(defaultCrawl(site).id);
  const byPage = new Map<number, { page: PageView; rules: Map<string, Priority> }>();
  for (const h of hitsFor(site, a, null)) {
    if (!inScope(h.p, filter)) continue;
    let e = byPage.get(h.p.i);
    if (!e) { e = { page: h.p, rules: new Map() }; byPage.set(h.p.i, e); }
    e.rules.set(h.rule, PRIORITY[RULE_CATALOG[h.rule].severity]);
  }
  const rows: AttentionRow[] = [];
  for (const { page, rules } of byPage.values()) {
    const counts = { P1: 0, P2: 0, P3: 0, P4: 0 } as Record<Priority, number>;
    const list = [...rules.entries()].filter(([, pri]) => !pris || pris.includes(pri));
    for (const [, pri] of list) counts[pri]++;
    if (!list.length) continue;
    const worst = PRIORITIES.find((p) => counts[p] > 0)!;
    rows.push({ page, counts, total: list.length, top: list.filter(([, pri]) => pri === worst).map(([r]) => RULE_CATALOG[r].title).slice(0, 2) });
  }
  return rows.sort((x, y) => y.counts.P1 - x.counts.P1 || y.counts.P2 - x.counts.P2 || y.total - x.total || x.page.i - y.page.i).slice(0, limit);
}
