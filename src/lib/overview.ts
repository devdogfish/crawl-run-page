// PROTOTYPE DATA for /[site]/overview: the executive view. Four questions, nothing else:
//   1. Are we getting better or worse?        → trend (health score, P1 and P2 issues, new vs fixed)
//   2. What should be fixed next?             → pages ranked by urgency, and shared-markup fixes ranked the same way
//   3. What did the last release / day change? → new and changed pages in a window, ranked by urgency
//   4. How do we do per category?             → the four category scores with their trend
//
// Always the latest *finished* crawl: a running or failed crawl never moves these numbers (see analytics.ts).
//
// Urgency balances how bad a page is with how many people see it:
//   urgency = badness × √views
//   badness = Σ over the rules failing on the page: P1 10, P2 4, P3 1, P4 0.25 (per rule, not per element)
//   views   = page views over the last 30 days
// √views favours busy pages without letting the homepage win forever: a quiet page full of P1s can still top the list.
// Page urgency counts page-specific issues only; markup shared across pages (header, footer, banners) is one fix in
// the template, so it's ranked separately as a fix, scored as the urgency it removes summed over every page it's on.
//
// Views: the real backend joins web analytics per URL. Here they're modelled: nav pages get the most, then recent
// research and articles; anything older decays fast (a 2021 article that gets edited still ranks low).
// Pages too new to have 30 days of views borrow an estimate (the median of their type's pages from this year) and are
// marked "est." in the UI.
import traffic from "@/data/traffic.json";
import { RULE_CATALOG } from "@/lib/page-issues";
import { PRIORITY, type Priority } from "@/lib/priority";
import { hitsFor } from "@/lib/site-issues";
import { baselinesFor, crawlChoices, defaultCrawl, pagesFor, typeLabel, yearOf, type Change, type PageType, type PageView } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

export const URGENCY_WEIGHT: Record<Priority, number> = { P1: 10, P2: 4, P3: 1, P4: 0.25 };
export const URGENCY_HELP = "Urgency = badness × √views. Each failing rule adds 10 for P1, 4 for P2, 1 for P3, or 0.25 for P4. Views represent simulated traffic over 30 days.";

// ───────── Views (30 days) ─────────
const BASE: Record<PageType, number> = { other: 300, research: 2600, article: 1800, news: 1200, podcast: 700, video: 600, event: 400, people: 250 };
function modelledViews(p: PageView) {
  return (traffic.sites[p.site] as Record<string, number>)[p.i] ?? 0;
}

// Too new for 30 days of data: born within the last 30 days of the crawl
const isFresh = (p: PageView, crawl: number) => {
  const history = crawlChoices(p.site);
  const current = history.find((c) => Number(c.id) === crawl)?.startedAt;
  const first = history.find((c) => Number(c.id) === p.born)?.startedAt;
  return !!current && !!first && current.getTime() - first.getTime() < 30 * 86_400_000;
};

// ───────── Ranked pages and fixes ─────────
export type RankedPage = {
  page: PageView; views: number; estimated: boolean;
  badness: number; urgency: number;
  rules: { id: string; priority: Priority }[]; // page-specific rules failing, worst first
  top: Priority | null;
};
export type RankedFix = { rule: string; title: string; priority: Priority; pattern: string; pages: number; views: number; urgency: number };

type Model = { crawl: number; date: Date; pages: Map<number, RankedPage>; ranked: RankedPage[]; fixes: RankedFix[]; total: number };
const cache = new Map<string, Model>();

export function model(site: SiteId): Model {
  const c = defaultCrawl(site);
  const a = Number(c.id);
  const key = `${site}:${a}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const all = pagesFor(site, a, null);
  // Estimate for fresh pages: median views of this year's pages of the same type
  const pool = new Map<PageType, number[]>();
  for (const p of all) if (yearOf(p.path) === 2026 && !isFresh(p, a)) { const l = pool.get(p.type) ?? []; l.push(modelledViews(p)); pool.set(p.type, l); }
  const median = (t: PageType) => { const l = (pool.get(t) ?? [BASE[t]]).slice().sort((x, y) => x - y); return l[Math.floor(l.length / 2)]; };

  const pages = new Map<number, RankedPage>();
  for (const p of all) {
    const fresh = isFresh(p, a);
    pages.set(p.i, { page: p, views: fresh ? median(p.type) : modelledViews(p), estimated: fresh, badness: 0, urgency: 0, rules: [], top: null });
  }

  const fixAcc = new Map<string, RankedFix>();
  const seen = new Set<string>();
  for (const h of hitsFor(site, a, null)) {
    const r = pages.get(h.p.i);
    if (!r || h.elements === 0) continue;
    const pri = PRIORITY[RULE_CATALOG[h.rule].severity];
    if (h.shared) {
      const k = `${h.rule}|${h.pattern}`;
      const f = fixAcc.get(k) ?? { rule: h.rule, title: RULE_CATALOG[h.rule].title, priority: pri, pattern: h.pattern, pages: 0, views: 0, urgency: 0 };
      f.pages++; f.views += r.views; f.urgency += URGENCY_WEIGHT[pri] * Math.sqrt(r.views);
      fixAcc.set(k, f);
      continue;
    }
    const k = `${h.p.i}|${h.rule}`;
    if (seen.has(k)) continue; // one rule counts once per page, however many elements or patterns
    seen.add(k);
    r.badness += URGENCY_WEIGHT[pri];
    r.rules.push({ id: h.rule, priority: pri });
  }
  for (const r of pages.values()) {
    r.urgency = r.badness * Math.sqrt(r.views);
    r.rules.sort((x, y) => x.priority.localeCompare(y.priority));
    r.top = r.rules[0]?.priority ?? null;
  }

  const m: Model = {
    crawl: a, date: c.startedAt, pages,
    ranked: [...pages.values()].filter((r) => r.urgency > 0).sort((x, y) => y.urgency - x.urgency),
    fixes: [...fixAcc.values()].sort((x, y) => y.urgency - x.urgency),
    total: all.length,
  };
  if (cache.size > 6) cache.clear();
  cache.set(key, m);
  return m;
}

// ───────── What changed in a window ─────────
export type Window = "1" | "7" | "30";
export const WINDOWS: { value: Window; label: string; long: string }[] = [
  { value: "1", label: "Previous crawl", long: "since the previous crawl" },
  { value: "7", label: "7 days", long: "in the last 7 days" },
  { value: "30", label: "30 days", long: "in the last 30 days" },
];

export type ChangedPage = RankedPage & { change: Exclude<Change, "same" | "removed">; added: number; addedTop: Priority | null };
export type Changes = { since: Date | null; newPages: number; changedPages: number; removed: number; newP1P2: number; rows: ChangedPage[] };

// Compare the previous crawl or the most recent crawl at the selected window boundary.
export function changes(site: SiteId, w: Window): Changes {
  const m = model(site);
  const DAY = 86_400_000;
  const base = w === "1" ? baselinesFor(site, String(m.crawl))[0]
    : crawlChoices(site).find((c) => m.date.getTime() - c.startedAt.getTime() >= Number(w) * DAY - DAY / 2);
  if (!base) return { since: null, newPages: 0, changedPages: 0, removed: 0, newP1P2: 0, rows: [] };
  const b = Number(base.id);

  // New issues per page against the baseline (page-specific rules only, like urgency)
  const added = new Map<number, Priority | null>();
  const addedN = new Map<number, number>();
  for (const h of hitsFor(site, m.crawl, b)) {
    if (h.shared || h.added === 0) continue;
    const pri = PRIORITY[RULE_CATALOG[h.rule].severity];
    addedN.set(h.p.i, (addedN.get(h.p.i) ?? 0) + h.added);
    const cur = added.get(h.p.i);
    if (cur == null || pri < cur) added.set(h.p.i, pri);
  }

  let newPages = 0, changedPages = 0, removed = 0, newP1P2 = 0;
  const rows: ChangedPage[] = [];
  for (const p of pagesFor(site, m.crawl, b)) {
    if (p.change === "removed") { removed++; continue; }
    if (p.change !== "new" && p.change !== "changed") continue;
    if (p.change === "new") newPages++; else changedPages++;
    const r = m.pages.get(p.i);
    if (!r) continue;
    const top = added.get(p.i) ?? null;
    if (top === "P1" || top === "P2") newP1P2++;
    rows.push({ ...r, change: p.change, added: addedN.get(p.i) ?? 0, addedTop: top });
  }
  rows.sort((x, y) => y.urgency - x.urgency || y.views - x.views);
  return { since: base.startedAt, newPages, changedPages, removed, newP1P2, rows };
}

export { typeLabel };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const fmtViews = (v: number) => compact.format(v);
export const fmtUrgency = (u: number) => compact.format(Math.round(u));
