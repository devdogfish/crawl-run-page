// Refresh public HTTP captures, deduplicated stylesheets, and static HTML findings.
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const data = new URL("../src/data/", import.meta.url);
const inventory = JSON.parse(await readFile(new URL("public-pages.json", data), "utf8"));
const sites = ["rbccm", "rbcits"];
const maximumBytes = 18_000_000;
const capturedAt = new Date().toISOString();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const webUrl = (value, base) => {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const assetUrl = (value, base) => {
  if (!value) return undefined;
  if (value.startsWith("#") || /^data:(image|font)\//i.test(value)) return value;
  return webUrl(value, base);
};

function absoluteCss(css, base) {
  return css
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi, (_, a, b, c) => {
      const value = assetUrl((a ?? b ?? c).trim(), base);
      return value ? `url("${value.replaceAll('"', "%22")}")` : 'url("")';
    })
    .replace(/(@import\s+)(["'])(.*?)\2/gi, (_, prefix, _quote, value) => `${prefix}"${assetUrl(value, base) ?? ""}"`);
}

function srcsetUrls(value, base) {
  // Existing data URLs can contain commas and are already absolute.
  if (/data:/i.test(value)) return value;
  return value.split(",").flatMap((candidate) => {
    const [source, ...descriptor] = candidate.trim().split(/\s+/);
    const url = source && assetUrl(source, base);
    return url ? [[url, ...descriptor].join(" ")] : [];
  }).join(", ");
}

function cleanDocument(doc, base) {
  doc.querySelectorAll("script, iframe, frame, frameset, object, embed, applet, portal, base, template, meta[http-equiv], svg foreignObject, svg animate, svg set, [data-mce-p-type*='javascript' i]")
    .forEach((element) => element.remove());
  doc.querySelectorAll('img[width="1"][height="1"]').forEach((image) => image.remove());
  const comments = doc.createTreeWalker(doc, doc.defaultView.NodeFilter.SHOW_COMMENT);
  const commentNodes = [];
  while (comments.nextNode()) commentNodes.push(comments.currentNode);
  for (const comment of commentNodes) comment.remove();

  for (const element of doc.querySelectorAll("*")) {
    for (const { name, value } of [...element.attributes]) {
      if (/^(on|data-ix$|data-capture-target$|data-mce-html$|srcdoc$|autoplay$|ping$|action$|formaction$|target$|formtarget$|integrity$|nonce$)/i.test(name)) {
        element.removeAttribute(name);
      } else if (/^(src|href|xlink:href|poster|background)$/i.test(name) && value.trim()) {
        const absolute = assetUrl(value.trim(), base);
        if (absolute) element.setAttribute(name, absolute);
        else element.removeAttribute(name);
      } else if (name === "srcset") {
        element.setAttribute(name, srcsetUrls(value, base));
      } else if (name === "style") {
        element.setAttribute(name, absoluteCss(value, base));
      }
    }

    if (element.localName === "style") element.textContent = absoluteCss(element.textContent, base);
    if (element.matches("link") && !element.relList.contains("stylesheet") && !element.relList.contains("canonical") && !element.relList.contains("alternate")) element.remove();
    if (element.matches("img")) {
      const lazySource = element.getAttribute("data-src") || element.getAttribute("data-lazy");
      const lazyUrl = lazySource && assetUrl(lazySource, base);
      if (lazyUrl && (!element.getAttribute("src") || element.getAttribute("src").startsWith("data:"))) element.setAttribute("src", lazyUrl);
      const lazySet = element.getAttribute("data-srcset");
      if (lazySet && !element.hasAttribute("srcset")) element.setAttribute("srcset", srcsetUrls(lazySet, base));
      element.removeAttribute("loading");
    }
    if (element.matches("audio, video")) element.setAttribute("preload", "none");
  }
}

const inaccessible = (element) => element.closest('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"], noscript');
const name = (element) => Boolean(
  element.textContent.trim()
  || element.getAttribute("aria-label")?.trim()
  || element.getAttribute("aria-labelledby")?.trim()
  || element.getAttribute("title")?.trim()
  || element.querySelector('img[alt]:not([alt=""]), svg title, [aria-label]'),
);

function selectorFor(element, doc) {
  if (element.id && /^[a-zA-Z_][\w-]*$/.test(element.id) && doc.querySelectorAll(`#${element.id}`).length === 1) return `#${element.id}`;
  const tag = element.localName;
  if (tag === "html" || tag === "head" || tag === "body") return tag;
  const parent = element.parentElement;
  const siblings = [...parent.children].filter((sibling) => sibling.localName === tag);
  const position = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(element) + 1})` : "";
  return `${selectorFor(parent, doc)} > ${tag}${position}`;
}

function extractFindings(doc) {
  const findings = [];
  const chosen = new Set();
  function add(element, rule, pattern, onPage = true, origin = "static-html") {
    if (!element || chosen.has(element) || findings.length >= 18) return;
    const selector = selectorFor(element, doc);
    const markup = element.cloneNode(true);
    markup.querySelectorAll("[data-capture-target]").forEach((node) => node.removeAttribute("data-capture-target"));
    const fullMarkup = markup.outerHTML;
    const snippet = fullMarkup.length <= 800 ? fullMarkup : fullMarkup.match(/^<[^>]*>/)?.[0] ?? fullMarkup;
    findings.push({ rule, pattern, selector, snippet, onPage, origin });
    element.setAttribute("data-capture-target", encodeURIComponent(selector));
    chosen.add(element);
  }

  for (const image of doc.querySelectorAll("body img:not([alt]):not([title]):not([aria-label]):not([aria-labelledby])")) {
    if (!inaccessible(image) && !["presentation", "none"].includes(image.getAttribute("role"))) add(image, "image-alt", "img without alt");
  }
  for (const button of doc.querySelectorAll("body button")) {
    if (!inaccessible(button) && !name(button)) add(button, "button-name", "button without name");
  }
  for (const link of doc.querySelectorAll("body a[href]")) {
    if (!inaccessible(link) && !name(link)) add(link, "link-name", "a[href] without name");
  }
  let previousLevel = 0;
  for (const heading of doc.querySelectorAll("body h1, body h2, body h3, body h4, body h5, body h6")) {
    if (inaccessible(heading) || !heading.textContent.trim()) continue;
    const level = Number(heading.localName[1]);
    if (previousLevel && level > previousLevel + 1) add(heading, "heading-order", `h${previousLevel} followed by h${level}`);
    previousLevel = level;
  }
  if (![...doc.querySelectorAll('meta[name="description" i]')].some((meta) => meta.content.trim())) add(doc.head, "meta-description", "head without description", false);

  const stylesheet = [...doc.querySelectorAll('head link[rel~="stylesheet"][href]:not([media]):not([disabled])')]
    .find((link) => new URL(link.href).pathname.startsWith("/assets/"));
  if (stylesheet) add(stylesheet, "render-blocking-resources", 'head link[rel="stylesheet"]', false, "sample");
  return findings;
}

async function request(url) {
  const start = performance.now();
  const response = await fetch(url, {
    headers: { "User-Agent": "SiteLens portfolio snapshot capture/1.0" },
    signal: AbortSignal.timeout(18_000),
  });
  const responseMs = Math.round(performance.now() - start);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { response, responseMs };
}

async function capturePage(page) {
  const { response, responseMs } = await request(page.url);
  if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("Response is not HTML");
  if (new URL(response.url).hostname !== new URL(page.url).hostname) throw new Error(`Unexpected redirected host: ${response.url}`);
  const dom = new JSDOM(await response.text(), { url: response.url });
  const { document } = dom.window;
  try {
    if (!document.title.trim() || document.body.textContent.trim().length < 200) throw new Error("HTML appears incomplete");
    const base = webUrl(document.baseURI, response.url) ?? response.url;
    cleanDocument(document, base);
    const findings = extractFindings(document);
    const styles = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((link) => link.href);
    return {
      snapshot: { sourceUrl: page.url, finalUrl: response.url, capturedAt, status: response.status, responseMs, html: dom.serialize() },
      findings,
      styles,
    };
  } finally {
    dom.window.close();
  }
}

const snapshots = {};
const styles = new Set();
const findings = { provenance: "Conservative static checks on stored public HTML. Sample entries illustrate the audit workflow on elements that exist in the capture." };
await Promise.all(sites.map(async (site) => {
  const siteFindings = {};
  findings[site] = siteFindings;
  for (const page of inventory[site]) {
    try {
      const captured = await capturePage(page);
      snapshots[page.url] = captured.snapshot;
      siteFindings[page.id] = captured.findings;
      for (const stylesheet of captured.styles) styles.add(stylesheet);
      console.log(`${site}/${page.id} ${captured.snapshot.html.length} chars · ${captured.findings.length} findings`);
    } catch (error) {
      console.warn(`Skipped ${site}/${page.id} ${page.url}: ${error.message}`);
    }
    await delay(275);
  }
}));

const expected = sites.reduce((sum, site) => sum + inventory[site].length, 0);
if (Object.keys(snapshots).length !== expected) throw new Error("Incomplete capture. The stored data was left unchanged.");

const stylesheets = {};
const queued = [...styles].sort();
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queued.length) {
    const url = queued.shift();
    try {
      const { response } = await request(url);
      const css = await response.text();
      if (!css.trim() || /^\s*<(?:!doctype|html)/i.test(css)) throw new Error("Response is not CSS");
      stylesheets[url] = absoluteCss(css, response.url);
    } catch (error) {
      console.warn(`Stylesheet will stream from its source: ${url} (${error.message})`);
    }
    await delay(125);
  }
}));

const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
const files = {
  "html-snapshots.json": JSON.stringify(sorted(snapshots)) + "\n",
  "html-stylesheets.json": JSON.stringify(sorted(stylesheets)) + "\n",
  "captured-findings.json": JSON.stringify(findings, null, 2) + "\n",
};
const unchanged = (await readdir(data)).filter((name) => name.endsWith(".json") && !Object.hasOwn(files, name));
const unchangedSizes = await Promise.all(unchanged.map((name) => stat(new URL(name, data)).then(({ size }) => size)));
const total = [...Object.values(files).map((file) => Buffer.byteLength(file)), ...unchangedSizes].reduce((sum, size) => sum + size, 0);
if (total > maximumBytes) throw new Error(`Data cap exceeded: ${total.toLocaleString()} bytes. Reduce the URL inventory and capture again.`);
for (const [name, contents] of Object.entries(files)) await writeFile(new URL(name, data), contents);
console.log(`Captured ${Object.keys(snapshots).length} pages and ${Object.keys(stylesheets).length} unique stylesheets. JSON total: ${total.toLocaleString()} bytes.`);
