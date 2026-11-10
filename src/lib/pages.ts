// The run's URL and status rows are the same fixture used by Pages and Issues.
// Fetch timings come from the source capture when available.
//
// Redirects are stored as the full hop chain. Server-side hops come from the HTTP response
// (3xx + Location header); client-side hops are only visible after rendering in Playwright
// (<meta http-equiv="refresh"> or a JavaScript navigation).

import { pagesFor } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";
import { getStoredSnapshot } from "@/lib/stored-html";

export type PageKind = "ok" | "redirect" | "client" | "server" | "timeout" | "loop" | "skipped";
export type HopVia = "301" | "302" | "307" | "308" | "meta refresh" | "JavaScript";
export type Hop = { from: string; to: string; via: HopVia; side: "server" | "client" };

export type PageRow = {
  n: number;
  id: number;
  crawl: number;
  path: string; // the URL we requested
  status: number | null; // status of the first response
  kind: PageKind;
  hops: Hop[]; // empty unless redirected
  finalPath?: string;
  fetchMs: number | null;
  renderMs: number | null;
  performance: number | null;
  note?: string;
};

export function pageRowsFor(site: SiteId, crawl: number): PageRow[] {
  return pagesFor(site, crawl, null).map((page, index) => {
    const capture = page.status < 400 ? getStoredSnapshot(page) : undefined;
    return {
      n: index + 1, id: page.i, crawl, path: page.path, status: page.status,
      kind: page.status >= 500 ? "server" : page.status >= 400 ? "client" : "ok", hops: [],
      fetchMs: capture?.responseMs ?? null, renderMs: null, performance: page.perf,
      note: capture ? "Source capture timing" : "No captured timing",
    };
  });
}

export const redirectSide = (p: PageRow) =>
  !p.hops.length ? null : p.hops.every((h) => h.side === "server") ? "server" : p.hops.every((h) => h.side === "client") ? "client" : "mixed";

export type PageFilter = "all" | "problems" | "redirects" | "client" | "skipped";
export const PAGE_FILTERS: { v: PageFilter; label: string }[] = [
  { v: "all", label: "All" },
  { v: "problems", label: "Errors" },
  { v: "redirects", label: "Redirects" },
  { v: "client", label: "Client-side" },
  { v: "skipped", label: "Skipped" },
];
export function matches(p: PageRow, f: PageFilter) {
  if (f === "problems") return p.kind === "client" || p.kind === "server" || p.kind === "timeout" || p.kind === "loop";
  if (f === "redirects") return p.kind === "redirect";
  if (f === "client") return p.kind === "redirect" && redirectSide(p) !== "server";
  if (f === "skipped") return p.kind === "skipped";
  return true;
}
