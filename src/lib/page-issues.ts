// PROTOTYPE DATA for the page detail view: the rule catalog, each page's issue instances, and the page's HTML.
//
// Every issue has the same shape whatever produced it (axe-core, Lighthouse, a custom check):
//   rule (catalog entry: title, why, how to fix, references) + instance (selector, HTML snippet, element box).
// "Shared" instances come from markup that repeats across pages (header, footer); in the real backend that's
// a hash of selector + snippet seen on many pages. Fix those once, in the template.
//
// The HTML is generated here so the preview can render it; in the real app it's the stored rendered HTML
// and a screenshot taken by Playwright during the crawl, with each element's box saved next to the issue.
import { type Category, type PageView, typeLabel } from "@/lib/site-pages";

const rand = (i: number, salt: number) => {
  let x = (i + 1) * 2246822519 + salt * 3266489917;
  x = (x ^ (x >>> 15)) * 668265263;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

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
  fix: (snippet: string) => string; // what "Generate fix" returns for one element (mocked AI)
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
    fix: (s) => s.replace(/color:\s*#[0-9a-f]+/i, "color: #595959"),
  },
  "image-alt": {
    id: "image-alt", title: "Image has no text alternative", category: "accessibility", severity: "critical", source: "axe-core",
    criterion: "1.1.1 Non-text Content · A",
    why: "Screen readers announce an image without alt as its file name, or skip it. A chart without alt hides its data.",
    howToFix: "Add an alt that says what the image shows. For charts, give the takeaway (\"Rates fell 0.5 points in Q3\"). Decorative images get alt=\"\".",
    refs: [wcag("1.1.1", "non-text-content"), deque("image-alt")],
    fix: (s) => s.replace("<img ", '<img alt="Chart: credit spreads narrowed through Q3 2025" '),
  },
  "link-name": {
    id: "link-name", title: "Link has no accessible name", category: "accessibility", severity: "serious", source: "axe-core",
    criterion: "2.4.4 Link Purpose (In Context) · A",
    why: "An icon-only link is announced as \"link\", so screen reader users can't tell where it goes.",
    howToFix: "Add an aria-label that says where the link goes, or visually hidden text inside it.",
    refs: [wcag("2.4.4", "link-purpose-in-context"), deque("link-name")],
    fix: (s) => s.replace(/<a class="icon (\w+)"/, (_, n) => `<a class="icon ${n}" aria-label="${n === "search" ? "Search" : "Change language"}"`),
  },
  "button-name": {
    id: "button-name", title: "Button has no accessible name", category: "accessibility", severity: "critical", source: "axe-core",
    criterion: "4.1.2 Name, Role, Value · A",
    why: "A button with only an icon is announced as \"button\". Users can't tell what it does.",
    howToFix: "Give the button visible text, or an aria-label that describes the action.",
    refs: [wcag("4.1.2", "name-role-value"), deque("button-name")],
    fix: (s) => s.replace("<button ", '<button aria-label="Subscribe" '),
  },
  label: {
    id: "label", title: "Form field has no label", category: "accessibility", severity: "critical", source: "axe-core",
    criterion: "4.1.2 Name, Role, Value · A",
    why: "A placeholder disappears when you type and isn't a label. Screen readers announce the field as \"edit text\".",
    howToFix: "Add a <label for> tied to the input's id. Keep it visible, or visually hidden if the design needs it.",
    refs: [wcag("4.1.2", "name-role-value"), deque("label")],
    fix: (s) => `<label for="nl-email">Email address</label>\n${s.replace("<input ", '<input id="nl-email" ')}`,
  },
  "heading-order": {
    id: "heading-order", title: "Heading levels skip a level", category: "accessibility", severity: "moderate", source: "axe-core",
    why: "Screen reader users jump between headings to scan the page. Going from H2 to H4 suggests a missing section.",
    howToFix: "Use the next level down (H3 after H2). Style it to look smaller if needed; don't pick a level for its size.",
    refs: [deque("heading-order")],
    fix: (s) => s.replace(/<h4/g, "<h3").replace(/<\/h4>/g, "</h3>"),
  },
  "link-in-text-block": {
    id: "link-in-text-block", title: "Link in a paragraph is only distinguishable by colour", category: "accessibility", severity: "serious", source: "axe-core",
    criterion: "1.4.1 Use of Color · A",
    why: "People who can't tell the colours apart don't see that the text is a link.",
    howToFix: "Underline links inside text, or give them a 3:1 contrast with the surrounding text plus a non-colour cue on hover and focus.",
    refs: [wcag("1.4.1", "use-of-color"), deque("link-in-text-block")],
    fix: (s) => s.replace('class="inline"', 'class="inline" style="text-decoration: underline"'),
  },
  region: {
    id: "region", title: "Content is outside any landmark", category: "accessibility", severity: "moderate", source: "axe-core",
    why: "Screen reader users navigate by landmarks (header, main, footer). Content outside them is easy to miss.",
    howToFix: "Move the element inside a landmark, or wrap it in one with a label (e.g. <aside aria-label=\"Cookie consent\">).",
    refs: [deque("region")],
    fix: (s) => s.replace('<div class="cookie-banner"', '<aside aria-label="Cookie consent" class="cookie-banner"').replace(/<\/div>$/, "</aside>"),
  },
  canonical: {
    id: "canonical", title: "Canonical URL points to a URL with tracking parameters", category: "seo", severity: "serious", source: "Custom check",
    why: "Search engines may index the tracking URL instead of the clean one, splitting ranking signals.",
    howToFix: "Set the canonical to the page's clean URL: no query string, the https://www host, no trailing slash.",
    refs: [{ label: "Google: Consolidate duplicate URLs", url: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls" }],
    fix: (s) => s.replace(/\?utm_[^"]+/, ""),
  },
  "meta-description": {
    id: "meta-description", title: "Page has no meta description", category: "seo", severity: "moderate", source: "Lighthouse",
    why: "Search results show a random snippet of the page instead of a summary you chose.",
    howToFix: "Add a 120–160 character <meta name=\"description\"> that summarises the article.",
    refs: [lh("seo/meta-description", "Meta description")],
    fix: () => '<meta name="description" content="Our analysts on where private credit goes next: spreads, default risk and the deals to watch.">',
  },
  "hreflang": {
    id: "hreflang", title: "French version isn't linked with hreflang", category: "seo", severity: "minor", source: "Custom check",
    why: "Search engines may show the English page to French-speaking users.",
    howToFix: "Add <link rel=\"alternate\" hreflang=\"fr\"> pointing to the French page, and the reverse link on that page.",
    refs: [{ label: "Google: Localized versions", url: "https://developers.google.com/search/docs/specialty/international/localized-versions" }],
    fix: (s) => `${s}\n<link rel="alternate" hreflang="fr" href="https://www.rbccm.com/fr/…">`,
  },
  noopener: {
    id: "noopener", title: "External link opens a new tab without rel=\"noopener\"", category: "security", severity: "moderate", source: "Custom check",
    why: "The opened page can redirect this tab through window.opener (reverse tabnabbing).",
    howToFix: "Add rel=\"noopener noreferrer\" to links with target=\"_blank\".",
    refs: [{ label: "MDN: rel=noopener", url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/noopener" }],
    fix: (s) => s.replace('target="_blank"', 'target="_blank" rel="noopener noreferrer"'),
  },
  "mixed-content": {
    id: "mixed-content", title: "Image loaded over http on an https page", category: "security", severity: "serious", source: "Custom check",
    why: "Browsers warn about or block insecure content, and it can be tampered with in transit.",
    howToFix: "Load the resource over https, or host it on the site.",
    refs: [{ label: "MDN: Mixed content", url: "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content" }],
    fix: (s) => s.replace("http://", "https://"),
  },
  "render-blocking-resources": {
    id: "render-blocking-resources", title: "Resource blocks the first paint", category: "performance", severity: "moderate", source: "Lighthouse",
    why: "The browser waits for this file before showing anything, which delays first contentful paint.",
    howToFix: "Load scripts with defer or async; inline critical CSS and load the rest without blocking.",
    refs: [lh("performance/render-blocking-resources", "Eliminate render-blocking resources")],
    fix: (s) => s.replace("<script ", "<script defer "),
  },
  "modern-image-formats": {
    id: "modern-image-formats", title: "Image could be served as WebP or AVIF", category: "performance", severity: "minor", source: "Lighthouse",
    why: "The JPEG is about 3× larger than the same image in AVIF, which slows the largest contentful paint.",
    howToFix: "Serve AVIF/WebP with a <picture> fallback, or let the image CDN pick the format.",
    refs: [lh("performance/uses-webp-images", "Serve images in modern formats")],
    fix: (s) => `<picture>\n  <source srcset="/media/hero.avif" type="image/avif">\n  ${s}\n</picture>`,
  },
  "unused-javascript": {
    id: "unused-javascript", title: "Most of this script isn't used on the page", category: "performance", severity: "minor", source: "Lighthouse",
    why: "The browser downloads and parses code it never runs.",
    howToFix: "Split the bundle by route, or load the widget only on pages that use it.",
    refs: [lh("performance/unused-javascript", "Reduce unused JavaScript")],
    fix: (s) => s.replace("<script ", '<script type="module" '),
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
};

// ───────── Building the page and its issues together ─────────
type Slot = { rule: string; group: string; selector: string; shared: number | null };

// The page's issue elements without the HTML: what the Issues page aggregates across the site.
// Same order (and so the same instance ids) as pageIssues, so links to ?issue= line up.
export function issueSlots(p: PageView, crawl: number, baseline: number | null, sitePages: number): Instance[] {
  const A = p.issues.accessibility, crit = p.critical;
  const slots: Slot[] = [];
  const add = (n: number, rule: string, group: string, sel: (j: number) => string, shared: number | null) => {
    for (let j = 0; j < n; j++) slots.push({ rule, group, selector: sel(j), shared });
  };
  const everywhere = sitePages - 40 - Math.floor(rand(p.i, 1) * 200);

  // Shared markup first: header icons, cookie banner, footer links
  const sharedN = A <= 8 ? Math.min(A, 3) : Math.round(A * 0.6);
  add(Math.min(sharedN, 2), "link-name", "header .utility a.icon", (j) => `header .utility a.icon.${j ? "globe" : "search"}`, everywhere);
  if (sharedN > 2) add(1, "region", "body > .cookie-banner", () => "body > .cookie-banner", everywhere);
  const footer = Math.min(14, Math.max(0, sharedN - 3));
  add(footer, "color-contrast", "footer .legal a", (j) => `footer .legal a:nth-child(${j + 1})`, everywhere);

  // This page only: critical ones first (matches the "N critical" in the Pages table), then the rest
  let left = A - slots.length;
  const critSlots: [string, string, (j: number) => string, number][] = [
    ["image-alt", "article figure.chart img", (j) => `article figure.chart:nth-of-type(${j + 1}) img`, 5],
    ["label", "form.newsletter input", () => "form.newsletter input[type=email]", 1],
    ["button-name", "form.newsletter button", () => "form.newsletter button.go", 1],
  ];
  let c = Math.min(crit, left);
  for (const [rule, group, sel, cap] of critSlots) { const n = Math.min(cap, c); add(n, rule, group, sel, null); c -= n; left -= n; }
  const rest: [string, string, (j: number) => string, number][] = [
    ["color-contrast", "article .callout p", (j) => `article .callout p:nth-child(${j + 1})`, 4],
    ["heading-order", "article h4", (j) => `article section:nth-of-type(${j + 1}) h4`, 3],
    ["link-in-text-block", "article p a.inline", (j) => `article p:nth-of-type(${j + 2}) a.inline`, 4],
    ["color-contrast", "article table.data td.muted", (j) => `article table.data tr:nth-child(${j + 1}) td.muted`, 12],
  ];
  const used = rest.map(() => 0);
  for (let guard = 0; left > 0 && guard < 100; guard++) {
    const r = guard % rest.length;
    if (used[r] < rest[r][3]) { used[r]++; left--; }
  }
  rest.forEach(([rule, group, sel], r) => add(used[r], rule, group, sel, null));

  // SEO, security, performance
  const seo = ["canonical", "meta-description", "hreflang"].slice(0, p.issues.seo);
  for (const r of seo) slots.push({ rule: r, group: r === "canonical" ? "head link[rel=canonical]" : "head", selector: r === "canonical" ? "head > link[rel=canonical]" : "head", shared: null });
  if (p.issues.security > 0) add(1, "noopener", "article a[target=_blank]", () => 'article a[target="_blank"]', null);
  if (p.issues.security > 1) add(1, "mixed-content", "article figure img[src^=http:]", () => 'article img[src^="http:"]', null);
  if (p.perf) {
    const perf = ["render-blocking-resources", "modern-image-formats", "unused-javascript"];
    for (let j = 0; j < p.perf; j++) {
      const r = perf[j % 3];
      slots.push({ rule: r, group: r === "modern-image-formats" ? "article img.hero" : "head script", selector: r === "modern-image-formats" ? "article img.hero" : `head > script:nth-of-type(${Math.floor(j / 3) + 1})`, shared: r === "modern-image-formats" ? null : everywhere });
    }
  }

  // Status against the baseline: a few page-only issues are new; a few were fixed (gone from this crawl)
  const changed = p.change === "changed" || p.change === "new";
  const instances: Instance[] = slots.map((s, k) => {
    const isNew = baseline != null && (p.change === "new" || (changed && s.shared == null && rand(p.i, 50 + k) < 0.2));
    return { k, ...s, snippet: "", status: isNew ? "new" : "existing", firstSeen: isNew ? crawl : crawl - 3 - Math.floor(rand(p.i, 60 + k) * 40), onPage: !/^head(\s|>|$)/.test(s.selector) };
  });
  if (baseline != null && changed) {
    const fixed = Math.floor(rand(p.i, 70) * 4);
    const pool = ["image-alt", "color-contrast", "link-in-text-block", "heading-order"];
    for (let j = 0; j < fixed; j++) {
      const rule = pool[j % pool.length];
      instances.push({ k: 1000 + j, rule, group: "article .old-block", selector: `article .old-block:nth-of-type(${j + 1})`, shared: null, status: "fixed", firstSeen: baseline - 10, onPage: false, snippet: "" });
    }
  }

  return instances;
}

export function pageIssues(p: PageView, crawl: number, baseline: number | null, sitePages: number) {
  const instances = issueSlots(p, crawl, baseline, sitePages);
  const { html, snippets } = buildHtml(p, instances);
  for (const it of instances) it.snippet = snippets.get(it.k) ?? fixedSnippet(it);
  return { instances, html };
}

const fixedSnippet = (it: Instance) =>
  ({ "image-alt": '<img src="/media/old-chart.png">', "color-contrast": '<p style="color: #9a9a9a">Source: RBC CM</p>', "link-in-text-block": '<a class="inline" href="/en/insights">insights</a>', "heading-order": "<h5>Related reading</h5>" })[it.rule] ?? "<!-- removed -->";

// ───────── HTML ─────────
const LOREM = [
  "Private markets kept growing through the year as banks pulled back from leveraged lending, and direct lenders filled the gap.",
  "Spreads tightened in the third quarter, but our credit team still sees pockets of stress in sectors exposed to floating-rate debt.",
  "Deal flow picked up after rate cuts, led by sponsor-backed refinancings and a return of large unitranche facilities.",
  "We expect default rates to stay below the long-run average, with recoveries depending on covenant quality.",
];

function buildHtml(p: PageView, instances: Instance[]) {
  const snippets = new Map<number, string>();
  const by = (rule: string, group?: string) => instances.filter((x) => x.rule === rule && (!group || x.group === group) && x.status !== "fixed");
  // ix(...) marks the element of an instance; the attribute is stripped from snippets and the Source view
  const attr = (list: Instance[], j: number) => (list[j] ? ` data-ix="${list[j].k}"` : "");
  const record = (list: Instance[], j: number, markup: string) => { if (list[j]) snippets.set(list[j].k, readable(markup)); return markup; };

  const icons = by("link-name"), region = by("region"), footer = by("color-contrast", "footer .legal a");
  const charts = by("image-alt"), label = by("label"), button = by("button-name");
  const callout = by("color-contrast", "article .callout p"), headings = by("heading-order"), inline = by("link-in-text-block"), table = by("color-contrast", "article table.data td.muted");
  const noopener = by("noopener"), mixed = by("mixed-content"), hero = by("modern-image-formats");
  const canonical = by("canonical"), meta = by("meta-description"), hreflang = by("hreflang");
  const blocking = by("render-blocking-resources"), unused = by("unused-javascript");

  const head = [
    `<title>${p.title} | RBC Capital Markets</title>`,
    meta.length ? record(meta, 0, "<!-- no meta description -->") : `<meta name="description" content="${p.title}">`,
    canonical.length ? record(canonical, 0, `<link rel="canonical" href="https://www.rbccm.com${p.path}?utm_source=newsletter&utm_medium=email">`) : `<link rel="canonical" href="https://www.rbccm.com${p.path}">`,
    hreflang.length ? record(hreflang, 0, `<link rel="alternate" hreflang="en" href="https://www.rbccm.com${p.path}">`) : "",
    ...blocking.map((_, j) => record(blocking, j, `<script src="/assets/${["analytics", "consent", "tag-manager"][j % 3]}.js"></script>`)),
    ...unused.map((_, j) => record(unused, j, `<script src="/assets/vendor-${j + 1}.js"></script>`)),
  ].filter(Boolean).join("\n    ");

  const chartFig = (j: number) => record(charts, j, `<img${attr(charts, j)} src="${chartSvg(j)}" width="560" height="220">`);
  const figures = Array.from({ length: Math.max(2, charts.length) }, (_, j) => `<figure class="chart">\n          ${j < charts.length ? chartFig(j) : `<img src="${chartSvg(j)}" alt="Chart: issuance by quarter" width="560" height="220">`}\n          <figcaption>Figure ${j + 1}. ${["Direct lending volume", "Spread to SOFR", "Default rate", "Refinancing wall", "Sponsor activity"][j % 5]}</figcaption>\n        </figure>`);
  const sections = Array.from({ length: Math.max(2, headings.length) }, (_, j) => {
    const h = j < headings.length ? record(headings, j, `<h4${attr(headings, j)}>${["What changed this quarter", "Where we see risk", "Deals to watch"][j]}</h4>`) : `<h3>${["What changed this quarter", "Where we see risk", "Deals to watch"][j]}</h3>`;
    const link = inline[j * 2] ? record(inline, j * 2, `<a class="inline"${attr(inline, j * 2)} href="/en/insights/credit">credit outlook</a>`) : `<a href="/en/insights/credit">credit outlook</a>`;
    const link2 = inline[j * 2 + 1] ? record(inline, j * 2 + 1, `<a class="inline"${attr(inline, j * 2 + 1)} href="/en/research">latest research</a>`) : "latest research";
    return `<section>\n        ${h}\n        <p>${LOREM[j % 4]} Read our ${link} and the ${link2}.</p>\n        ${figures[j] ?? ""}\n      </section>`;
  });
  const extraFigures = figures.slice(sections.length).join("\n      ");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    ${head}
    <style>${CSS}</style>
  </head>
  <body>
    <header class="site-header">
      <a class="logo" href="/en/"><span class="mark">RBC</span> Capital Markets</a>
      <nav aria-label="Main"><a href="/en/insights">Insights</a><a href="/en/research">Research</a><a href="/en/about-us">About us</a><a href="/en/careers">Careers</a></nav>
      <div class="utility">
        ${[0, 1].map((j) => icons[j] ? record(icons, j, `<a class="icon ${j ? "globe" : "search"}"${attr(icons, j)} href="${j ? "/fr/" : "/en/search"}">${j ? "◎" : "⌕"}</a>`) : `<a class="icon" aria-label="${j ? "Français" : "Search"}" href="#">${j ? "◎" : "⌕"}</a>`).join("\n        ")}
      </div>
    </header>
    <main>
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/en/">Home</a> › <a href="/en/insights">${typeLabel(p.type)}</a> › ${p.title.split(":")[0]}</nav>
      <article>
        <p class="eyebrow">${typeLabel(p.type)} · ${p.path.match(/\/(20\d{2})\//)?.[1] ?? "2025"}</p>
        <h1>${p.h1}</h1>
        <p class="byline">By Sarah Chen and David Roy, Credit Strategy</p>
        ${hero.length ? record(hero, 0, `<img class="hero"${attr(hero, 0)} src="${heroSvg()}" alt="Toronto skyline at dusk" width="880" height="300">`) : `<img class="hero" src="${heroSvg()}" alt="Toronto skyline at dusk" width="880" height="300">`}
        <p class="lead">${LOREM[(p.i + 1) % 4]}</p>
        ${callout.length ? `<div class="callout">\n          ${callout.map((_, j) => record(callout, j, `<p${attr(callout, j)} style="color: #a3b1c2">${["Key takeaway: spreads tightened 40 bp.", "Defaults stay below average.", "Refinancing peaks in 2027.", "Covenant quality is slipping."][j]}</p>`)).join("\n          ")}\n        </div>` : `<div class="callout"><p>Key takeaway: spreads tightened 40 bp.</p></div>`}
      ${sections.join("\n      ")}
      ${extraFigures}
        <h3>By the numbers</h3>
        <table class="data">
          <tr><th>Metric</th><th>Q2</th><th>Q3</th></tr>
          ${Array.from({ length: Math.max(3, table.length) }, (_, j) => `<tr><td>${["Volume ($bn)", "Spread (bp)", "Default rate", "Deals", "Avg size ($m)", "Leverage", "Coverage", "Recovery", "Tenor (yrs)", "Sponsors", "Sectors", "Lenders"][j]}</td><td>${(10 + j * 7) % 90}</td>${table[j] ? record(table, j, `<td class="muted"${attr(table, j)} style="color: #b8c2cc">${(14 + j * 9) % 95}</td>`) : `<td>${(14 + j * 9) % 95}</td>`}</tr>`).join("\n          ")}
        </table>
        <p>Source: ${noopener.length ? record(noopener, 0, `<a${attr(noopener, 0)} href="https://www.bis.org/statistics" target="_blank">BIS statistics</a>`) : `<a href="https://www.bis.org/statistics" target="_blank" rel="noopener">BIS statistics</a>`}.
        ${mixed.length ? record(mixed, 0, `<img${attr(mixed, 0)} class="badge" src="http://cdn.partner-ratings.com/badge.svg" alt="Ratings partner" width="90" height="24">`) : ""}</p>
        <form class="newsletter">
          <strong>Get Credit Strategy in your inbox</strong>
          ${label.length ? record(label, 0, `<input${attr(label, 0)} type="email" placeholder="Email address">`) : `<label for="nl">Email address</label><input id="nl" type="email">`}
          ${button.length ? record(button, 0, `<button class="go"${attr(button, 0)} type="submit">→</button>`) : `<button type="submit">Subscribe</button>`}
        </form>
      </article>
    </main>
    ${region.length ? record(region, 0, `<div class="cookie-banner"${attr(region, 0)}>We use cookies to improve your experience. <a href="/en/legal/privacy">Privacy</a> <button>Accept</button></div>`) : ""}
    <footer>
      <div class="legal">
        ${Array.from({ length: Math.max(6, footer.length) }, (_, j) => {
          const t = ["Privacy", "Terms of use", "Accessibility", "Disclosures", "Cookies", "Sitemap", "Fraud", "Regulatory", "Contact", "Media", "Careers", "Locations", "Social", "Feedback"][j];
          return footer[j] ? record(footer, j, `<a${attr(footer, j)} href="/en/legal/${j}" style="color: #7d8a99">${t}</a>`) : `<a href="/en/legal/${j}">${t}</a>`;
        }).join("\n        ")}
      </div>
      <p>© 2026 RBC Capital Markets, LLC. All rights reserved.</p>
    </footer>
  </body>
</html>`;
  return { html, snippets };
}

const CSS = `
*{box-sizing:border-box} body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1d2733;background:#fff}
a{color:#005daa} .site-header{display:flex;align-items:center;gap:32px;padding:16px 48px;border-bottom:1px solid #e3e8ee}
.logo{font-weight:700;color:#1d2733;text-decoration:none} .mark{background:#005daa;color:#ffd200;padding:2px 6px;border-radius:3px;margin-right:6px}
.site-header nav{display:flex;gap:24px} .site-header nav a{color:#1d2733;text-decoration:none;font-size:15px}
.utility{margin-left:auto;display:flex;gap:12px} .icon{display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;border:1px solid #d5dce4;border-radius:50%;text-decoration:none;color:#1d2733}
main{max-width:880px;margin:0 auto;padding:24px 24px 48px} .crumbs{font-size:13px;color:#5b6876} .crumbs a{color:#5b6876}
.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.08em;color:#005daa;margin:24px 0 4px} h1{font-size:38px;line-height:1.15;margin:0 0 12px}
.byline{color:#5b6876;font-size:14px} .hero{width:100%;height:auto;border-radius:6px;display:block;margin:20px 0}
.lead{font-size:19px} .callout{background:#f1f5fa;border-left:4px solid #005daa;padding:12px 20px;margin:24px 0} .callout p{margin:6px 0;font-weight:600}
h3,h4{font-size:22px;margin:32px 0 8px} a.inline{text-decoration:none} figure{margin:24px 0} figure img{width:100%;height:auto;border:1px solid #e3e8ee;border-radius:4px}
figcaption{font-size:13px;color:#5b6876} table{border-collapse:collapse;width:100%;font-size:14px} th,td{border-bottom:1px solid #e3e8ee;padding:8px;text-align:left}
.badge{vertical-align:middle;margin-left:8px} .newsletter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#f7f9fb;padding:16px;border-radius:6px;margin-top:32px}
.newsletter strong{width:100%} .newsletter input{flex:1;min-width:180px;padding:10px;border:1px solid #c3ccd6;border-radius:4px} .newsletter button{padding:10px 16px;background:#005daa;color:#fff;border:0;border-radius:4px}
.cookie-banner{position:relative;margin:0 48px 16px;padding:12px 16px;background:#1d2733;color:#fff;border-radius:6px;font-size:14px} .cookie-banner a{color:#9cc3e8}
.cookie-banner button{margin-left:12px;background:#fff;border:0;border-radius:4px;padding:4px 10px}
footer{background:#f1f5fa;padding:24px 48px;font-size:13px} .legal{display:flex;flex-wrap:wrap;gap:8px 20px} .legal a{color:#1d2733;text-decoration:none}
@media (max-width:700px){.site-header{flex-wrap:wrap;padding:12px 16px;gap:12px}.site-header nav{order:3;width:100%;overflow:auto;gap:16px}h1{font-size:28px}footer{padding:16px}.cookie-banner{margin:0 16px 16px}}
`;

const heroSvg = () => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="880" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2a4a"/><stop offset="1" stop-color="#2f80cc"/></linearGradient></defs><rect width="880" height="300" fill="url(#g)"/>${Array.from({ length: 22 }, (_, j) => `<rect x="${j * 40 + 6}" y="${150 + ((j * 37) % 90)}" width="30" height="${150 - ((j * 37) % 90)}" fill="#071d33"/>`).join("")}<rect x="430" y="40" width="10" height="260" fill="#071d33"/></svg>`)}`;
const chartSvg = (j: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="220"><rect width="560" height="220" fill="#fff"/>${Array.from({ length: 12 }, (_, k) => { const h = 30 + ((k * 53 + j * 31) % 150); return `<rect x="${24 + k * 44}" y="${200 - h}" width="28" height="${h}" fill="${k > 8 ? "#005daa" : "#9cc3e8"}"/>`; }).join("")}<line x1="16" y1="200" x2="548" y2="200" stroke="#5b6876"/></svg>`)}`;

// Inline prototype images (data: URIs) shown as the file paths a real page would have
let imgN = 0;
const readable = (markup: string) => markup.replace(/ data-ix="\d+"/g, "")
  .replace(/src="data:image\/svg\+xml;utf8,([^"]+)"/g, (_, d) => `src="/media/${d.includes("linearGradient") ? "hero-toronto.jpg" : `charts/figure-${(imgN++ % 5) + 1}.png`}"`);

// Source view: the HTML without the prototype's data-ix markers, and the line each instance is on
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
    `Fix this ${r.category} issue on https://www.rbccm.com${p.path}`,
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
    page: { id: p.i, url: `https://www.rbccm.com${p.path}`, crawl },
    issues: list.map((it) => {
      const r = RULE_CATALOG[it.rule];
      return {
        id: `${p.i}-${it.k + 1}`, rule: r.id, title: r.title, priority: priority(r.severity), severity: r.severity, category: r.category,
        wcag: r.criterion ?? null, status: it.status, shared_pages: it.shared, selector: it.selector, html: it.snippet,
        how_to_fix: r.howToFix, references: r.refs.map((x) => x.url),
      };
    }),
  }, null, 2);
}

export function batchPrompt(p: PageView, list: Instance[], priority: (s: Severity) => string) {
  const byRule = new Map<string, Instance[]>();
  for (const it of list) byRule.set(it.rule, [...(byRule.get(it.rule) ?? []), it]);
  return [
    `Fix these ${list.length} issues on https://www.rbccm.com${p.path}. Return a patch per file.`, "",
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
