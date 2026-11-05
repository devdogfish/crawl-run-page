// References the assistant can write in plain text, and what the app knows about each one.
//
//   @issue:91550003   one issue element (rule + page + element). The id alone is enough to find everything else:
//                     the page, the rule, the original HTML and the links to Issues / Preview / Source.
//   @rule:image-alt   a rule from the catalog, across the site
//
// PROTOTYPE: the issue id packs site, page and the element's position on the page, resolved against the latest
// crawl. In the real backend it's the element's own id, and `resolveIssue` becomes one API call.
import { RULE_CATALOG, pageIssues, type Instance, type Rule } from "@/lib/page-issues";
import { PRIORITY, type Priority } from "@/lib/priority";
import { baselinesFor, defaultCrawl, pageView, siteSize, type PageView } from "@/lib/site-pages";
import { SITE_IDS, type SiteId } from "@/lib/sites";

export type IssueView = "issues" | "preview" | "source";
export type ResolvedIssue = {
  id: string;
  site: SiteId;
  page: PageView;
  it: Instance;
  rule: Rule;
  priority: Priority;
  href: (view?: IssueView) => string; // the page detail with this element selected, in that tab
};

export const issueId = (site: SiteId, pageId: number, k: number) => String(SITE_IDS.indexOf(site) * 1e9 + pageId * 1e4 + k);

const cache = new Map<string, ResolvedIssue | null>();
export function resolveIssue(id: string): ResolvedIssue | null {
  if (cache.has(id)) return cache.get(id)!;
  const n = Number(id);
  let out: ResolvedIssue | null = null;
  const site = SITE_IDS[Math.floor(n / 1e9)];
  if (Number.isInteger(n) && n >= 0 && site) {
    const pageId = Math.floor((n % 1e9) / 1e4), k = n % 1e4;
    const a = Number(defaultCrawl(site).id);
    const b = Number(baselinesFor(site, String(a))[0]?.id ?? NaN);
    const page = pageView(site, pageId, a, Number.isNaN(b) ? null : b);
    const it = page ? pageIssues(page, a, Number.isNaN(b) ? null : b, siteSize(site)).instances.find((x) => x.k === k) : undefined;
    if (page && it) {
      const rule = RULE_CATALOG[it.rule];
      out = {
        id, site, page, it, rule, priority: PRIORITY[rule.severity],
        href: (view = "issues") =>
          // the baseline only matters for a fixed element (it's gone from the latest crawl)
          `/${site}/pages/${pageId}?crawl=${a}${it.status === "fixed" ? `&vs=${b}` : ""}&issue=${k + 1}${view !== "issues" ? `&tab=${view}` : ""}`,
      };
    }
  }
  cache.set(id, out);
  return out;
}

export const resolveRule = (id: string): Rule | null => RULE_CATALOG[id] ?? null;

// ───────── Prompts the buttons put into the conversation. The user sees all of it. ─────────
// Each has a short instruction (the message) and the context it's about (shown folded under the message).
export type Seed = { instruction: string; context: string };

function issueContext(site: SiteId, page: PageView, it: Instance) {
  const r = RULE_CATALOG[it.rule];
  return [
    `Issue: @issue:${issueId(site, page.i, it.k)}`,
    `Page: ${page.url}`,
    `Rule: ${r.id} (${r.source}${r.criterion ? `, WCAG ${r.criterion}` : ""}): ${r.title}`,
    `Priority: ${PRIORITY[r.severity]} (${r.severity})`,
    `Element: ${it.selector}`,
    it.shared ? `Shared markup: the same HTML is on ${it.shared.toLocaleString("en-US")} pages` : "Only on this page",
    "", "```html", it.snippet, "```", "",
    `Why it matters: ${r.why}`,
    `How to fix: ${r.howToFix}`,
  ].join("\n");
}

export const fixSeed = (site: SiteId, page: PageView, it: Instance): Seed =>
  ({ instruction: "Fix this issue.", context: issueContext(site, page, it) });

export const explainSeed = (site: SiteId, page: PageView, it: Instance): Seed =>
  ({ instruction: "Explain this issue: what's wrong, who it affects and why it matters here.", context: issueContext(site, page, it) });

export const summarizeSeed = (site: SiteId, page: PageView, list: Instance[]): Seed => ({
  instruction: `Summarize the ${list.length} issues on this page and say what to fix first.`,
  context: [
    `Page: ${page.url}`, "",
    ...list.map((it) => {
      const r = RULE_CATALOG[it.rule];
      return `- @issue:${issueId(site, page.i, it.k)} ${PRIORITY[r.severity]} ${r.title} · ${it.selector}${it.shared ? ` · shared by ${it.shared.toLocaleString("en-US")} pages` : ""}`;
    }),
  ].join("\n"),
});

// The only text the user doesn't type or see on a button: how to write references and component blocks.
// The panel shows it ("What the AI is told before every conversation").
export const SYSTEM_PROMPT = `You are the assistant inside an internal tool that crawls the RBC websites and checks every page against accessibility, SEO, performance and security rules. You help developers and content editors understand and fix issues.

Write plain text with light Markdown (short paragraphs, **bold**, \`code\`, lists). Be concise.

References:
- To refer to an issue, write @issue:ID with an ID that appears in the conversation. Never invent IDs.
- To refer to a rule, write @rule:RULE_ID (for example @rule:image-alt).

Components: the app can show a few things as components. Write each as a block of JSON whose "type" says which component it is:
\`\`\`ui
{"type": "...", ...}
\`\`\`
Available types:
- "fix": a fix for one issue: {"type": "fix", "issue": "ID", "html": "<the corrected HTML of the element>"}. One block per issue.

The fix component shows a diff against the original element, with links to the issue. So don't repeat the original HTML or the diff yourself. Around the block, explain in plain language: what's wrong (one or two sentences), what you changed and why, and what to check (anything you had to guess, and how to test it). If the markup is shared by many pages, say the fix belongs in the template.`;
