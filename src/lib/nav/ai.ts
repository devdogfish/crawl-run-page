// The AI fallback of the palette: one destination for a query the matcher didn't understand.
// POST /api/navigate → { url, label, chips }. Returns null when the backend isn't there (no X-Crawler-AI header),
// is slow, says it's unsure, or names a URL that doesn't validate (checked again here; never trust the network).
import { validateUrl } from "./url-map";
import type { Result, SearchContext } from "./search";

export async function aiNavigate(query: string, ctx: SearchContext, signal?: AbortSignal): Promise<Result | null> {
  try {
    const res = await fetch("/api/navigate", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ query, context: { site: ctx.site, url: ctx.url } }),
    });
    if (!res.ok || !res.headers.get("X-Crawler-AI")) return null;
    const body = await res.json() as { url?: unknown; label?: unknown };
    if (typeof body.url !== "string") return null;
    const v = validateUrl(body.url);
    if (!v.ok) return null;
    // The title is the place ("Issues"); the filters it sets are the chips, so the row reads like any other view
    return { url: v.url, title: v.route.label, kind: "filter", score: 0.65, chips: v.chips };
  } catch {
    return null; // aborted, offline, timed out or bad JSON
  }
}
