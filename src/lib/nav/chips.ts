// The filter words of the Cmd+K palette (suggested as pills under the input) and the @references that resolve to a
// thing the app has. Pure: no React.
//
//   refChip("@rule:image-alt", ctx) → { text: "@rule:image-alt", label: "Image has no text alternative", mark, value: "image-alt" }
//
// A reference only resolves when the thing exists (an issue id, a page, a crawl, a rule): that is what makes
// "@issue:220003" typed in full, or pasted, a chip. Filter words (P1, accessibility, 2024, new …) are never chips:
// they are suggested as pills and completed as plain text.
import { loadRules } from "@/lib/custom-rules";
import { crawlsFor } from "@/lib/crawls-list";
import { RULE_CATALOG } from "@/lib/page-issues";
import { resolveIssue } from "@/lib/refs";
import { asSite, crawlOwner, pageIndex } from "./index";
import { CRAWL_DOT, ruleMark, type Mark, type SearchContext } from "./search";

export type TokenMode = "search" | "chat";
export type RefMatch = { text: string; label: string; value: string; mark?: Mark };

// ───────── What the facets are (shared with suggest.ts) ─────────
export type Facet = { value: string; text: string; label: string; hint?: string; aliases: string[]; kind: "filter" | "section" };
const f = (value: string, text: string, label: string, aliases: string[] = [], hint?: string, kind: Facet["kind"] = "filter"): Facet =>
  ({ value, text, label, aliases, hint, kind });

export const FACETS: Facet[] = [
  f("P1", "P1", "P1", ["critical", "blocker"], "Critical"),
  f("P2", "P2", "P2", ["serious"], "Serious"),
  f("P3", "P3", "P3", ["moderate"], "Moderate"),
  f("P4", "P4", "P4", ["minor"], "Minor"),
  f("accessibility", "accessibility", "Accessibility", ["a11y"]),
  f("performance", "performance", "Performance", ["perf", "speed"]),
  f("seo", "seo", "SEO"),
  f("security", "security", "Security", ["compliance"]),
  f("article", "articles", "Articles", ["insights", "blog"]),
  f("research", "research", "Research"),
  f("news", "news", "News"),
  f("podcast", "podcasts", "Podcasts"),
  f("video", "videos", "Videos"),
  f("event", "events", "Events"),
  f("people", "people", "People", ["bios", "profiles"]),
  ...Array.from({ length: 11 }, (_, k) => String(2026 - k)).map((y) => f(y, y, y)),
  f("new", "new", "New", ["added"]),
  f("fixed", "fixed", "Fixed", ["resolved"]),
  f("changed", "changed", "Changed", ["modified", "updated", "edited"]),
  f("removed", "removed", "Removed", ["deleted", "gone"]),
  f("shared", "shared markup", "Shared markup", ["shared", "template"]),
  f("page", "page-specific", "Page-specific"),
  f("worst", "worst", "Worst"),
  f("crawls", "crawls", "Crawls", [], undefined, "section"),
  f("pages", "pages", "Pages", [], undefined, "section"),
  f("issues", "issues", "Issues", [], undefined, "section"),
  f("analytics", "analytics", "Analytics", ["overview", "dashboard", "home"], undefined, "section"),
  f("settings", "settings", "Settings", [], undefined, "section"),
];

// ───────── One word → a reference ─────────
const REF = /^@(issue|rule|page|crawl):([\w-]+)$/i;

export function refChip(word: string, ctx: SearchContext): RefMatch | null {
  const m = REF.exec(word);
  if (!m) return null;
  const kind = m[1].toLowerCase(), id = m[2];
  const base = { text: `@${kind}:${id}`, value: id };
  if (kind === "issue") {
    const r = /^\d+$/.test(id) ? resolveIssue(id) : null;
    return r ? { ...base, label: r.rule.title, mark: ruleMark(r.rule) } : null;
  }
  if (kind === "rule") {
    const custom = loadRules(ctx.site).find((r) => r.id === id);
    if (custom) return { ...base, label: custom.name };
    const r = RULE_CATALOG[id.toLowerCase()];
    return r ? { text: `@rule:${r.id}`, value: r.id, label: r.title, mark: ruleMark(r) } : null;
  }
  if (kind === "page") {
    const p = /^\d+$/.test(id) ? pageIndex(asSite(ctx.site)).all.find((x) => x.i === Number(id)) : undefined;
    return p ? { ...base, label: p.title } : null;
  }
  const owner = crawlOwner(id);
  if (!owner) return null;
  const c = crawlsFor(owner).find((x) => x.id === id);
  return { ...base, label: `#${id}`, mark: c ? { dot: CRAWL_DOT[c.status] } : undefined };
}
