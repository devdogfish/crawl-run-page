// PROTOTYPE DATA for /[site]/issues: every issue of one crawl, grouped by rule and by element pattern.
//
// The Pages page answers "what's wrong with this page". This answers "which rules fail most, on which elements":
// each rule's elements are grouped by selector pattern (footer .legal a, article figure.chart img), and a pattern
// whose markup repeats unchanged across pages is marked shared, so one fix covers all of them.
// Both are computed from the HTML; nothing guesses who owns the markup or which CMS field it came from.
// Built from the same per-page elements as the page detail (issueSlots), so counts and ?issue= links line up.
// Real backend: GROUP BY rule, selector pattern over the element table for one crawl (and its baseline).
import { RULE_CATALOG, issueSlots, type Rule } from "@/lib/page-issues";
import { pagesFor, siteSize, type PageView } from "@/lib/site-pages";
import { PRIORITY, type Priority } from "@/lib/priority";
import { SITES, type SiteId } from "@/lib/sites";

// One rule on one page, for one element pattern: its current elements, how many are new, how many were fixed
export type Hit = { p: PageView; rule: string; pattern: string; shared: boolean; elements: number; added: number; fixed: number; k: number };

const cache = new Map<string, Hit[]>();
export function hitsFor(site: SiteId, a: number, b: number | null): Hit[] {
  const key = `${site}:${a}:${b}`;
  let hits = cache.get(key);
  if (hits) return hits;
  hits = [];
  const n = siteSize(site);
  for (const p of pagesFor(site, a, b)) {
    if (p.change === "removed") continue; // not in this crawl
    const by = new Map<string, Hit>();
    for (const it of issueSlots(p, a, b, n)) {
      const id = `${it.rule}|${it.group}`;
      let h = by.get(id);
      if (!h) { h = { p, rule: it.rule, pattern: it.group, shared: it.shared != null, elements: 0, added: 0, fixed: 0, k: it.k }; by.set(id, h); }
      if (it.status === "fixed") h.fixed++;
      else { h.elements++; if (it.status === "new") h.added++; }
    }
    hits.push(...by.values());
  }
  if (cache.size > 6) cache.clear();
  cache.set(key, hits);
  return hits;
}

// Which part of a hit a segment counts: everything there now, only what's new, or only what was fixed
export type Seg = "all" | "new" | "fixed";
export const countOf = (h: Hit, seg: Seg) => (seg === "all" ? h.elements : seg === "new" ? h.added : h.fixed);

export type PatternCount = { pattern: string; shared: boolean; pages: number; elements: number };
export type RuleRow = {
  rule: Rule; priority: Priority;
  pages: number; elements: number; // in the chosen segment
  added: number; fixed: number; // pages with new / fixed elements (for the change column)
  sharedPages: number; // pages where it fails in markup shared across pages
  patterns: PatternCount[]; // most pages first
};

export function byRule(hits: Hit[], seg: Seg): RuleRow[] {
  type Acc = { pages: Set<number>; shared: Set<number>; elements: number; added: Set<number>; fixed: Set<number>; pat: Map<string, PatternCount> };
  const rows = new Map<string, Acc>();
  for (const h of hits) {
    let r = rows.get(h.rule);
    if (!r) { r = { pages: new Set(), shared: new Set(), elements: 0, added: new Set(), fixed: new Set(), pat: new Map() }; rows.set(h.rule, r); }
    if (h.added) r.added.add(h.p.i);
    if (h.fixed) r.fixed.add(h.p.i);
    const n = countOf(h, seg);
    if (!n) continue;
    r.pages.add(h.p.i); r.elements += n;
    if (h.shared) r.shared.add(h.p.i);
    const x = r.pat.get(h.pattern) ?? { pattern: h.pattern, shared: h.shared, pages: 0, elements: 0 };
    x.pages++; x.elements += n; // one hit per page and pattern
    r.pat.set(h.pattern, x);
  }
  return [...rows.entries()].filter(([, r]) => r.pages.size > 0).map(([id, r]) => {
    const rule = RULE_CATALOG[id];
    return {
      rule, priority: PRIORITY[rule.severity], pages: r.pages.size, elements: r.elements, added: r.added.size, fixed: r.fixed.size,
      sharedPages: r.shared.size, patterns: [...r.pat.values()].sort((x, y) => y.pages - x.pages),
    };
  });
}

// One prompt for a whole filtered list: per rule, the element patterns and how to fix them
export function rulesPrompt(site: SiteId, crawl: number, rows: RuleRow[]) {
  return [
    `Fix these ${rows.length} issues found on ${SITES[site].url.replace(/^https?:\/\//, "")} in crawl #${crawl}.`, "",
    ...rows.flatMap((r) => [
      `## ${r.priority} ${r.rule.title} (${r.rule.id}${r.rule.criterion ? `, WCAG ${r.rule.criterion.split(" ")[0]}` : ""}): ${r.pages.toLocaleString("en-US")} pages`,
      `How to fix: ${r.rule.howToFix}`,
      ...r.patterns.map((x) => `- ${x.pattern}: ${x.pages.toLocaleString("en-US")} pages, ${x.elements.toLocaleString("en-US")} elements${x.shared ? " (same markup on every one of these pages)" : ""}`), "",
    ]),
  ].join("\n");
}
