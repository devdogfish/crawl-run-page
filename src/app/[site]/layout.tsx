import { notFound } from "next/navigation";
import { AppNavbar } from "@/components/app-navbar";
import { SiteProvider } from "@/components/site-context";
import { SITES, type SiteId } from "@/lib/sites";

// The first URL segment is the website: /rbccm/crawls, /rbcits/crawls/431
export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site } = await params;
  if (!(site in SITES)) notFound();
  return (
    <SiteProvider site={site as SiteId}>
      <AppNavbar />
      {children}
    </SiteProvider>
  );
}
