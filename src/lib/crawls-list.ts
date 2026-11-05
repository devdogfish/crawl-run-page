// PROTOTYPE DATA for /crawls. In the real app: GET /api/crawls (see SPEC.md §6.0).
import type { Environment } from "@/lib/settings";
import { SITES, envUrl, type SiteId } from "@/lib/sites";

export type CrawlListStatus = "running" | "paused" | "success" | "failed" | "cancelled";
export type CrawlRow = {
  id: string;
  site: SiteId;
  environment: Environment;
  url: string;
  status: CrawlListStatus;
  progressPct: number | null; // running/paused only
  pages: number;
  errorPct: number;
  durationSec: number;
  startedAt: Date;
  trigger: "Schedule" | "Manual";
};

const r = (i: number, salt: number) => {
  let x = (i + 1) * 2654435761 + salt * 40503;
  x = (x ^ (x >>> 15)) * 2246822519;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

// Newest first. RBC CM #812 is the live (simulated) crawl; production runs daily at 02:00, others are manual.
function history(site: SiteId, newestId: number, count: number, salt: number, livePct: number | null): CrawlRow[] {
  return Array.from({ length: count }, (_, i) => {
    const id = newestId - i;
    const env: Environment = i === 0 || r(i, 1 + salt) < 0.62 ? "production" : "qa";
    const day = Math.floor(i * 0.62);
    const scheduled = env === "production";
    const startedAt = new Date(Date.UTC(2026, 10, 4 - day, scheduled ? 2 : 9 + Math.floor(r(i, 3 + salt) * 8), scheduled ? 0 : Math.floor(r(i, 4 + salt) * 60)));
    const pagesBase = (env === "production" ? 48_200 : 47_600) * (site === "rbcits" ? 0.4 : 1);
    const roll = r(i, 5 + salt);
    const live = i === 0 && livePct != null;
    const status: CrawlListStatus = live ? "running" : roll < 0.08 ? "failed" : roll < 0.11 ? "cancelled" : "success";
    const durationSec = live ? 540 : Math.round((env === "qa" ? 1_250 : 1_400) * (site === "rbcits" ? 0.45 : 1) * (0.9 + r(i, 6 + salt) * 0.25) + (i === 17 ? 390 : 0));
    return {
      id: String(id),
      site,
      environment: env,
      url: envUrl(site, env),
      status,
      progressPct: live ? livePct : null,
      pages: live ? 19_200 : Math.round(pagesBase * (status === "cancelled" ? 0.4 : 0.98 + r(i, 7 + salt) * 0.04)),
      errorPct: +(1.2 + r(i, 8 + salt) * 2.6 + (status === "failed" ? 4 : 0)).toFixed(1),
      durationSec,
      startedAt,
      trigger: scheduled ? "Schedule" : "Manual",
    };
  });
}

export const CRAWLS: CrawlRow[] = [...history("rbccm", 812, 64, 0, 32), ...history("rbcits", 431, 40, 11, null)];
export const crawlsFor = (site: SiteId) => CRAWLS.filter((c) => c.site === site);
export const siteName = (site: SiteId) => SITES[site].short;
