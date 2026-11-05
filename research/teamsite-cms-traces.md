# TeamSite / LiveSite traces in the public HTML of www.rbccm.com

Date of investigation: 2026-11-05. Method: `curl -sL --compressed -A "Mozilla/5.0"` of raw server HTML, about 17 requests in total, 1 to 1.5 s apart. Snippets are trimmed. Anything marked (guess) is inference, not verified against the CMS.

## 1. URLs checked

| # | URL | Page type |
|---|-----|-----------|
| 1 | https://www.rbccm.com/en/ | Homepage |
| 2 | https://www.rbccm.com/en/insights/2026/10/margins-matter-in-us-midterm-elections | Insights article |
| 3 | https://www.rbccm.com/en/insights/podcasts/strategic-alternatives | Podcast page |
| 4 | https://www.rbccm.com/en/insights/rbc-research | Research / reports hub |
| 5 | https://www.rbccm.com/en/about-us/in-the-media | Media hub (also lists news-release cards) |
| 6 | https://www.rbccm.com/en/insights/story?dcr=templatedata/article/news/data/2026/09/0923_rbc_capital_markets_awarded_general_clearing_member_status | News release (DCR-driven; reached via a 301 from /rbccm/insights/story.page?dcr=...) |
| 7 | https://www.rbccm.com/en/about-us/conferences | Events listing page |
| 8 | https://www.rbccm.com/en/about-us/leadership | People / bios |
| 9 | https://www.rbccm.com/en/expertise/global-markets | Sector / product page |
| 10 | https://www.rbccm.com/en/careers/programs | Careers |
| 11 | https://www.rbccm.com/fr/ | French homepage |

That is 11 pages. No individual event or single-person bio URL was found in the links followed. Bios are on-page anchors on /leadership (`#bios`, `href="#derek-neldner"`), and events are cards on /conferences. Also fetched: `/robots.txt` and `/sitemap.xml`. The sitemap just meta-refreshes to `/en/error.page`, so it is unusable for discovery. robots.txt disallows `/rbccm`, `/rbccm_fr`, `/en/sitemap` and `/fr/default.sitemap`.

A request to `/en/insights/templatedata/article/story/data/2026/10/canadian-equity-compass` returned 404, even though the same path appears as tile `href`s on the podcast and article pages. The tile links are probably rewritten or are served only in a particular context (guess).

## 2. Fingerprints found

"All" means all 11 pages. Component counts per page ranged from 5 to 15.

| Pattern | Example (trimmed) | Pages | Likely meaning |
|---|---|---|---|
| LiveSite component delimiters `<!--ls:begin[component-<id>]-->` ... `<!--ls:end[component-<id>]-->` | `<!--ls:begin[component-1786807680025]-->` | All | One LiveSite component instance placed on the page. The numeric id looks like a millisecond epoch timestamp (e.g. 1786807680025 is about Aug 2026), so it is probably the creation time of the component instance (guess). |
| Wrapper `div.ls-cmp-wrap` with `id="w<id>"` | `<div class="ls-cmp-wrap ls-1st" id="w1786807680025">` | All | LiveSite component wrapper. `ls-1st` marks the first component in a layout area. The `w` id equals the component id. |
| Inner `div.iw_component` with `id="<id>"` | `<div class="iw_component" id="1786807680025">` | All | Wrapper around the rendered output of the component. This is the best single element boundary for "which component produced this node". |
| Layout grid `div.ls-canvas`, `ls-row`, `ls-fxr`, `ls-row-clr`, `ls-col`, `ls-col-body`, `ls-area`, `ls-area-body` | `id="ls-row-4-col-1-row-1-area-1"` | All | LiveSite "fixed layout" grid: rows, columns and areas into which components are dropped. Area ids such as `ls-row-4-col-1-row-1-area-1` are stable names for template regions. `ls-gen<number>-...` ids are auto-generated and not stable. |
| `<!--fixed-layout-->` comment | `<!--fixed-layout-->` | All | Marks the page layout type (fixed layout), consistent with the stylesheet below. |
| Layout stylesheet `/iwov-resources/fixed-layout/rbccm_full_width.css` | `<link ... href="/iwov-resources/fixed-layout/rbccm_full_width.css">` | All | Only `iwov-resources` (the TeamSite "iwov" prefix) path seen. Identifies the layout template "rbccm_full_width". |
| Head region comments `ls:begin[stylesheet]`, `[script]`, `[head-injection]`, `[custom-meta-data]`, `[meta-keywords]`, `[meta-description]`, `[meta-vpath]`, `[meta-page-locale-name]`, `[favicon]`, `[tracker-injection]`, `[page_track]`, `[body]` | `<!--ls:begin[head-injection]-->` | All | Template-level regions of the page template. Each wraps content fed from page properties or injected by the template. Content inside `[head-injection]` carries the canonical, hreflang and og: tags, plus JSON-LD on the podcast page. |
| Empty `<meta name="vpath" content="">` and `<meta name="page-locale-name" content="">` | `<meta name="vpath" content="">` | All | Template emits these but the values are empty on every page, so no page path leaks (the vpath one is probably meant to carry the TeamSite virtual path, guess). |
| Links of form `/rbccm/insights/story.page?dcr=templatedata/article/news/data/YYYY/MM/<mmdd_slug>` | `href="/rbccm/insights/story.page?dcr=templatedata/article/news/data/2026/09/0923_rbc_capital_markets_awarded..."` | Media hub (about 4 cards), the news-release page itself (canonical, og:url, hreflang) | Classic TeamSite/LiveSite DCR addressing: `<page>.page?dcr=<path to DCR under templatedata/>`. The path contains the DCR type (`article/news`) and the record name. **This is the only place a real DCR identifier appears.** |
| Links of form `/en/insights/templatedata/article/story/data/YYYY/MM/<slug>` | `href="/en/insights/templatedata/article/story/data/2026/10/why-canada-can-be-ais-democratic-superpower"` | Podcast page (8), article page (3) | The same DCR path scheme for "story" records, used as tile hrefs. Directly requesting one returned a 404 (see section 1). |
| Friendly article URL `/en/insights/YYYY/MM/<slug>` | `/en/insights/2026/10/margins-matter-in-us-midterm-elections` | Article page and many listing links | The slug and year/month match the DCR path `templatedata/article/story/data/YYYY/MM/<slug>`, so the DCR path can probably be derived from the friendly URL (guess; verified only by pattern in link lists). The article page itself contains no `dcr` string for its own record. |
| Article body markup `div.story-main > div.article-attribution`, `h2.key-points-heading`, `div.keypoints`, `div.article-img-sel`, `div.article-content` | `<div class="story-main"> <div class="article-attribution">By <strong>Helima Croft</strong>...` | Article page; `.article-content` also on the news release | Output of a DCR presentation template: fixed field slots (author, date, key points, body). `article-content` is the WYSIWYG body field of the DCR. |
| News release layout `div.article > ... div#content-panel`, `h1`, `div.news-date`, `div#description.lead`, `div.article-content` | `<div class="news-date">Published September 30, 2026</div>` | News release | Same DCR-driven "article" presentation. Title, date, lead and body are separate DCR fields. |
| TinyMCE leftovers `data-mce-style`, `data-mce-href`, `data-mce-bogus`, `data-mce-selected` | `data-mce-style="margin-bottom: 40px;"` | Homepage (a few) | Content was authored in a TinyMCE WYSIWYG editor and pasted as raw HTML into a component. Strong signal of hand-written or WYSIWYG-authored custom HTML. |
| Inline `style="..."` and `&#xA;` in attribute values | `style="&#xA;        background: #ffffff;&#xA;        "` | Homepage | Typical of an XSL/XSLT-rendered template with indented attributes (guess). Not a reliable fingerprint. |
| Feature-specific class prefixes `rbccm-stats`, `rbccm-featured-conferences__*`, `rbccm-upcoming-conferences__*`, `rbccm-filtered-content__card-title` | `<section class="rbccm-stats rbccm-stats--light-blue">` | Homepage, conferences, media hub | BEM-style custom components built by the web team. Each is loaded together with its own CSS/JS (e.g. `statistics-ticker.css`). The class prefix maps to a code module and is a good grouping key, but it does not identify the CMS record. |
| Per-component asset includes inside the component, e.g. `<link rel="stylesheet" href="/assets/rbccm/css/sub/test/statistics-ticker.css">` | `<div class="iw_component" ...><link rel="stylesheet" href="/assets/rbccm/css/sub/test/statistics-ticker.css">` | Homepage, conferences | Component brings its own CSS/JS. Directory names like `sub/test/` and `podcast-episode-replacer.js` hint at the owning feature. |
| Debug comment `<!-- rbccm-fc-events debug: totalEvents=126 featured=3-->` | as shown | Conferences | A server-rendered, data-driven component (events DCRs aggregated) leaving a debug comment. The only non-`ls:` comment of real value. 126 events indicates a loop over DCRs (guess). |
| Commented-out old HTML `<!--<a class="img-stretch" ...-->` | as shown | Podcast, global markets, media hub | Dead markup left in component HTML. A crawler should strip comments before analysis. |
| Site static assets under `/assets/rbccm/css|js|images/...` | `/assets/rbccm/css/rbccm.2.css` | All | Site-level assets. Template-wide CSS and JS (`rbccm.2.css`, `unified.css`, `nav.min.js`) indicate the shared theme. |
| JSON-LD `<script type="application/ld+json">` | present | Podcast page only (2 blocks) | Page-specific structured data, apparently hand-authored or custom-injected. Not CMS ids. |
| `<meta name="generator">` | not present | None | No generator meta tag. |
| `data-dcr*`, `data-component*`, `data-template*`, `data-cms*` attributes | none | None | The site does not currently emit any such attributes. Only Bootstrap and form `data-*` attributes (`data-bs-toggle`, `data-toggle`, `data-field-*`) exist. |
| Words `teamsite`, `livesite`, `/iw/`, `iwov` (other than the layout CSS) | none | None | No other direct product name leakage. Prefix `ls-` = LiveSite; `iw_`/`iwov` = Interwoven (TeamSite's former name). |

## 3. Template-level vs page-specific

Consistent across all pages (template and layout level):

- The `ls:begin/end[...]` head regions, `[body]`, `ls-canvas`, `ls-row`, `ls-area` grid, `<!--fixed-layout-->` and the `rbccm_full_width.css` link are on every page, including `/fr/`.
- The head and body skeleton, the site CSS/JS bundle, and the first component (header/nav, about 14 KB) and last component (footer, about 12.5 KB). The header/footer are components in the layout rather than part of the template, and their HTML hashes differ slightly between pages (probably active-nav state or language; I did not diff them).
- Region ids like `ls-row-4-col-1-row-1-area-1`, `ls-row-3-area-1` repeat across pages and name the layout slot.

Page-specific (component and content level):

- **Component ids are not shared across pages.** Each page carries its own batch of ids with a common prefix, e.g. home `17868076800xx`, article `171865035313x`, conferences `177672202xxxx`, French home `17868076859xx`. Even the header and footer have different ids on every page. So the id identifies a component instance on one page (probably copied when the page was created), not a reusable library component. A shared id appears only if two pages were never copied from one another.
- The news-release page, rendered from a DCR via `story.page`, uses component ids of the template page `15544990812xx` (2019 timestamps), i.e. a different batch from the article page. Pages built from the same DCR template presumably share these ids across all stories of that type (guess; only one news release was fetched).
- The `?dcr=` path and the friendly URL slug are the only per-record keys.

Can elements inside body text be tied to a DCR?

- At the container level, yes in principle. `div.article-content` (and `story-main`, `article-attribution`, `news-date`, `#description`) are DCR field slots, so everything inside `.article-content` comes from one DCR record. The record id is the page URL (news releases: the `dcr=` canonical; articles: probably derivable from the friendly URL slug, guess).
- Below that, no. Paragraphs, images and links inside the body are one WYSIWYG blob with no per-element ids. Images inside the body have inline `style="max-width: 100%;"` and an `alt`, but no attribute that distinguishes them from hand-written HTML.

## 4. What can and cannot be mapped reliably

Reliable:

- Template or layout (page level): yes, via `rbccm_full_width.css`, the `ls:begin[...]` head regions and `ls-row-*-area-*` ids.
- Component instance on the page: yes, via the nearest ancestor `div.iw_component` (its `id`) and its surrounding `ls:begin[component-<id>]` comment. Use the id together with the page URL as the key for "edit this component on this page in TeamSite".
- Whether a node sits in header/nav/footer: yes, first/last component per page (or `footer[role=contentinfo]`).
- A feature or module: yes, by BEM prefix and per-component CSS/JS name (code ownership, not CMS ownership).
- DCR-driven pages: for news releases the `dcr=` URL (canonical) gives the DCR path. The DCR field slot (body, title, date, lead) is given by the class names above.

Not reliable or not possible:

- Component type or name: only a numeric id is exposed, never a component or template name. You would need a lookup (TeamSite UI or the web team) to turn the id into a name. Not possible from HTML alone.
- Whether a component is hand-written custom HTML or a reusable CMS component: nothing in the HTML says. Hints only: TinyMCE `data-mce-*` attributes, inline styles, and `&#xA;` suggest authored HTML or WYSIWYG. BEM-prefixed sections that load their own CSS suggest a dev-built component. Treat that as a heuristic.
- DCR id for articles (`/en/insights/YYYY/MM/slug`): no explicit marker; only the URL pattern (guess).
- Hub pages (media, conferences, research listing, homepage tiles, related stories) aggregate many DCRs inside one component. A single card cannot be tied back to its DCR except where its link contains `?dcr=` or `templatedata/`. Some of those links point at the DCR path rather than the public URL.
- Items injected client-side (the related-story JS in the news release builds `div.related-story` at runtime): raw HTML cannot map these. They only exist in a rendered DOM.

## 5. Recommendations for the crawler

Parse the raw (server) HTML with a real parser, keep comments for `ls:` markers, and also run the issue checks on the rendered DOM where needed.

1. For every flagged element, walk up to the closest `div.iw_component[id]` (or `div.ls-cmp-wrap[id^="w"]`). Record `component_id`, the page URL, and the layout area id from the nearest ancestor with `id^="ls-row-"` and `ls-area`. Output as "TeamSite component `<id>` on `<page>`, area `<ls-row-...-area-N>`".
2. If the element is inside `.article-content`, `.story-main`, `.news-date` or `#description`: classify as "DCR body/field". For the DCR path:
   - news release: read `<link rel="canonical">` and extract the part after `dcr=`;
   - insight article: build `templatedata/article/story/data/<YYYY>/<MM>/<slug>` from the URL (guess; confirm with the web team).
3. If the element is in the first or last component of the page (or `<footer role="contentinfo">`, the nav): classify as "shared header/footer, fix in layout/template (same fix applies site-wide)". Dedupe such issues across pages by comparing normalised HTML (strip whitespace, ids).
4. If the element is in a component whose class prefix is one of `rbccm-*` (e.g. `rbccm-stats`, `rbccm-featured-conferences`), classify as "custom coded feature" and group by that prefix; the owning code is the matching CSS/JS under `/assets/rbccm/...`.
5. If the element has or is inside HTML carrying `data-mce-*` or large inline `style=` blocks, classify as "authored HTML in a component (WYSIWYG/pasted)".
6. Template-level checks: collect the `ls:begin[...]` region names and the `rbccm_full_width.css` link to identify "template" problems (missing `lang`, duplicate/empty meta). Note `meta vpath` and `page-locale-name` are always empty, so do not rely on them.
7. Strip HTML comments before running a11y/SEO rules (dead commented-out markup exists), but keep `ls:` comments for the mapping step. Ignore `<!-- rbccm-fc-events debug ... -->` for rules.
8. Treat component ids as per-page. Group identical issues across pages by normalised component HTML hash, not by id, to find shared source. Same-hash components on many pages usually mean a template or copied component.
9. Follow `?dcr=` and `templatedata/` links as signals of DCR-backed records, and note their paths in an index of DCR-to-page mappings. Redirects exist (`/rbccm/insights/story.page?dcr=...` returns 301 to `/en/insights/story?dcr=...`), so store the canonical form.
10. Be careful with robots.txt: it disallows `/rbccm`, `/rbccm_fr`, `/en/insights/data` and others. The sitemap is a redirect to an error page, so seed from nav links and listing pages instead.

## 6. Suggested additions for the web team (TeamSite templates)

Small, low-risk changes that would make the mapping exact:

1. In the component wrapper template (where `iw_component` is emitted), add `data-component-id`, `data-component-name` (the TeamSite component or template name) and `data-component-type` (`dcr`, `html`, `library`), for example `<div class="iw_component" id="..." data-component-name="StoryBody" data-component-type="dcr">`. This makes the "hand-written vs component" question explicit.
2. In every DCR presentation template (story, news, podcast, conference, bio), add on the outermost element `data-dcr="templatedata/article/story/data/2026/10/slug"` and the DCR type (`data-dcr-type="article/story"`). Optionally `data-dcr-field="body"` on field containers such as `.article-content`, `.news-date`, `.lead`. On aggregated lists, add `data-dcr` on each card so a card can be traced to its record even without an `?dcr=` link.
3. Emit the template name and page path in the head: fill the existing `<meta name="vpath">` (currently empty) with the TeamSite virtual path (or its `.page` path), and add `<meta name="ls-template" content="rbccm_full_width">` plus a layout-version value. The `meta` slots already exist; they just return empty.
4. Optionally output an HTML comment with the DCR path at the start of each DCR-rendered block (`<!--dcr:templatedata/...-->`), as LiveSite already does with `ls:begin`. This helps even when attribute-stripping is a concern.
5. Remove debug and dead comments (`rbccm-fc-events debug`, commented-out `<a class="img-stretch" ...>`) or standardise them into a `<!--ls:...-->`-style prefix so tools can ignore them reliably.
6. Make the friendly URL to DCR mapping explicit, e.g. `<link rel="alternate" type="application/json" href=".../templatedata/...">` or a `data-dcr` on `<body>`, so article pages (which currently expose no record id) can be mapped without assuming the URL pattern.

Open questions for the web team: what name does TeamSite give the components behind ids like `1786807680025`; whether the `templatedata/article/story/data/...` URLs are meant to resolve publicly; and whether the same DCR templates (story, news, podcast) are reused for the French site.
