import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SiteProvider } from "@/components/site-context";
import { SITES, type SiteId } from "@/lib/sites";

// The first URL segment is the website: /rbccm/crawls, /rbcits/crawls/431
export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site } = await params;
  if (!(site in SITES)) notFound();
  return (
    <SiteProvider site={site as SiteId}>
      <AppShell>{children}</AppShell>
    </SiteProvider>
  );
}
