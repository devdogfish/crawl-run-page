import { expect, test } from "vitest";
import { explainMessage, fixMessage, issueId, summarizeMessage } from "@/lib/refs";
import { get_issue } from "@/lib/proto-api";
import { RULE_CATALOG, pageIssues } from "@/lib/page-issues";
import { baselinesFor, defaultCrawl, pageView, siteSize } from "@/lib/site-pages";

test("the buttons' messages are plain text with references", () => {
  expect(fixMessage("91550003")).toBe("Fix @issue:91550003");
  expect(explainMessage("91550003")).toBe("Explain @issue:91550003");
  expect(summarizeMessage(12)).toBe("Summarize the issues on @page:12 and say what to fix first.");
  expect(summarizeMessage(12, { status: "all", priorities: [], categories: [], query: " " }))
    .toBe("Summarize the issues on @page:12 and say what to fix first.");
  expect(summarizeMessage(12, { status: "new", priorities: ["P1", "P2"], categories: ["accessibility", "seo"], query: "alt" }))
    .toBe('Summarize the new P1/P2 accessibility/SEO issues matching "alt" on @page:12 and say what to fix first.');
});

test("get_issue answers a Fix @issue message in one call: page, element, HTML, why and how", () => {
  const site = "rbccm", a = Number(defaultCrawl(site).id), b = Number(baselinesFor(site, String(a))[0]?.id);
  const page = pageView(site, 0, a, b)!;
  const it = pageIssues(page, a, b, siteSize(site)).instances.find((x) => x.status !== "fixed")!;
  const r = RULE_CATALOG[it.rule];
  const out = get_issue({ element_id: issueId(site, 0, it.k) }) as Record<string, unknown> & { elements: { selector: string; html: string }[] };
  expect(out).toMatchObject({ site, page_url: page.url, page_path: page.path, rule: r.id, source: r.source, why: r.why, how_to_fix: r.howToFix });
  expect(out.elements[0].selector).toBe(it.selector);
  expect(out.elements[0].html).toBe(it.snippet.length > 400 ? `${it.snippet.slice(0, 400)}…` : it.snippet);
});
