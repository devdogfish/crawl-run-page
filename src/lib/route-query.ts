import { useSearchParams } from "react-router";
import { crawlsFor } from "@/lib/crawls-list";
import { RULE_CATALOG } from "@/lib/page-issues";
import { PRIORITIES, PRIORITY } from "@/lib/priority";
import { CATEGORIES, PAGE_TYPES, RULES, YEARS, baselinesFor, crawlChoices, defaultCrawl, yearOf } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

export const pageScopeDefaults = { type: "all", year: "all", sub: "" };
export const issueScopeDefaults = { pri: "all", cat: "all", markup: "all", auditRule: "", el: "all", seg: "all" };

const types = PAGE_TYPES.map(({ id }) => id);
const categories = CATEGORIES.map(({ id }) => id);
const yearValues = YEARS.map(String);

export function readCrawlScope(site: SiteId, crawl: string, baseline: string, compareByDefault = true) {
  const selected = (compareByDefault ? crawlChoices(site) : crawlsFor(site)).find(({ id }) => id === crawl) ?? defaultCrawl(site);
  const baselines = baselinesFor(site, selected.id);
  const vs = baseline === "none" ? "none" : baselines.find(({ id }) => id === baseline)?.id ??
    (compareByDefault ? baselines[0]?.id : null) ?? "none";
  return { crawl: selected.id, vs };
}

const validValue = (value: string, choices: readonly string[], fallback: string) => choices.includes(value) ? value : fallback;
const listValue = (value: string, choices: readonly string[]) => choices.filter((entry) => value.split(",").includes(entry)).join(",") || "all";

export function readRouteQuery<S extends Record<string, string>>(site: SiteId, defaults: S, params: URLSearchParams, compareByDefault = true): S {
  const state: Record<string, string> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = params.get(key);
    if (value == null) continue;
    switch (key) {
      case "type": state[key] = validValue(value, types, "all"); break;
      case "year": state[key] = validValue(value, [...yearValues, "none"], "all"); break;
      case "pri": state[key] = listValue(value, PRIORITIES); break;
      case "cat": state[key] = listValue(value, categories); break;
      case "markup": state[key] = validValue(value, ["shared", "page"], "all"); break;
      case "seg": state[key] = validValue(value, ["new", "fixed"], "all"); break;
      case "change": state[key] = validValue(value, ["new", "changed", "removed"], "all"); break;
      case "status": state[key] = validValue(value, ["active", "failed", "success"], "all"); break;
      case "band": state[key] = validValue(value, ["good", "fair", "poor"], "all"); break;
      case "worst": state[key] = validValue(value, [...PRIORITIES, "none"], "all"); break;
      case "tab": state[key] = validValue(value, ["preview", "source"], "issues"); break;
      case "issue": state[key] = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? value : ""; break;
      case "rule": state[key] = validValue(value, RULES.map(({ id }) => id), "none"); break;
      case "auditRule": state[key] = Object.hasOwn(RULE_CATALOG, value) ? value : ""; break;
      case "sub": state[key] = /^[\w.-]+$/.test(value) ? value : ""; break;
      case "sort": state[key] = validValue(value, defaults.sort === "priority"
        ? ["priority", "pages", "elements", "new"]
        : ["worst", "changed", "path", "matches", ...categories.map((cat) => `cat:${cat}`)], defaults.sort); break;
      default: state[key] = value;
    }
  }
  if ("crawl" in state) {
    const scope = readCrawlScope(site, state.crawl, params.get("vs") ?? "", compareByDefault);
    Object.assign(state, scope);
    if (scope.vs === "none" && "change" in state) state.change = "all";
  }
  return state as S;
}

export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value != null && value !== "") params.set(key, String(value));
  return params.size ? `?${params}` : "";
}

export function useRouteQuery<S extends Record<string, string>>(site: SiteId, defaults: S, compareByDefault = true) {
  const [params, setParams] = useSearchParams();
  const state = readRouteQuery(site, defaults, params, compareByDefault);
  const set = (patch: Partial<S>) => {
    const next = new URLSearchParams();
    for (const key of Object.keys(defaults)) {
      const value = patch[key] ?? state[key];
      if (value !== defaults[key] || (key === "vs" && "crawl" in patch)) next.set(key, value);
    }
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return [state, set, params.toString()] as const;
}

export function inPageScope(page: { type: string; path: string }, { type, year, sub }: typeof pageScopeDefaults) {
  const folder = page.path.split("?")[0].split("/")[2] ?? "";
  return (type === "all" || page.type === type) &&
    (year === "all" || (year === "none" ? yearOf(page.path) == null : String(yearOf(page.path)) === year)) &&
    (!sub || folder === (sub === "__root__" ? "" : sub));
}

export const folderLabel = (sub: string) => sub === "__root__" ? "Root pages" : sub;

export function matchesIssueScope(hit: { rule: string; shared: boolean; pattern: string }, scope: Omit<typeof issueScopeDefaults, "seg">) {
  const rule = RULE_CATALOG[hit.rule];
  return (!scope.auditRule || scope.auditRule === hit.rule) &&
    (scope.el === "all" || scope.el === hit.pattern) &&
    (scope.markup === "all" || hit.shared === (scope.markup === "shared")) &&
    (scope.pri === "all" || scope.pri.split(",").includes(PRIORITY[rule.severity])) &&
    (scope.cat === "all" || scope.cat.split(",").includes(rule.category));
}

export function returnPath(value: string, site: SiteId, fallback: string) {
  const [path] = value.split("?");
  const rulePrefix = `/${site}/issues/`;
  const crawlPrefix = `/${site}/crawls/`;
  return path === `/${site}/pages` || path === `/${site}/issues` || path === `/${site}/crawls` ||
    (path.startsWith(rulePrefix) && Object.hasOwn(RULE_CATALOG, path.slice(rulePrefix.length))) ||
    (path.startsWith(crawlPrefix) && /^\d+$/.test(path.slice(crawlPrefix.length))) ? value : fallback;
}
