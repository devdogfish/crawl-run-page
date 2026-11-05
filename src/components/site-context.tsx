"use client";

// The site the user is working on (switched in the navbar). Remembered per browser.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_SITE, SITES, type SiteId } from "@/lib/sites";

const KEY = "crawler.site";
const SiteContext = createContext<{ site: SiteId; setSite: (s: SiteId) => void }>({ site: DEFAULT_SITE, setSite: () => {} });

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [site, setSiteState] = useState<SiteId>(DEFAULT_SITE);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as SiteId | null;
      if (saved && saved in SITES) setSiteState(saved);
    } catch { /* storage unavailable: keep the default */ }
  }, []);
  const setSite = useCallback((s: SiteId) => {
    setSiteState(s);
    try { localStorage.setItem(KEY, s); } catch { /* ignore */ }
  }, []);
  return <SiteContext.Provider value={{ site, setSite }}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext);
