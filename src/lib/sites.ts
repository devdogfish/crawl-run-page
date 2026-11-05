// Websites this tool can crawl. Add a site here and it appears in the switcher (top-left),
// gets its own crawls list, and its environments fill in the URL in "New crawl".
//
// TODO: replace the staging/development URLs with the real ones, and set `logo` to an official
// logo file in /public/sites (e.g. "/sites/rbccm.svg"). Until then a lettered mark is shown.
import type { Environment } from "@/lib/settings";

export type SiteId = "rbccm" | "rbcits";

export type Site = {
  id: SiteId;
  name: string; // full name, shown in the switcher menu
  short: string; // shown next to the logo
  mark: string; // letters for the placeholder mark
  logo?: string; // path under /public, e.g. "/sites/rbccm.svg"
  environments: Record<Environment, string>; // base URL per environment
};

export const SITES: Record<SiteId, Site> = {
  rbccm: {
    id: "rbccm",
    name: "RBC Capital Markets",
    short: "RBC CM",
    mark: "CM",
    environments: {
      production: "https://www.rbccm.com",
      staging: "https://staging.rbccm.com", // placeholder
      development: "https://dev.rbccm.com", // placeholder
    },
  },
  rbcits: {
    id: "rbcits",
    name: "RBC Investor & Treasury Services",
    short: "RBC ITS",
    mark: "ITS",
    environments: {
      production: "https://www.rbcits.com",
      staging: "https://staging.rbcits.com", // placeholder
      development: "https://dev.rbcits.com", // placeholder
    },
  },
};

export const SITE_IDS = Object.keys(SITES) as SiteId[];
export const DEFAULT_SITE: SiteId = "rbccm";
export const envUrl = (site: SiteId, env: Environment) => SITES[site].environments[env];
