// What every Analytics variation needs for one scope: the snapshot, its history in the chosen range, and the
// headline facts and parts derived from them, so the three layouts say the same thing in different ways.
import { useMemo } from "react";
import { BANDS, CAT_COLOR, PRI_COLOR, PRI_LABEL, forecast, history, inRange, links, pct, snapshot, type Filter, type IssueFilter, type Point, type Range } from "@/lib/analytics";
import type { Part } from "@/components/analytics-ui";
import { PRIORITIES } from "@/lib/priority";
import { CATEGORIES } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

export function useHealth(site: SiteId, range: Range, { type, sub }: Filter = {}, { pri, markup }: IssueFilter = {}, crawl?: number, vs?: number | null) {
  return useMemo(() => {
    const filter = { type, sub };
    const snap = snapshot(site, filter, { pri, markup }, crawl);
    const all = history(site, snap);
    const pts = inRange(all, range);
    const first = pts[0], last = pts[pts.length - 1];
    const L = links(site, { crawl: String(snap.crawl), vs: vs === null ? "none" : vs?.toString(), type, year: sub && /^\d{4}$/.test(sub) ? sub : undefined, sub: sub && !/^\d{4}$/.test(sub) ? sub : undefined, pri: pri?.join(",") || undefined, markup });
    const p1Trend = forecast(pts, (p) => p.P1);
    const scoreTrend = forecast(pts, (p) => p.score);
    const parts = {
      priority: PRIORITIES.map((p): Part => ({ name: `${p} ${PRI_LABEL[p]}`, value: snap.priority[p].issues, color: PRI_COLOR[p], to: snap.priority[p].issues ? L.issues({ pri: p }) : undefined })),
      category: CATEGORIES.map((c): Part => ({ name: c.label, value: snap.category[c.id].issues, color: CAT_COLOR[c.id], to: L.issues({ cat: c.id }) })),
      bands: BANDS.map((b): Part => ({ name: `${b.label} (${b.range})`, value: snap.bands[b.id], color: `${b.color}.solid`, to: L.pages(filter, "worst", { band: b.id }) })),
      markup: [
        { name: "Shared markup", value: snap.shared.elements, color: "brand.solid", to: snap.shared.elements ? L.issues({ markup: "shared" }) : undefined, hint: "Header, footer, banners: one fix in the template covers every page" },
        { name: "Page-specific", value: snap.specific.elements, color: "gray.solid", to: snap.specific.elements ? L.issues({ markup: "page" }) : undefined, hint: "Content on one page: fixed page by page" },
      ] as Part[],
    };
    const days = range === "all" ? (first?.daysAgo ?? 0) : Number(range);
    return { snap, all, pts, first, last, L, p1Trend, scoreTrend, parts, days, since: `vs ${days} days ago`, p1Share: pct(snap.p1Pages, snap.pages) };
  }, [site, range, type, sub, pri, markup, crawl, vs]);
}
export type Health = ReturnType<typeof useHealth>;

// One sentence on where P1s are heading
export function p1Outlook(h: Health) {
  const f = h.p1Trend;
  if (!f || Math.abs(f.perWeek) < 1) return "P1 issues are holding steady.";
  if (f.perWeek > 0) return `P1 issues are rising by about ${Math.round(f.perWeek)} a week.`;
  const weeks = f.daysToZero != null ? Math.round(f.daysToZero / 7) : null;
  return `P1 issues are falling by about ${Math.round(-f.perWeek)} a week${weeks != null ? `; at this pace they're gone in ~${weeks} weeks` : ""}.`;
}

export const seriesOfPriority = PRIORITIES.map((p) => ({ key: p, label: `${p} ${PRI_LABEL[p]}`, color: PRI_COLOR[p], pick: (x: Point) => x[p] }));
export const seriesOfCategory = CATEGORIES.map((c) => ({ key: c.id, label: c.label, color: CAT_COLOR[c.id], pick: (x: Point) => x.cat[c.id] }));
