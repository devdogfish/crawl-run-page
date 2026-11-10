// Demo crawl metadata and per-crawl snapshot coverage from the same checked-in fixture.
import history from "@/data/crawl-history.json";
import { SITES, type SiteId } from "@/lib/sites";

export type CrawlListStatus = "running" | "paused" | "success" | "failed" | "cancelled";
export type CrawlRow = {
  id: string;
  site: SiteId;
  url: string;
  status: CrawlListStatus;
  progressPct: number | null;
  pages: number;
  errorPct: number;
  durationSec: number;
  startedAt: Date;
  trigger: "Schedule" | "Manual";
};

type CrawlFixture = {
  id: string;
  status: CrawlListStatus;
  startedAt: string;
  trigger: CrawlRow["trigger"];
  durationSec: number;
  progressPct: number | null;
  pageIds: number[];
  lighthousePageIds: number[];
  changedPageIds: number[];
  errorPageIds: number[];
  vitalsByPage: Partial<Record<string, PageVitals>>;
};

export type PageVitals = { lcp: number; cls: number; tbt: number; performanceScore: number };

const fixtures = history.sites as Record<SiteId, CrawlFixture[]>;
const sites = Object.keys(fixtures) as SiteId[];

export const CRAWLS: CrawlRow[] = sites.flatMap((site) => fixtures[site].map((entry) => ({
  id: entry.id,
  site,
  url: SITES[site].url,
  status: entry.status,
  progressPct: entry.progressPct,
  pages: entry.pageIds.length,
  errorPct: entry.pageIds.length ? Math.round(1000 * entry.errorPageIds.length / entry.pageIds.length) / 10 : 0,
  durationSec: entry.durationSec,
  startedAt: new Date(entry.startedAt),
  trigger: entry.trigger,
})));

export const crawlsFor = (site: SiteId) => CRAWLS.filter((crawl) => crawl.site === site);
export const crawlFixture = (site: SiteId, crawlId: number) => fixtures[site].find((entry) => Number(entry.id) === crawlId);
export const crawlFixturesFor = (site: SiteId) => fixtures[site];
export const siteName = (site: SiteId) => SITES[site].short;
