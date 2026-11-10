// PROTOTYPE DATA for the page detail view: the rule catalog, each page's issue instances, and the page's HTML.
//
// Every issue has the same shape whatever produced it (axe-core, Lighthouse, a custom check):
//   rule (catalog entry: title, why, how to fix, references) + instance (selector, HTML snippet, element box).
// "Shared" instances come from markup that repeats across pages (header, footer); in the real backend that's
// a hash of selector + snippet seen on many pages. Fix those once, in the template.
//
// The preview uses saved HTML from the public page capture. Legacy records have no saved document.
import type { Category, PageView } from "@/lib/site-pages";
import { PRIORITY, type Priority } from "@/lib/priority";

import { crawlFixture, crawlFixturesFor } from "@/lib/crawls-list";
import { getStoredDocument, getStoredSnapshot } from "@/lib/stored-html";
import type { SiteId } from "@/lib/sites";
import captured from "@/data/captured-findings.json";
import legacy from "@/data/legacy-audit-findings.json";
import samplePages from "@/data/sample-pages.json";

export type Severity = "critical" | "serious" | "moderate" | "minor";
export const SEVERITIES: { id: Severity; label: string; color: string }[] = [
  { id: "critical", label: "Critical", color: "red" },
  { id: "serious", label: "Serious", color: "orange" },
  { id: "moderate", label: "Moderate", color: "yellow" },
  { id: "minor", label: "Minor", color: "gray" },
];
export const sevRank = (s: Severity) => SEVERITIES.findIndex((x) => x.id === s);

export type Rule = {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  source: "axe-core" | "Lighthouse" | "Custom check";
  criterion?: string; // WCAG success criterion
  why: string;
  howToFix: string;
  refs: { label: string; url: string }[];
};

const deque = (id: string) => ({ label: "Deque University: " + id, url: `https://dequeuniversity.com/rules/axe/4.10/${id}` });
const wcag = (sc: string, slug: string) => ({ label: `WCAG ${sc} Understanding`, url: `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html` });
const lh = (path: string, label: string) => ({ label: `Lighthouse: ${label}`, url: `https://developer.chrome.com/docs/lighthouse/${path}` });

export const RULE_CATALOG: Record<string, Rule> = {
  "color-contrast": {
    id: "color-contrast", title: "Text doesn't have enough contrast with its background", category: "accessibility", severity: "serious", source: "axe-core",
    criterion: "1.4.3 Contrast (Minimum) · AA",
    why: "People with low vision or using a screen in sunlight can't read low-contrast text. Body text needs a 4.5:1 ratio.",
    howToFix: "Darken the text colour (or lighten the background) until the ratio is at least 4.5:1, or 3:1 for text 24px and larger. Change the design token, not the single element, when the colour comes from a shared style.",
    refs: [wcag("1.4.3", "contrast-minimum"), deque("color-contrast")],
  },
  "image-alt": {
    id: "image-alt", title: "Image has no text alternative", category: "accessibility", severity: "critical", source: "axe-core",
    criterion: "1.1.1 Non-text Content · A",
    why: "Screen readers announce an image without alt as its file name, or skip it. A chart without alt hides its data.",
    howToFix: "Add an alt that says what the image shows. For charts, give the takeaway (\"Rates fell 0.5 points in Q3\"). Decorative images get alt=\"\".",
    refs: [wcag("1.1.1", "non-text-content"), deque("image-alt")],
  },
  "link-name": {
    id: "link-name", title: "Link has no accessible name", category: "accessibility", severity: "serious", source: "axe-core",
    criterion: "2.4.4 Link Purpose (In Context) · A",
    why: "An icon-only link is announced as \"link\", so screen reader users can't tell where it goes.",
    howToFix: "Add an aria-label that says where the link goes, or visually hidden text inside it.",
    refs: [wcag("2.4.4", "link-purpose-in-context"), deque("link-name")],
  },
  "button-name": {
    id: "button-name", title: "Button has no accessible name", category: "accessibility", severity: "critical", source: "axe-core",
    criterion: "4.1.2 Name, Role, Value · A",
    why: "A button with only an icon is announced as \"button\". Users can't tell what it does.",
    howToFix: "Give the button visible text, or an aria-label that describes the action.",
    refs: [wcag("4.1.2", "name-role-value"), deque("button-name")],
  },
  label: {
    id: "label", title: "Form field has no label", category: "accessibility", severity: "critical", source: "axe-core",
    criterion: "4.1.2 Name, Role, Value · A",
    why: "A placeholder disappears when you type and isn't a label. Screen readers announce the field as \"edit text\".",
    howToFix: "Add a <label for> tied to the input's id. Keep it visible, or visually hidden if the design needs it.",
    refs: [wcag("4.1.2", "name-role-value"), deque("label")],
  },
  "heading-order": {
    id: "heading-order", title: "Heading levels skip a level", category: "accessibility", severity: "moderate", source: "axe-core",
    why: "Screen reader users jump between headings to scan the page. Going from H2 to H4 suggests a missing section.",
    howToFix: "Use the next level down (H3 after H2). Style it to look smaller if needed; don't pick a level for its size.",
    refs: [deque("heading-order")],
  },
  "link-in-text-block": {
    id: "link-in-text-block", title: "Link in a paragraph is only distinguishable by colour", category: "accessibility", severity: "serious", source: "axe-core",
    criterion: "1.4.1 Use of Color · A",
    why: "People who can't tell the colours apart don't see that the text is a link.",
    howToFix: "Underline links inside text, or give them a 3:1 contrast with the surrounding text plus a non-colour cue on hover and focus.",
    refs: [wcag("1.4.1", "use-of-color"), deque("link-in-text-block")],
  },
  region: {
    id: "region", title: "Content is outside any landmark", category: "accessibility", severity: "moderate", source: "axe-core",
    why: "Screen reader users navigate by landmarks (header, main, footer). Content outside them is easy to miss.",
    howToFix: "Move the element inside a landmark, or wrap it in one with a label (e.g. <aside aria-label=\"Cookie consent\">).",
    refs: [deque("region")],
  },
  canonical: {
    id: "canonical", title: "Canonical URL points to a URL with tracking parameters", category: "seo", severity: "serious", source: "Custom check",
    why: "Search engines may index the tracking URL instead of the clean one, splitting ranking signals.",
    howToFix: "Set the canonical to the page's clean URL: no query string, the https://www host, no trailing slash.",
    refs: [{ label: "Google: Consolidate duplicate URLs", url: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls" }],
  },
  "meta-description": {
    id: "meta-description", title: "Page has no meta description", category: "seo", severity: "moderate", source: "Lighthouse",
    why: "Search results show a random snippet of the page instead of a summary you chose.",
    howToFix: "Add a 120–160 character <meta name=\"description\"> that summarises the article.",
    refs: [lh("seo/meta-description", "Meta description")],
  },
  "hreflang": {
    id: "hreflang", title: "French version isn't linked with hreflang", category: "seo", severity: "minor", source: "Custom check",
    why: "Search engines may show the English page to French-speaking users.",
    howToFix: "Add <link rel=\"alternate\" hreflang=\"fr\"> pointing to the French page, and the reverse link on that page.",
    refs: [{ label: "Google: Localized versions", url: "https://developers.google.com/search/docs/specialty/international/localized-versions" }],
  },
  noopener: {
    id: "noopener", title: "External link opens a new tab without rel=\"noopener\"", category: "security", severity: "moderate", source: "Custom check",
    why: "The opened page can redirect this tab through window.opener (reverse tabnabbing).",
    howToFix: "Add rel=\"noopener noreferrer\" to links with target=\"_blank\".",
    refs: [{ label: "MDN: rel=noopener", url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/noopener" }],
  },
  "broken-link-external": {
    id: "broken-link-external", title: "External link is broken (4xx/5xx)", category: "seo", severity: "serious", source: "Custom check",
    why: "Visitors land on an error page, and search engines read dead outbound links as a sign the page isn't maintained.",
    howToFix: "Replace the link with the page's new address, link to an archived copy, or remove it. If the target only blocks crawlers, ask for the URL to be allow-listed.",
    refs: [{ label: "Google: Link best practices", url: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable" }],
  },
  "mixed-content": {
    id: "mixed-content", title: "Image loaded over http on an https page", category: "security", severity: "serious", source: "Custom check",
    why: "Browsers warn about or block insecure content, and it can be tampered with in transit.",
    howToFix: "Load the resource over https, or host it on the site.",
    refs: [{ label: "MDN: Mixed content", url: "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content" }],
  },
  "render-blocking-resources": {
    id: "render-blocking-resources", title: "Resource blocks the first paint", category: "performance", severity: "moderate", source: "Lighthouse",
    why: "The browser waits for this file before showing anything, which delays first contentful paint.",
    howToFix: "Load scripts with defer or async; inline critical CSS and load the rest without blocking.",
    refs: [lh("performance/render-blocking-resources", "Eliminate render-blocking resources")],
  },
  "modern-image-formats": {
    id: "modern-image-formats", title: "Image could be served as WebP or AVIF", category: "performance", severity: "minor", source: "Lighthouse",
    why: "The JPEG is about 3× larger than the same image in AVIF, which slows the largest contentful paint.",
    howToFix: "Serve AVIF/WebP with a <picture> fallback, or let the image CDN pick the format.",
    refs: [lh("performance/uses-webp-images", "Serve images in modern formats")],
  },
  "unused-javascript": {
    id: "unused-javascript", title: "Most of this script isn't used on the page", category: "performance", severity: "minor", source: "Lighthouse",
    why: "The browser downloads and parses code it never runs.",
    howToFix: "Split the bundle by route, or load the widget only on pages that use it.",
    refs: [lh("performance/unused-javascript", "Reduce unused JavaScript")],
  },
};

export type IssueStatus = "new" | "existing" | "fixed";
export type Instance = {
  k: number; // instance id on this page; the element carries data-ix="k"
  rule: string;
  group: string; // selector pattern; instances in a group share one fix
  selector: string;
  snippet: string;
  shared: number | null; // pages with the same markup, null = only this page
  status: IssueStatus;
  firstSeen: number; // crawl id
  onPage: boolean; // has a visible element (head tags and fixed issues don't)
  origin: "static-html" | "sample";
};

type CapturedFinding = {
  rule: string;
  pattern: string;
  selector: string;
  snippet: string;
  onPage: boolean;
  origin: "static-html" | "sample";
};

type FindingIndex = Record<"rbccm" | "rbcits", Record<string, CapturedFinding[]>>;
const capturedFindings = captured as FindingIndex;
const legacyFindings = legacy as FindingIndex;
const emptyFindings: CapturedFinding[] = [];

function findingsFor(site: SiteId, pageId: number): CapturedFinding[] {
  if (site === "rbccm" || site === "rbcits") {
    return capturedFindings[site][pageId] ?? legacyFindings[site][pageId] ?? emptyFindings;
  }
  const source = samplePages.qa[site].find((entry) => entry.id === pageId);
  const production = site === "rbccm-qa" ? "rbccm" : "rbcits";
  return source ? capturedFindings[production][source.sourceId] ?? emptyFindings : emptyFindings;
}

const isPerformance = (finding: CapturedFinding) => RULE_CATALOG[finding.rule].category === "performance";
const hasAuditDocument = (page: PageView) => page.status < 400;

type IssueCounts = {
  total: number;
  critical: number;
  byCategory: Readonly<Record<Exclude<Category, "performance">, number> & { performance: number | null }>;
  byPriority: Readonly<Record<Priority, number>>;
};

// An issue is a distinct current rule on one page. Individual failures are elements.
export function currentIssueCounts(p: PageView): IssueCounts {
  const rules = new Set(p.change === "removed" || !hasAuditDocument(p) ? [] : findingsFor(p.site, p.i)
    .filter((finding) => p.perf != null || !isPerformance(finding)).map(({ rule }) => rule));
  const byCategory = { accessibility: 0, seo: 0, security: 0, performance: 0 };
  const byPriority = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const id of rules) {
    const rule = RULE_CATALOG[id];
    byCategory[rule.category]++;
    byPriority[PRIORITY[rule.severity]]++;
  }
  return { total: rules.size, critical: byPriority.P1, byCategory: { ...byCategory, performance: p.perf == null ? null : byCategory.performance }, byPriority };
}

const sharedKey = ({ rule, pattern, snippet }: CapturedFinding) => JSON.stringify([rule, pattern, snippet]);
const sharedCache = new Map<string, Map<string, number>>();

function sharedCounts(site: SiteId, crawl: number) {
  const key = `${site}:${crawl}`;
  let counts = sharedCache.get(key);
  if (counts) return counts;
  counts = new Map();
  const fixture = crawlFixture(site, crawl);
  for (const id of fixture?.pageIds ?? []) {
    if (fixture?.errorPageIds.includes(id)) continue;
    const keys = new Set(findingsFor(site, id)
      .filter((finding) => finding.snippet && (!isPerformance(finding) || fixture?.lighthousePageIds.includes(id)))
      .map(sharedKey));
    for (const id of keys) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  sharedCache.set(key, counts);
  return counts;
}

function firstSeen(site: SiteId, id: number, crawl: number, performance: boolean) {
  const first = crawlFixturesFor(site).findLast((entry) => entry.status === "success" && Number(entry.id) <= crawl && !entry.errorPageIds.includes(id) &&
    (performance ? entry.lighthousePageIds : entry.pageIds).includes(id));
  return first ? Number(first.id) : crawl;
}

// Read the same element IDs in every snapshot. An unaudited performance snapshot cannot prove a fix.
export function issueSlots(p: PageView, crawl: number, baseline: number | null): Instance[] {
  if (!hasAuditDocument(p)) return [];
  return findingsFor(p.site, p.i).flatMap((finding, k) => {
    const performance = isPerformance(finding);
    const current = p.change !== "removed" && (!performance || p.perf != null);
    const before = baseline != null && p.change !== "new" && (!performance || p.baselinePerf != null);
    if (!current && !(before && p.change === "removed")) return [];
    const status = !current ? "fixed" : p.change === "new" ? "new" : "existing";
    const at = status === "fixed" ? baseline! : crawl;
    const shared = sharedCounts(p.site, at).get(sharedKey(finding)) ?? 0;
    return [{
      k, rule: finding.rule, group: finding.pattern, selector: finding.selector, snippet: finding.snippet,
      shared: shared > 1 ? shared : null, status, firstSeen: firstSeen(p.site, p.i, at, performance),
      onPage: status !== "fixed" && finding.onPage, origin: finding.origin,
    }];
  });
}

export function pageIssues(p: PageView, crawl: number, baseline: number | null) {
  const instances = issueSlots(p, crawl, baseline);
  const html = getStoredSnapshot(p) ? getStoredDocument(p, instances) : null;
  return { instances, html };
}

const readable = (markup: string) => markup.replace(/ data-ix="\d+"/g, "");

export function sourceLines(html: string) {
  const lines = html.replace(/<style>[\s\S]*?<\/style>/, "<style>…</style>").split("\n");
  const lineOf = new Map<number, number>();
  lines.forEach((l, n) => { for (const m of l.matchAll(/data-ix="(\d+)"/g)) lineOf.set(Number(m[1]), n); });
  return { lines: lines.map(readable), lineOf };
}

// The prompt "Copy prompt" puts on the clipboard, and what the AI panel is given as context
export function issuePrompt(p: PageView, it: Instance) {
  const r = RULE_CATALOG[it.rule];
  return [
    `Fix this ${r.category} issue on ${p.url}`,
    `Rule: ${r.id} (${r.source}${r.criterion ? `, WCAG ${r.criterion}` : ""}) – ${r.title}`,
    `Element: ${it.selector}`, "", "```html", it.snippet, "```", "",
    `Why it matters: ${r.why}`, `How to fix: ${r.howToFix}`,
    it.shared ? `This markup is shared by ${it.shared.toLocaleString("en-US")} pages, so fix it in the template.` : "This markup is only on this page.",
    "Return the corrected HTML for this element only.",
  ].join("\n");
}

// ───────── Handoff: the filtered list as JSON, one prompt, an API request, a local check ─────────
export function issuesJson(p: PageView, crawl: number, list: Instance[], priority: (s: Severity) => string) {
  return JSON.stringify({
    page: { id: p.i, url: `${p.url}`, crawl },
    issues: list.map((it) => {
      const r = RULE_CATALOG[it.rule];
      return {
        id: `${p.i}-${it.k + 1}`, rule: r.id, title: r.title, priority: priority(r.severity), severity: r.severity, category: r.category,
        wcag: r.criterion ?? null, status: it.status, origin: it.origin, shared_pages: it.shared, selector: it.selector, html: it.snippet,
        how_to_fix: r.howToFix, references: r.refs.map((x) => x.url),
      };
    }),
  }, null, 2);
}

export function batchPrompt(p: PageView, list: Instance[], priority: (s: Severity) => string) {
  const byRule = new Map<string, Instance[]>();
  for (const it of list) byRule.set(it.rule, [...(byRule.get(it.rule) ?? []), it]);
  return [
    `Fix these ${byRule.size} issues on ${p.url}. Return a patch per file.`, "",
    ...[...byRule.entries()].flatMap(([rule, items]) => {
      const r = RULE_CATALOG[rule];
      return [
        `## ${priority(r.severity)} ${r.title} (${r.id}${r.criterion ? `, WCAG ${r.criterion.split(" ")[0]}` : ""}), ${items.length} element${items.length > 1 ? "s" : ""}`,
        `How to fix: ${r.howToFix}`,
        ...items.map((it) => `- ${it.selector}${it.shared ? ` (same markup on ${it.shared.toLocaleString("en-US")} pages)` : ""}\n  \`${it.snippet.replace(/\n/g, " ")}\``), "",
      ];
    }),
  ].join("\n");
}

export const apiRequest = (pageId: number, crawl: number, filters: Record<string, string[]>) => {
  const qs = Object.entries(filters).filter(([, v]) => v.length).map(([k, v]) => `${k}=${v.join(",")}`).join("&");
  return `curl -s "${typeof window === "undefined" ? "" : window.location.origin}/api/pages/${pageId}/issues?crawl=${crawl}${qs ? `&${qs}` : ""}"`;
};

export const localCheck = (p: PageView, it: Instance) =>
  `npx @rbc/crawler check http://localhost:3000${p.path} --rule ${it.rule} --selector "${it.selector}"`;
