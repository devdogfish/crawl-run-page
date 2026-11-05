// PROTOTYPE DATA for /[site]/issues: every issue of one crawl, grouped by rule and by where it's fixed.
//
// The Pages page answers "what's wrong with this page". This answers "what do we fix, and where":
// one rule failing on 30,000 pages is usually one shared file, so the unit of work is rule × source, not page.
// Built from the same per-page elements as the page detail (issueSlots), so counts and ?issue= links line up.
// Real backend: GROUP BY rule, source over the element table for one crawl (and its baseline), see docs/backend-and-mcp.md.
import { RULE_CATALOG, issueSlots, sourceOf, type Instance, type Owner, type Rule } from "@/lib/page-issues";
import { pagesFor, siteSize, type PageView } from "@/lib/site-pages";
import { PRIORITY, type Priority } from "@/lib/priority";
import type { SiteId } from "@/lib/sites";

// Where an element gets fixed. Template and code are one file each; content is one field type,
// spread over one content record per page.
export type FixSource = { key: string; owner: Owner; label: string; href: string | null };
export function fixSource(it: Instance, p: PageView): FixSource {
  const s = sourceOf(it, p);
  if (s.owner !== "content") return { key: s.label, owner: s.owner, label: s.label, href: s.href };
  const field = s.label.split(" · ")[1];
  return { key: `content:${field}`, owner: "content", label: `${field} field`, href: null };
}

// One rule on one page from one source: its current elements, how many are new, how many were fixed
export type Hit = { p: PageView; rule: string; src: FixSource; elements: number; added: number; fixed: number; k: number };

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
      const src = fixSource(it, p);
      const id = `${it.rule}|${src.key}`;
      let h = by.get(id);
      if (!h) { h = { p, rule: it.rule, src, elements: 0, added: 0, fixed: 0, k: it.k }; by.set(id, h); }
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

export type SourceCount = { src: FixSource; pages: number; elements: number };
export type RuleRow = {
  rule: Rule; priority: Priority;
  pages: number; elements: number; // in the chosen segment
  added: number; fixed: number; // pages with new / fixed elements (for the Change column)
  sources: SourceCount[]; // most pages first
};

export function byRule(hits: Hit[], seg: Seg): RuleRow[] {
  const rows = new Map<string, { pages: Set<number>; elements: number; added: Set<number>; fixed: Set<number>; src: Map<string, SourceCount & { set: Set<number> }> }>();
  for (const h of hits) {
    let r = rows.get(h.rule);
    if (!r) { r = { pages: new Set(), elements: 0, added: new Set(), fixed: new Set(), src: new Map() }; rows.set(h.rule, r); }
    if (h.added) r.added.add(h.p.i);
    if (h.fixed) r.fixed.add(h.p.i);
    const n = countOf(h, seg);
    if (!n) continue;
    r.pages.add(h.p.i); r.elements += n;
    let s = r.src.get(h.src.key);
    if (!s) { s = { src: h.src, pages: 0, elements: 0, set: new Set() }; r.src.set(h.src.key, s); }
    if (!s.set.has(h.p.i)) { s.set.add(h.p.i); s.pages++; }
    s.elements += n;
  }
  return [...rows.entries()].filter(([, r]) => r.pages.size > 0).map(([id, r]) => {
    const rule = RULE_CATALOG[id];
    return {
      rule, priority: PRIORITY[rule.severity], pages: r.pages.size, elements: r.elements, added: r.added.size, fixed: r.fixed.size,
      sources: [...r.src.values()].map(({ src, pages, elements }) => ({ src, pages, elements })).sort((x, y) => y.pages - x.pages),
    };
  });
}

// Every source with how many issues (rule on a page) it accounts for: the Source filter's options
export function sourcesIn(hits: Hit[]) {
  const m = new Map<string, { src: FixSource; n: number }>();
  for (const h of hits) { const s = m.get(h.src.key) ?? { src: h.src, n: 0 }; s.n++; m.set(h.src.key, s); }
  return [...m.values()].sort((x, y) => y.n - x.n);
}

// One prompt for a whole filtered list: per rule, where to fix it and how
export function rulesPrompt(site: SiteId, crawl: number, rows: RuleRow[]) {
  return [
    `Fix these ${rows.length} issues found on ${site === "rbccm" ? "www.rbccm.com" : "www.rbcits.com"} in crawl #${crawl}. Fix each in its source, not per page. Return a patch per file.`, "",
    ...rows.flatMap((r) => [
      `## ${r.priority} ${r.rule.title} (${r.rule.id}${r.rule.criterion ? `, WCAG ${r.rule.criterion.split(" ")[0]}` : ""}): ${r.pages.toLocaleString("en-US")} pages`,
      `How to fix: ${r.rule.howToFix}`,
      ...r.sources.map((s) => `- ${s.src.owner === "content" ? `CMS ${s.src.label}` : s.src.label}: ${s.pages.toLocaleString("en-US")} pages, ${s.elements.toLocaleString("en-US")} elements`), "",
    ]),
  ].join("\n");
}
