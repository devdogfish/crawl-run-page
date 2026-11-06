// What the assistant knows about where the user is: the site, a short name for the view, and prompts that fit it.
import { defaultCrawl, pageView } from "@/lib/site-pages";
import { SITE_IDS, type SiteId } from "@/lib/sites";
import { validateUrl } from "@/lib/nav/url-map";

// The site in the URL (the provider sits above the site layout, so useSite() isn't set yet here)
export const siteIn = (pathname: string): SiteId | "" => SITE_IDS.find((s) => s === pathname.split("/")[1]) ?? "";

// "Pages · Podcasts · 2025": the view and its filters, from the URL map; the bare path when the URL isn't in it
export function contextLabel(url: string): string {
  const v = validateUrl(url);
  if (!v.ok) return url.split("?")[0] || "/";
  if (v.route.id === "page" && v.site) {
    const id = Number(v.url.split("?")[0].split("/")[3]);
    const page = pageView(v.site, id, Number(defaultCrawl(v.site).id), null);
    return ["Page", page?.title ?? `#${id}`, ...v.chips.filter((c) => c.name !== "crawl" && c.name !== "issue").map((c) => c.label)].join(" · ");
  }
  return [v.route.label, ...v.chips.map((c) => c.label)].join(" · ");
}

const DEFAULT_PROMPTS = ["Which pages have the most P1 issues?", "What changed since the last crawl?"];
const PROMPTS: Record<string, string[]> = {
  page: ["Summarize the issues on this page", "What should I fix first on this page?", "Write the text to paste for the worst issue"],
  issues: ["Which issues should we fix first?", "Which issues come from shared markup?"],
  rule: ["Which issues should we fix first?", "Which issues come from shared markup?"],
  pages: ["Which of these pages have the most P1 issues?", "What changed since the last crawl?"],
  crawl: ["Why did the latest crawl take longer than usual?", "Which crawls failed recently?"],
  crawls: ["Why did the latest crawl take longer than usual?", "Which crawls failed recently?"],
  analytics: ["What got worse since the last crawl?", "Which fixes would improve the score most?"],
};

export function suggestionsFor(url: string): string[] {
  const v = validateUrl(url);
  return (v.ok && PROMPTS[v.route.id]) || DEFAULT_PROMPTS;
}
