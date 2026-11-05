// Websites this tool can crawl. The first URL segment is the site id (/rbccm/crawls, /rbcits/crawls/431).
// Add a site here and it appears in the switcher (top-left), with its own crawl history; its environments
// fill in the URL in "New crawl".
//
// Logos are the official files from each site (public/sites/). The "-white" versions are for dark mode:
// RBC CM's is official; RBC IS's applies the same treatment (wordmark white, shield unchanged).
import type { Environment } from "@/lib/settings";

export type SiteId = "rbccm" | "rbcits";

export type Site = {
  id: SiteId;
  name: string; // full name (menu, dialog)
  short: string; // compact name (facts row, alt text)
  logo: { light: string; dark: string }; // under /public
  environments: Record<Environment, string>; // base URL per environment
};

export const SITES: Record<SiteId, Site> = {
  rbccm: {
    id: "rbccm",
    name: "RBC Capital Markets",
    short: "RBC CM",
    logo: { light: "/sites/rbccm.svg", dark: "/sites/rbccm-white.svg" },
    environments: {
      production: "https://www.rbccm.com",
      qa: "https://www.sterbccm.com",
    },
  },
  rbcits: {
    id: "rbcits",
    // rbcits.com now redirects to RBC Investor Services (rbcis.com)
    name: "RBC Investor Services",
    short: "RBC IS",
    logo: { light: "/sites/rbcis.svg", dark: "/sites/rbcis-white.svg" },
    environments: {
      production: "https://www.rbcis.com",
      qa: "https://www.sterbcits.com",
    },
  },
};

export const SITE_IDS = Object.keys(SITES) as SiteId[];
export const DEFAULT_SITE: SiteId = "rbccm";
export const envUrl = (site: SiteId, env: Environment) => SITES[site].environments[env];
