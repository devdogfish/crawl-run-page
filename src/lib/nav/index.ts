// Lazily built lookups the search needs: crawled hosts, a site's pages by path, and the rule phrasebook.
import { CRAWLS } from "@/lib/crawls-list";
import { RULE_CATALOG } from "@/lib/page-issues";
import { defaultCrawl, pagesFor } from "@/lib/site-pages";
import { SITES, SITE_IDS, type SiteId } from "@/lib/sites";

// Hosts of the crawled sites (without www.). rbcits.com is the legacy host of RBC IS.
export const HOSTS: Record<string, SiteId> = {
  "rbccm.com": "rbccm", "sterbccm.com": "rbccm-qa",
  "rbcis.com": "rbcits", "rbcits.com": "rbcits", "sterbcis.com": "rbcits-qa", "sterbcits.com": "rbcits-qa",
};
export const siteOfHost = (host: string): SiteId | null => HOSTS[host.toLowerCase().replace(/^www\./, "")] ?? null;

// Site family: production and its QA copy
export const baseOf = (s: SiteId): "rbccm" | "rbcits" => (s.startsWith("rbccm") ? "rbccm" : "rbcits");
export const siteOf = (base: "rbccm" | "rbcits", qa: boolean): SiteId => (qa ? (`${base}-qa` as SiteId) : base);
export const asSite = (s: string | undefined): SiteId => (SITE_IDS as string[]).includes(s ?? "") ? (s as SiteId) : "rbccm";
export const siteShort = (s: SiteId) => SITES[s].short;

export const crawlOwner = (id: string): SiteId | null => CRAWLS.find((c) => c.id === id)?.site ?? null;

export type PageRef = { i: number; path: string; title: string; hay: string };
type PageIndex = { byPath: Map<string, PageRef>; all: PageRef[] };
const pageIdx = new Map<SiteId, PageIndex>();
export function pageIndex(site: SiteId): PageIndex {
  let ix = pageIdx.get(site);
  if (!ix) {
    const all = pagesFor(site, Number(defaultCrawl(site).id), null).map((p) => ({ i: p.i, path: p.path, title: p.title, hay: (p.path + " " + p.title).toLowerCase() }));
    const byPath = new Map<string, PageRef>();
    for (const p of all) if (!byPath.has(p.path)) byPath.set(p.path, p);
    ix = { byPath, all };
    pageIdx.set(site, ix);
  }
  return ix;
}

// ───────── Rule phrasebook: title, id and the ways people name the rule ─────────
const SYNONYMS: Record<string, string[]> = {
  "broken-link-external": ["404", "404s", "broken link", "broken links", "dead link", "dead links", "external 404s", "external broken links", "external links broken", "link rot", "not found links"],
  "image-alt": ["alt text", "alt", "missing alt", "images without alt", "image alternative"],
  "color-contrast": ["contrast", "low contrast", "colour contrast"],
  "button-name": ["buttons without names", "button without name", "unnamed buttons", "unlabelled buttons"],
  "link-name": ["links without names", "empty links", "unnamed links"],
  label: ["form labels", "missing labels", "inputs without labels", "unlabelled fields"],
  noopener: ["tabnabbing", "target blank"],
  canonical: ["canonical url", "canonicals", "tracking parameters"],
  "meta-description": ["meta description", "missing description"],
  "heading-order": ["headings", "skipped headings", "heading levels"],
  "render-blocking-resources": ["render blocking", "blocking scripts"],
  "modern-image-formats": ["webp", "avif", "image formats", "next gen images"],
  "unused-javascript": ["unused js", "unused javascript"],
  "mixed-content": ["http images", "insecure images"],
  region: ["landmarks"],
  hreflang: ["french version", "language alternates"],
};

const RULE_STOP = new Set(["a", "an", "the", "of", "in", "on", "at", "for", "from", "with", "to", "me", "my", "show", "open", "go", "all", "any", "that", "are", "is", "and", "it", "its", "has", "have", "this", "isn", "t", "s", "over", "please", "find"]);
export const norm = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
export const words = (s: string) => (s.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? []);
export const contentWords = (s: string) => words(s).filter((w) => !RULE_STOP.has(w)).map(norm);

type Phrase = { rule: string; tokens: string[] };
let phrases: Phrase[] | null = null;
export function rulePhrases(): Phrase[] {
  if (!phrases) {
    phrases = [];
    for (const r of Object.values(RULE_CATALOG)) {
      for (const text of [r.title, r.id.replace(/-/g, " "), ...(SYNONYMS[r.id] ?? [])]) phrases.push({ rule: r.id, tokens: [...new Set(contentWords(text))] });
    }
  }
  return phrases;
}

export function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// How well query token q names rule word w: 1 same, .9 prefix (typing), .8 one typo
export function tokenScore(q: string, w: string): number {
  if (q === w) return 1;
  if (q.length >= 3 && w.startsWith(q)) return 0.9;
  if (q.length >= 5 && lev(q, w) <= 1) return 0.8;
  return 0;
}

// Rules whose title, id or synonyms the tokens (already contentWords) describe, best first
export function matchRules(tokens: string[]): { id: string; score: number }[] {
  if (!tokens.length) return [];
  const best = new Map<string, number>();
  for (const ph of rulePhrases()) {
    let sum = 0; const hit = new Set<string>();
    for (const q of tokens) {
      let m = 0, mw = "";
      for (const w of ph.tokens) { const s = tokenScore(q, w); if (s > m) { m = s; mw = w; } }
      sum += m; if (m) hit.add(mw);
    }
    const qcov = sum / tokens.length;
    if (qcov < 0.6) continue;
    const score = 0.97 * qcov * (0.78 + 0.22 * (hit.size / ph.tokens.length));
    if (score > (best.get(ph.rule) ?? 0)) best.set(ph.rule, score);
  }
  return [...best].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
