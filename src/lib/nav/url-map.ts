// The app's URL map (url-map.json, shared with the backend's crawler_ai/url_map.py): every route, its URL
// parameters and the values each may take. Navigation may only produce URLs that pass validateUrl.
import urlMap from "../../../url-map.json";

import { crawlsFor } from "@/lib/crawls-list";
import { RULE_CATALOG } from "@/lib/page-issues";
import { hasPage } from "@/lib/site-pages";
import { SITE_IDS, type SiteId } from "@/lib/sites";

type Param = { type: string; label?: string; default?: string; values?: string[]; extra?: string[]; labels?: Record<string, string> };
export type Route = { id: string; path: string; label: string; path_params?: Record<string, Param>; params: Record<string, Param> };
export type Chip = { name: string; value: string; label: string };
export type Validated = { ok: true; url: string; route: Route; site: SiteId | null; chips: Chip[] } | { ok: false; reason: string };

export const ROUTES = urlMap.routes as Route[];
const fail = (reason: string): Validated => ({ ok: false, reason });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const crawlIds = new Map<string, Set<string>>();
const crawlExists = (site: string, id: string) => {
  let s = crawlIds.get(site);
  if (!s) crawlIds.set(site, (s = new Set(crawlsFor(site as SiteId).map((c) => c.id))));
  return s.has(id);
};

function valueOk(p: Param, v: string, site: string | null): boolean {
  if (p.extra?.includes(v)) return true;
  switch (p.type) {
    case "enum": return !!p.values?.includes(v);
    case "list": return v !== "" && v.split(",").every((x) => p.values?.includes(x));
    case "int": return /^\d+$/.test(v);
    case "crawl": return /^\d+$/.test(v) && (!site || crawlExists(site, v));
    case "page": return /^\d+$/.test(v) && (!site || hasPage(site as SiteId, Number(v)));
    case "rule": return v in RULE_CATALOG;
    default: return true; // text
  }
}

// Checks an in-app path + query. On success returns the canonical URL: params in url-map order, params at their default left out.
export function validateUrl(href: string): Validated {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return fail("not an internal path");
  let u: URL;
  try { u = new URL(href, "http://x.invalid"); } catch { return fail("unparsable"); }
  const segs = u.pathname.replace(/\/+$/, "").split("/").slice(1);
  let hit: { route: Route; vars: Record<string, string>; statics: number } | null = null;
  for (const route of ROUTES) {
    const pat = route.path.split("/").slice(1);
    if (route.path === "/") { if (!segs.length || (segs.length === 1 && segs[0] === "")) hit = { route, vars: {}, statics: 0 }; continue; }
    if (pat.length !== segs.length) continue;
    const vars: Record<string, string> = {};
    let statics = 0, ok = true;
    for (let i = 0; i < pat.length && ok; i++) {
      if (pat[i].startsWith(":")) { try { vars[pat[i].slice(1)] = decodeURIComponent(segs[i]); } catch { ok = false; } }
      else if (pat[i] === segs[i]) statics++;
      else ok = false;
    }
    if (ok && (!hit || statics > hit.statics)) hit = { route, vars, statics };
  }
  if (!hit) return fail("no such route");
  const { route, vars } = hit;
  const site = vars.site ?? null;
  if (site !== null && !(SITE_IDS as string[]).includes(site)) return fail(`unknown site ${site}`);
  for (const [k, v] of Object.entries(vars)) {
    const p = route.path_params?.[k];
    if (p && !valueOk(p, v, site)) return fail(`bad ${k}`);
  }
  const given = new Map<string, string>();
  for (const [k, v] of u.searchParams) {
    const p = route.params[k];
    if (!p) return fail(`unknown param ${k}`);
    if (!valueOk(p, v, site)) return fail(`bad value for ${k}`);
    if (!given.has(k)) given.set(k, v);
  }
  const query: string[] = [];
  for (const [k, p] of Object.entries(route.params)) {
    const v = given.get(k);
    if (v === undefined || v === p.default) continue;
    let enc = encodeURIComponent(v);
    if (p.type !== "text") enc = enc.replace(/%3A/g, ":").replace(/%2C/g, ",");
    query.push(`${k}=${enc}`);
  }
  const path = route.path === "/" ? "/" : "/" + segs.map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
  const url = path + (query.length ? "?" + query.join("&") : "");
  return { ok: true, url, route, site: site as SiteId | null, chips: chipsOf(route, given) };
}

function chipsOf(route: Route, given: Map<string, string>): Chip[] {
  const chips: Chip[] = [];
  for (const [k, p] of Object.entries(route.params)) {
    const v = given.get(k);
    if (v === undefined || v === p.default) continue;
    let label: string;
    if (p.labels?.[v]) label = p.labels[v];
    else if (k === "crawl") label = `Crawl ${v}`;
    else if (k === "vs") label = v === "none" ? "No baseline" : `vs ${v}`;
    else if (k === "q") label = `“${v}”`;
    else if (k === "links") label = `Links to ${v}`;
    else if (k === "issue") label = `Issue ${v}`;
    else if (p.type === "list") label = v.split(",").map((x) => p.labels?.[x] ?? (/^P\d$/.test(x) ? x : cap(x))).join(", ");
    else label = /^P\d$/.test(v) ? v : cap(v);
    chips.push({ name: k, value: v, label });
  }
  return chips;
}

export const chipsFor = (url: string): Chip[] => { const v = validateUrl(url); return v.ok ? v.chips : []; };

// Builds a URL from a route id; null/empty params are left out. Returns the validated result.
export function buildUrl(routeId: string, site: string | null, pathParams: Record<string, string | number> = {}, params: Record<string, string | number | null | undefined> = {}): Validated {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) return fail(`unknown route ${routeId}`);
  const vars: Record<string, string> = { ...(site ? { site } : {}), ...Object.fromEntries(Object.entries(pathParams).map(([k, v]) => [k, String(v)])) };
  const path = route.path.split("/").map((s) => (s.startsWith(":") ? encodeURIComponent(vars[s.slice(1)] ?? "") : s)).join("/");
  const qs = Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return validateUrl(path + (qs ? "?" + qs : ""));
}

export const routeById = (id: string) => ROUTES.find((r) => r.id === id);
