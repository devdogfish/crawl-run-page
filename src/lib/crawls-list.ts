// PROTOTYPE DATA for /crawls. In the real app: GET /api/crawls (see SPEC.md §6.0).
import type { Environment } from "@/lib/settings";
import { ENVIRONMENTS } from "@/lib/settings";

export type CrawlListStatus = "running" | "paused" | "success" | "failed" | "cancelled";
export type CrawlRow = {
  id: string;
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

// Newest first: #812 is the live (simulated) crawl; production runs daily at 02:00, others are manual
export const CRAWLS: CrawlRow[] = Array.from({ length: 64 }, (_, i) => {
  const id = 812 - i;
  const env: Environment = i === 0 || r(i, 1) < 0.62 ? "production" : r(i, 2) < 0.7 ? "staging" : "development";
  const day = Math.floor(i * 0.62);
  const scheduled = env === "production";
  const startedAt = new Date(Date.UTC(2026, 10, 4 - day, scheduled ? 2 : 9 + Math.floor(r(i, 3) * 8), scheduled ? 0 : Math.floor(r(i, 4) * 60)));
  const pagesBase = env === "production" ? 48_200 : env === "staging" ? 47_600 : 12_400;
  const roll = r(i, 5);
  const status: CrawlListStatus = i === 0 ? "running" : roll < 0.08 ? "failed" : roll < 0.11 ? "cancelled" : "success";
  const durationSec = status === "running" ? 540 : Math.round((env === "development" ? 380 : 1_400) * (0.9 + r(i, 6) * 0.25) + (i === 17 ? 390 : 0));
  return {
    id: String(id),
    environment: env,
    url: ENVIRONMENTS[env].url,
    status,
    progressPct: status === "running" ? 32 : null,
    pages: status === "running" ? 19_200 : status === "cancelled" ? Math.round(pagesBase * 0.4) : Math.round(pagesBase * (0.98 + r(i, 7) * 0.04)),
    errorPct: +(1.2 + r(i, 8) * 2.6 + (status === "failed" ? 4 : 0)).toFixed(1),
    durationSec,
    startedAt,
    trigger: scheduled ? "Schedule" : "Manual",
  };
});
