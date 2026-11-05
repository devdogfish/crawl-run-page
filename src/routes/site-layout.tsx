import { Outlet, useParams } from "react-router";
import { AppShell } from "@/components/app-shell";
import { SiteProvider } from "@/components/site-context";
import { SITES, type SiteId } from "@/lib/sites";
import { NotFound } from "@/routes/not-found";

// The first URL segment is the website: /rbccm/crawls, /rbcits/crawls/431
export default function SiteLayout() {
  const { site = "" } = useParams();
  if (!(site in SITES)) return <NotFound />;
  return (
    <SiteProvider site={site as SiteId}>
      <AppShell><Outlet /></AppShell>
    </SiteProvider>
  );
}
