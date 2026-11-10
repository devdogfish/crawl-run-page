// PROTOTYPE: scripted answers, used when there's no /api/chat (a static build) or with VITE_AI=scripted.
// In `pnpm dev`, /api/chat is a real model through a local Codex session (vite.config.ts).
//
// It takes the same messages the real call will send (system prompt + conversation; the buttons' messages carry
// @issue / @page references, which it resolves itself instead of calling tools)
// and streams back plain text in the format the system prompt asks for: @issue / @rule references and ```ui
// component blocks (fix, paste, issue, issues, page, pages, choice). The answers are built from the issue data, not generated. Replacing this with the corporate AI gateway
// is the backend's job; src/lib/ai.ts already calls /api/chat.
import { PRIORITY } from "@/lib/priority";
import { issueId, resolveIssue, type ResolvedIssue } from "@/lib/refs";
import { pageIssues } from "@/lib/page-issues";
import { baselinesFor, defaultCrawl, pageView, pagesFor, totalIssues } from "@/lib/site-pages";
import { DEFAULT_SITE, SITE_IDS, type SiteId } from "@/lib/sites";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// What the model would return as the corrected element, per rule
const FIXES: Record<string, (s: string) => string> = {
  "color-contrast": (s) => s.replace(/color:\s*#[0-9a-f]+/i, "color: #595959"),
  "image-alt": (s) => s.replace("<img ", '<img alt="Chart: credit spreads narrowed through Q3 2025" '),
  "link-name": (s) => s.replace(/<a class="icon (\w+)"/, (_, n) => `<a class="icon ${n}" aria-label="${n === "search" ? "Search" : "Change language"}"`),
  "button-name": (s) => s.replace("<button ", '<button aria-label="Subscribe" '),
  label: (s) => `<label for="nl-email">Email address</label>\n${s.replace("<input ", '<input id="nl-email" ')}`,
  "heading-order": (s) => s.replace(/<h4/g, "<h3").replace(/<\/h4>/g, "</h3>"),
  "link-in-text-block": (s) => s.replace('class="inline"', 'class="inline" style="text-decoration: underline"'),
  region: (s) => s.replace('<div class="cookie-banner"', '<aside aria-label="Cookie consent" class="cookie-banner"').replace(/<\/div>$/, "</aside>"),
  canonical: (s) => s.replace(/\?utm_[^"]+/, ""),
  "meta-description": () => '<meta name="description" content="Our analysts on where private credit goes next: spreads, default risk and the deals to watch.">',
  hreflang: (s) => `${s}\n<link rel="alternate" hreflang="fr" href="/fr/…">`,
  noopener: (s) => s.replace('target="_blank"', 'target="_blank" rel="noopener noreferrer"'),
  "mixed-content": (s) => s.replace("http://", "https://"),
  "render-blocking-resources": (s) => s.replace("<script ", "<script defer "),
  "modern-image-formats": (s) => `<picture>\n  <source srcset="${s.match(/src="([^"]+)\.jpg"/)?.[1] ?? "hero"}.avif" type="image/avif">\n  ${s}\n</picture>`,
  "unused-javascript": (s) => s.replace("<script ", '<script type="module" '),
};

// What it changed, and what the developer still has to check, per rule
const CHANGED: Record<string, string> = {
  "color-contrast": "Darkened the text to #595959, which reaches 7:1 on white (the minimum is 4.5:1).",
  "image-alt": "Added `alt` with the chart's takeaway, not a description of it being a chart.",
  "link-name": "Added an `aria-label`, because the link only contains an icon.",
  "button-name": "Added an `aria-label`, because the button only contains an icon.",
  label: "Added a visible `<label>` tied to the field with `for`/`id`. A placeholder isn't a label.",
  "heading-order": "Changed the `h4` to `h3`, so the outline doesn't skip a level under the `h2`.",
  "link-in-text-block": "Underlined the link, so it doesn't rely on colour alone.",
  region: "Made the banner an `<aside>` with a label, so it's inside a landmark.",
  canonical: "Removed the tracking parameters from the canonical URL.",
  "meta-description": "Wrote a description from the page's lead paragraph.",
  hreflang: "Added the `hreflang` link to the French version.",
  noopener: 'Added `rel="noopener noreferrer"`.',
  "mixed-content": "Switched the image to https.",
  "render-blocking-resources": "Added `defer`, so the script no longer blocks the first paint.",
  "modern-image-formats": "Wrapped the image in `<picture>` with an AVIF source, keeping the JPEG as fallback.",
  "unused-javascript": "Loaded it as a module, so it can be split and only the used part runs here.",
};
const CHECK: Record<string, string> = {
  "image-alt": "The alt text is a guess from the figure caption. Make sure it says what the chart actually shows.",
  "link-name": "Make sure the label matches what the link does.",
  "button-name": "Make sure the label matches what the button does.",
  "meta-description": "The description is a draft. Have the content owner confirm it.",
  hreflang: "Fill in the French page's real path.",
  "modern-image-formats": "The AVIF file has to exist on the server.",
};
const howToTest = (r: ResolvedIssue) =>
  r.rule.category === "accessibility"
    ? "Run axe DevTools on the page again, then try the element with the keyboard and a screen reader (VoiceOver: Cmd+F5)."
    : "The next crawl re-checks it; it'll show under Fixed once it's gone.";

const shared = (r: ResolvedIssue) => r.it.shared != null
  ? `This markup is on ${r.it.shared.toLocaleString("en-US")} pages, so the fix belongs in the template: one change there fixes all of them.`
  : "";

// Rules whose fix is a value an editor pastes into a Teamsite field, not markup: [field label, the value inside the fix]
const PASTE: Record<string, [string, (after: string) => string | undefined]> = {
  "meta-description": ["Meta description", (a) => a.match(/content="([^"]+)"/)?.[1]],
  "image-alt": ["Image alt text", (a) => a.match(/alt="([^"]+)"/)?.[1]],
};

function fix(r: ResolvedIssue) {
  const after = (FIXES[r.rule.id] ?? ((s: string) => s))(r.it.snippet);
  const paste = PASTE[r.rule.id], value = paste?.[1](after);
  return [
    `${r.rule.why}`,
    "```ui", JSON.stringify({ type: "fix", issue: r.id, html: after }), "```",
    value ? `If you edit this in Teamsite, paste this into the field:\n\n\`\`\`ui\n${JSON.stringify({ type: "paste", issue: r.id, label: paste[0], value })}\n\`\`\`` : "",
    `**What I changed:** ${CHANGED[r.rule.id] ?? "Applied the rule's guidance."}`,
    shared(r),
    `**Check:** ${CHECK[r.rule.id] ? `${CHECK[r.rule.id]} ` : ""}${howToTest(r)}`,
  ].filter(Boolean).join("\n\n");
}

function explain(r: ResolvedIssue) {
  return [
    `@issue:${r.id} on @page:${r.page.i} fails @rule:${r.rule.id}${r.rule.criterion ? ` (WCAG ${r.rule.criterion.split(" ")[0]})` : ""}.`,
    r.rule.why,
    r.rule.category === "accessibility"
      ? "**Who it affects:** people using screen readers or the keyboard, and anyone who can't see colour differences well."
      : r.rule.category === "seo" ? "**Who it affects:** search engines, and so everyone who finds the page through search."
      : r.rule.category === "security" ? "**Who it affects:** every visitor: it's a gap an attacker or a browser warning can use."
      : "**Who it affects:** every visitor, most on slow phones and connections.",
    `**Here:** it's ${PRIORITY[r.rule.severity]} because the rule is ${r.rule.severity}. ${shared(r) || "It's only on this page, so it's fixed here."}`,
  ].join("\n\n");
}

const block = (data: object) => "```ui\n" + JSON.stringify(data) + "\n```";

// The pages with the most distinct open rules in the latest crawl.
function worstPages(site: SiteId) {
  const a = Number(defaultCrawl(site).id);
  const top = pagesFor(site, a, null).filter((p) => totalIssues(p) > 0)
    .sort((x, y) => totalIssues(y) - totalIssues(x)).slice(0, 10);
  if (!top.length) return "There are no open issues in the latest crawl.";
  return [
    `These are the ${top.length} pages with the most issues in the latest crawl.`,
    block({ type: "pages", title: "Most issues", pages: top.map((p) => String(p.i)) }),
    block({ type: "choice", options: [`Summarize @page:${top[0].i}`] }),
  ].join("\n\n");
}

function summarize(ids: string[]) {
  const all = ids.map((id) => resolveIssue(id)).filter((r): r is ResolvedIssue => !!r);
  if (!all.length) return "There's nothing open in this list.";
  const byRule = new Map<string, ResolvedIssue[]>();
  // A rule can fail both in shared markup and on this page only: those are two different fixes
  for (const r of all) { const key = `${r.rule.id}|${r.it.shared != null}`; byRule.set(key, [...(byRule.get(key) ?? []), r]); }
  const groups = [...byRule.values()].sort((a, b) => a[0].priority.localeCompare(b[0].priority) || b.length - a.length);
  const local = groups.filter((g) => g[0].it.shared == null), common = groups.filter((g) => g[0].it.shared != null);
  return [
    block({ type: "page", page: String(all[0].page.i) }),
    `${new Set(all.map((issue) => issue.rule.id)).size} issues across ${all.length} elements. ${local.length} groups are on this page, and ${common.length} come from shared markup.`,
    local.length ? "**Fix first, on this page** (worst first, one per group):" : "",
    local.length ? block({ type: "issues", title: "Fix first", issues: local.slice(0, 5).map((g) => g[0].id) }) : "",
    common.length ? `**Shared markup:** ${common.map((g) => `@rule:${g[0].rule.id}`).join(", ")}. These are in the header, footer or banners, so raise them with whoever owns the template rather than fixing them here.` : "",
    local[0] ? block({ type: "choice", options: [`Fix @issue:${local[0][0].id}`, `Explain @issue:${local[0][0].id}`] }) : "",
  ].filter(Boolean).join("\n\n");
}

// The site the user is in, which is the one the cards resolve @page ids against
const currentSite = (): SiteId =>
  SITE_IDS.find((id) => typeof location !== "undefined" && location.pathname.split("/")[1] === id) ?? DEFAULT_SITE;

// "Summarize the issues on @page:N …" (the page's Summarize button, or a suggested reply). Scripted: filters are ignored.
function summarizePage(i: number) {
  const site = currentSite(), a = Number(defaultCrawl(site).id), b = Number(baselinesFor(site, String(a))[0]?.id);
  const page = pageView(site, i, a, b);
  if (!page) return "I can't find that page.";
  return summarize(pageIssues(page, a, b).instances.filter((it) => it.status !== "fixed").map((it) => issueId(site, i, it.k)));
}

function answer(messages: ChatMessage[]) {
  const last = messages[messages.length - 1]?.content ?? "";
  const q = last.toLowerCase();
  const idsIn = (s: string) => [...s.matchAll(/@issue:(\d+)/g)].map((m) => m[1]);
  const here = idsIn(last);
  // A follow-up question is about the last issue mentioned anywhere in the conversation
  const recent = here[0] ?? messages.flatMap((m) => idsIn(m.content)).pop();
  const r = recent ? resolveIssue(recent) : null;

  const page = /^summari[sz]e\b.*@page:(\d+)/.exec(q)?.[1];
  if (page) return summarizePage(Number(page));
  if (/^summari[sz]e/.test(q)) return summarize(here);
  if (/\bpages\b/.test(q)) return worstPages(currentSite());
  if (/^explain/.test(q) && r) return explain(r);
  if (/\bfix|change|code|correct/.test(q) && r) return fix(r);
  if (/test|verify|check/.test(q) && r) return howToTest(r);
  if (/why|what|who|explain|mean/.test(q) && r) return explain(r);
  if (r) return [block({ type: "issue", issue: r.id }), r.rule.howToFix, block({ type: "choice", options: [`Fix @issue:${r.id}`] })].join("\n\n");
  return [
    "In this prototype my answers are scripted, so I can only answer about issues.",
    "Open a page, then use **Fix with AI** or **Explain with AI** on an issue, or **Summarize with AI** in the page's export menu (the download icon). The button writes the prompt here, with the issue's details under it.",
  ].join("\n\n");
}

// Streams the answer in small pieces, the way the real model will
export async function* streamAnswer(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const text = answer(messages);
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < text.length && !signal.aborted; i += 6) {
    yield text.slice(i, i + 6);
    await new Promise((r) => setTimeout(r, 12));
  }
}
