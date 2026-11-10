import captures from "@/data/html-snapshots.json";
import stylesheets from "@/data/html-stylesheets.json";

type PageSource = { url: string; sourceUrl?: string };
type Snapshot = {
  sourceUrl: string;
  finalUrl: string;
  capturedAt: string;
  status: number;
  responseMs: number;
  html: string;
};

const snapshots: Record<string, Snapshot> = captures;
const cssByUrl: Record<string, string> = stylesheets;
const unavailable = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Page HTML unavailable</title></head>\n<body><main><p>Page HTML is unavailable for this record.</p></main></body></html>';

export function getStoredSnapshot(page: PageSource): Snapshot | undefined {
  const url = page.sourceUrl ?? page.url;
  return Object.hasOwn(snapshots, url) ? snapshots[url] : undefined;
}

export function getStoredDocument(page: PageSource, instances: readonly { k: number; selector: string; status?: string }[]): string {
  const snapshot = getStoredSnapshot(page);
  if (!snapshot) return unavailable;

  const markers = new Map(instances.filter(({ status }) => status !== "fixed")
    .map(({ selector, k }) => [encodeURIComponent(selector), k]));
  return snapshot.html.replace(/ data-capture-target="([^"]*)"/g, (_, target: string) => {
    const marker = markers.get(target);
    return marker === undefined ? "" : ` data-ix="${marker}"`;
  });
}

const fromAttribute = (value: string) => value.replaceAll("&amp;", "&");
const toAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

export function prepareStoredPreview(html: string): string {
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; media-src https:; base-uri https:; form-action 'none'";
  return html.replace(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    if (!/\brel="[^"]*\bstylesheet\b[^"]*"/i.test(tag)) return tag;
    const href = tag.match(/\bhref="([^"]*)"/i)?.[1];
    const url = href && fromAttribute(href);
    if (!url || !Object.hasOwn(cssByUrl, url)) return tag;
    const css = cssByUrl[url].replace(/<\/style/gi, "\\3c /style");
    const media = tag.match(/\smedia="[^"]*"/i)?.[0] ?? "";
    return `<style data-source-url="${toAttribute(url)}"${media}>${css}</style>`;
  }).replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}
