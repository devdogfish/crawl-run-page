// References the assistant can write in plain text, and what the app knows about each one.
//
//   @issue:91550003   one issue element (rule + page + element). The id alone is enough to find everything else:
//                     the page, the rule, the original HTML and the links to Issues / Preview / Source.
//   @rule:image-alt   a rule from the catalog, across the site
//   @page:123         a page of the current site (title and path come from the page data)
//   @crawl:812        a crawl (status and link come from the crawl list)
//
// The issue ID packs site, page and stable element position. Without explicit scope, resolve the newest observation.
import { RULE_CATALOG, issueSlots, type Instance, type Rule } from "@/lib/page-issues";
import { PRIORITY, type Priority } from "@/lib/priority";
import { baselinesFor, crawlChoices, hasPage, pageView, type PageView } from "@/lib/site-pages";
import { SITE_IDS, type SiteId } from "@/lib/sites";

export type IssueView = "issues" | "preview" | "source";
export type ResolvedIssue = {
  id: string;
  site: SiteId;
  crawl: number;
  baseline: number | null;
  page: PageView;
  it: Instance;
  rule: Rule;
  priority: Priority;
  href: (view?: IssueView) => string; // the page detail with this element selected, in that tab
};

export const issueId = (site: SiteId, pageId: number, k: number) => String(SITE_IDS.indexOf(site) * 1e9 + pageId * 1e4 + k);

const cache = new Map<string, ResolvedIssue | null>();
type ResolveScope = { crawl?: number; baseline?: number | null };

export function resolveIssue(id: string, scope: ResolveScope = {}): ResolvedIssue | null {
  if (!/^\d+$/.test(id)) return null;
  const key = `${id}:${scope.crawl ?? ""}:${scope.baseline === undefined ? "" : scope.baseline ?? "none"}`;
  if (cache.has(key)) return cache.get(key)!;
  const n = Number(id);
  let out: ResolvedIssue | null = null;
  const site = SITE_IDS[Math.floor(n / 1e9)];
  if (Number.isInteger(n) && n >= 0 && site) {
    const pageId = Math.floor((n % 1e9) / 1e4), k = n % 1e4;
    if (!hasPage(site, pageId)) return null;
    const choices = crawlChoices(site);
    const candidates = scope.crawl !== undefined ? choices.filter(({ id }) => Number(id) === scope.crawl) :
      scope.baseline !== undefined ? choices.slice(0, 1) : choices;
    for (const [index, { id: crawlId }] of candidates.entries()) {
      const crawl = Number(crawlId);
      const defaultBaseline = index === 0 && scope.crawl === undefined ? baselinesFor(site, crawlId)[0]?.id : undefined;
      const baseline = scope.baseline !== undefined ? scope.baseline : defaultBaseline == null ? null : Number(defaultBaseline);
      if (baseline !== null && !choices.some(({ id }) => Number(id) === baseline && baseline < crawl)) continue;
      const page = pageView(site, pageId, crawl, baseline);
      const it = page ? issueSlots(page, crawl, baseline).find((element) => element.k === k) : undefined;
      if (!page || !it) continue;
      const rule = RULE_CATALOG[it.rule];
      const vs = baseline !== null && (it.status !== "existing" || scope.baseline !== undefined) ? `&vs=${baseline}` : "";
      out = {
        id, site, crawl, baseline, page, it, rule, priority: PRIORITY[rule.severity],
        href: (view = "issues") =>
          `/${site}/pages/${pageId}?crawl=${crawl}${vs}&issue=${k + 1}${view !== "issues" ? `&tab=${view}` : ""}`,
      };
      break;
    }
  }
  cache.set(key, out);
  return out;
}

export const resolveRule = (id: string): Rule | null => RULE_CATALOG[id] ?? null;

// ───────── What the buttons say in the conversation ─────────
// Plain messages with references, the same as the user could type: the model looks the references up (get_issue,
// find_issues), so nothing is sent that the user doesn't see as the message itself.
export const fixMessage = (id: string) => `Fix @issue:${id}`;
export const explainMessage = (id: string) => `Explain @issue:${id}`;

// "Summarize the new P1 accessibility issues on @page:12 …": the page's filters in words, so the summary covers what's on screen
export type IssueFilters = { status?: string; priorities?: string[]; categories?: string[]; query?: string };
const CATEGORY_WORD: Record<string, string> = { accessibility: "accessibility", seo: "SEO", performance: "performance", security: "security" };
export function summarizeMessage(pageId: number, f: IssueFilters = {}) {
  const which = [
    f.status && f.status !== "all" ? f.status : "",
    f.priorities?.length ? f.priorities.join("/") : "",
    f.categories?.length ? f.categories.map((c) => CATEGORY_WORD[c] ?? c).join("/") : "",
  ].filter(Boolean).join(" ");
  const query = f.query?.trim() ? ` matching "${f.query.trim()}"` : "";
  return `Summarize the ${which ? `${which} ` : ""}issues${query} on @page:${pageId} and say what to fix first.`;
}

// The only text the user doesn't type or see on a button: how to write references and component blocks.
// The panel shows it ("What the AI is told before every conversation").
export const SYSTEM_PROMPT = `You are the assistant inside an internal tool that crawls the RBC websites and checks every page against accessibility, SEO, performance and security rules. You help developers and content editors understand and fix issues.

Write plain text with light Markdown (short paragraphs, **bold**, \`code\`, lists). Be concise.

References:
- To refer to an issue, write @issue:ID with an ID that appears in the conversation or a tool result. Never invent IDs.
- The user's messages use the same references ("Fix @issue:91550003"). Look each one up before answering about it: get_issue for an issue (the page, the failing HTML, why it matters, how to fix), find_issues for a page.
- To refer to a rule, write @rule:RULE_ID (for example @rule:image-alt).
- To refer to a page of the current site, write @page:ID; to refer to a crawl, write @crawl:ID.
- To link to a screen of the app, write a Markdown link with an in-app path: [Issues · P1](/rbccm/issues?pri=P1). Only paths the app has; anything else is shown as plain text. Never link to other websites.

Components: the app can show a few things as components. Write each as a block of JSON whose "type" says which component it is:
\`\`\`ui
{"type": "...", ...}
\`\`\`
Available types:
- "fix": a fix for one issue: {"type": "fix", "issue": "ID", "html": "<the corrected HTML of the element>"}. One block per issue.
- "paste": a value for the user to paste into a Teamsite form field, such as a meta description or an image's alt text: {"type": "paste", "issue": "ID", "label": "Meta description", "value": "<the text>"}. Use it instead of markup when the fix is text in a CMS field.
- "issue": one issue on its own, when the answer is about one issue and the user hasn't seen it yet (where it is, its HTML, why it matters, a Fix button): {"type": "issue", "issue": "ID"}.
- "issues": a table of issues, when the answer is several issues (the worst on a page, where a rule fails, what's new): {"type": "issues", "title": "Worst on this page", "issues": ["ID", "ID", ...]}. Put them in the order you want them read, worst first. Each row has a Fix button, and the table can be copied or exported. Use it instead of a list of @issue references.
- "page": one page of the current site (its open issues by priority and category, with links): {"type": "page", "page": "PAGE_ID"}. Use it when the answer is about a page as a whole.
- "pages": a table of pages of the current site with their open issues: {"type": "pages", "title": "Most issues", "pages": ["PAGE_ID", ...]}. Use it instead of a list of @page references.
- "choice": up to five short replies the user can click instead of typing, shown under your answer, when there's an obvious next step or you need them to pick one thing: {"type": "choice", "options": ["Fix the P1 issues", "Only this page"]}. Each option is sent as the user's message, word for word, so write it in their voice. At most one per answer, at the end. Don't repeat the options in the text.

The fix component shows a diff against the original element, with links to the issue. So don't repeat the original HTML or the diff yourself. Around the block, explain in plain language: what's wrong (one or two sentences), what you changed and why, and what to check (anything you had to guess, and how to test it). If the markup is shared by many pages, say the fix belongs in the template.`;
