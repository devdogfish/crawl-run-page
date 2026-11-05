"use client";

// The current website comes from the first URL segment (/rbccm/…, /rbcits/…).
// It is also remembered per browser, so "/" opens the site used last.
import { createContext, useContext, useEffect } from "react";
import { DEFAULT_SITE, type SiteId } from "@/lib/sites";

export const LAST_SITE_KEY = "crawler.site";
const SiteContext = createContext<SiteId>(DEFAULT_SITE);

export function SiteProvider({ site, children }: { site: SiteId; children: React.ReactNode }) {
  useEffect(() => {
    try { localStorage.setItem(LAST_SITE_KEY, site); } catch { /* storage unavailable */ }
  }, [site]);
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext);
