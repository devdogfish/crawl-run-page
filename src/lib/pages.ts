// Simulated per-page results. In the real backend this is the `pages` table:
// one row per crawled URL, written by the crawler (HTTP fetch + Playwright render).
// Deterministic from the page index, so rows don't change between renders.
//
// Redirects are stored as the full hop chain. Server-side hops come from the HTTP response
// (3xx + Location header); client-side hops are only visible after rendering in Playwright
// (<meta http-equiv="refresh"> or a JavaScript navigation).

export type PageKind = "ok" | "redirect" | "client" | "server" | "timeout" | "loop" | "skipped";
export type HopVia = "301" | "302" | "307" | "308" | "meta refresh" | "JavaScript";
export type Hop = { from: string; to: string; via: HopVia; side: "server" | "client" };

export type PageRow = {
  n: number;
  path: string; // the URL we requested
  status: number | null; // status of the first response
  kind: PageKind;
  hops: Hop[]; // empty unless redirected
  finalPath?: string;
  fetchMs: number | null;
  renderMs: number | null;
  note?: string;
};

const rand = (i: number, salt: number) => {
  let x = (i + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const CATS = ["outdoor", "kitchen", "garden", "tools", "lighting", "bath", "storage", "kids"];
const BRANDS = ["nordform", "kettle-co", "arbor", "lumen", "fieldwork"];

function pathFor(i: number) {
  const r = rand(i, 1);
  if (r < 0.72) return `/product/${10_000 + i}`;
  if (r < 0.86) return `/category/${CATS[i % CATS.length]}?page=${(i % 40) + 1}`;
  if (r < 0.93) return `/brand/${BRANDS[i % BRANDS.length]}`;
  return `/blog/${["care-guide", "spring-sale", "how-to-measure", "gift-ideas"][i % 4]}-${i % 97}`;
}

const hop = (from: string, to: string, via: HopVia): Hop => ({
  from, to, via, side: via === "meta refresh" || via === "JavaScript" ? "client" : "server",
});

// Realistic redirect shapes, most common first
function redirectChain(i: number, target: string): Hop[] {
  const r = rand(i, 8);
  const legacy = target.startsWith("/product/") ? target.replace("/product/", "/p/") : `/old${target}`;
  if (r < 0.5) return [hop(legacy, target, "301")]; // old URL scheme
  if (r < 0.62) return [hop(`${target}/`, target, "308")]; // trailing slash
  if (r < 0.7) return [hop(`/sale${target}`, target, "302")]; // campaign link
  if (r < 0.8) return [hop(`/archive${legacy}`, legacy, "301"), hop(legacy, target, "301")]; // two migrations stacked
  if (r < 0.85) return [hop(`/go?to=${target}`, `/go/${i}`, "302"), hop(`/go/${i}`, `${target}/`, "307"), hop(`${target}/`, target, "308")];
  if (r < 0.93) return [hop(legacy, target, "meta refresh")]; // CMS page with <meta refresh>
  if (r < 0.97) return [hop(`/m${target}`, target, "JavaScript")]; // JS-only redirect
  return [hop(legacy, `/m${target}`, "301"), hop(`/m${target}`, target, "JavaScript")]; // mixed
}

export function pageAt(i: number): PageRow {
  const path = pathFor(i);
  const r = rand(i, 2);
  const fetchMs = Math.round(120 + rand(i, 3) * 900);
  const renderMs = Math.round(900 + rand(i, 4) * 2600);
  const base = { n: i + 1, hops: [] as Hop[], fetchMs, renderMs };

  if (r < 0.012) return { ...base, path: `${path}${path.includes("?") ? "&" : "?"}utm_source=newsletter`, status: null, kind: "skipped", fetchMs: null, renderMs: null, note: `Duplicate of ${path} after URL normalisation` };
  if (r < 0.0128) {
    const a = `/product/${10_000 + i}`, b = `${a}/`;
    return { ...base, path: a, status: 301, kind: "loop", hops: [hop(a, b, "301"), hop(b, a, "301")], renderMs: null, note: "Redirect loop · stopped after 10 hops" };
  }
  if (r < 0.057) {
    const hops = redirectChain(i, path);
    const client = hops[0].side === "client";
    return { ...base, path: hops[0].from, status: client ? 200 : Number(hops[0].via), kind: "redirect", hops, finalPath: path };
  }
  if (r < 0.071) return { ...base, path, status: r < 0.066 ? 404 : 410, kind: "client", renderMs: null };
  if (r < 0.075) return { ...base, path, status: 503, kind: "server", renderMs: null, note: "Retried twice" };
  if (r < 0.08) return { ...base, path, status: null, kind: "timeout", fetchMs: 30_000, renderMs: null, note: "No response after 30s" };
  return { ...base, path, status: 200, kind: "ok" };
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
