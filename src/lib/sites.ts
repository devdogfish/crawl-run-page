// Websites this tool can crawl. The first URL segment is the site id (/rbccm/crawls, /rbcits/crawls/431).
// Add a site here and it appears in the switcher (top-left), with its own crawl history; its URL
// fill in the URL in "New crawl". QA copies are listed as their own sites.
//
// Logos are the official files from each site (public/sites/). The "-white" versions are for dark mode:
// RBC CM's is official; RBC IS's applies the same treatment (wordmark white, shield unchanged).
export type SiteId = "rbccm" | "rbccm-qa" | "rbcits" | "rbcits-qa";

export type Site = {
  id: SiteId;
  name: string; // full name (menu, dialog)
  short: string; // compact name (facts row, alt text)
  logo: { light: string; dark: string }; // under /public
  url: string; // base URL the crawler starts from
  qa: boolean; // a QA copy: minimal baseline content for testing new components, not updated with new content
};

// Production and QA are separate sites: QA holds a minimal baseline of content and isn't kept in sync,
// so each has its own crawl history and is only ever compared with itself.
const CM_LOGO = { light: "/sites/rbccm.svg", dark: "/sites/rbccm-white.svg" };
const IS_LOGO = { light: "/sites/rbcis.svg", dark: "/sites/rbcis-white.svg" };
export const SITES: Record<SiteId, Site> = {
  rbccm: { id: "rbccm", name: "RBC Capital Markets", short: "RBC CM", logo: CM_LOGO, url: "https://www.rbccm.com", qa: false },
  "rbccm-qa": { id: "rbccm-qa", name: "RBC Capital Markets QA", short: "RBC CM QA", logo: CM_LOGO, url: "https://www.sterbccm.com", qa: true },
  // rbcits.com now redirects to RBC Investor Services (rbcis.com)
  rbcits: { id: "rbcits", name: "RBC Investor Services", short: "RBC IS", logo: IS_LOGO, url: "https://www.rbcis.com", qa: false },
  "rbcits-qa": { id: "rbcits-qa", name: "RBC Investor Services QA", short: "RBC IS QA", logo: IS_LOGO, url: "https://www.sterbcits.com", qa: true },
};

export const SITE_IDS = Object.keys(SITES) as SiteId[];
export const DEFAULT_SITE: SiteId = "rbccm";
