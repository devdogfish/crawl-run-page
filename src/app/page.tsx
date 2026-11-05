"use client";

// Open the site used last (remembered per browser), or the default site.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LAST_SITE_KEY } from "@/components/site-context";
import { DEFAULT_SITE, SITES } from "@/lib/sites";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let site: string = DEFAULT_SITE;
    try { const saved = localStorage.getItem(LAST_SITE_KEY); if (saved && saved in SITES) site = saved; } catch { /* use default */ }
    router.replace(`/${site}/crawls`);
  }, [router]);
  return null;
}
