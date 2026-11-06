// Open the site used last (remembered per browser), or the default site.
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { LAST_SITE_KEY } from "@/components/site-context";
import { DEFAULT_SITE, SITES } from "@/lib/sites";

export default function Home() {
  const navigate = useNavigate();
  useEffect(() => {
    let site: string = DEFAULT_SITE;
    try { const saved = localStorage.getItem(LAST_SITE_KEY); if (saved && saved in SITES) site = saved; } catch { /* use default */ }
    navigate(`/${site}/overview`, { replace: true });
  }, [navigate]);
  return null;
}
