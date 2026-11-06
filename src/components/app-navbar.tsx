// Navigation building blocks shared by both layouts (top tabs and sidebar):
// site switcher with the official logo, the New crawl button, and the list of sections.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Box, Button, Icon, Image, Menu, Portal, Text, type ButtonProps } from "@chakra-ui/react";
import { LuChartColumn, LuLayoutDashboard, LuCircleAlert, LuFileText, LuCheck, LuChevronsUpDown, LuList, LuPlus, LuSettings } from "react-icons/lu";

import { CrawlSettingsDialog } from "@/components/crawl-settings-dialog";
import { useSite } from "@/components/site-context";
import { crawlsFor } from "@/lib/crawls-list";
import { defaultSettings, hostOf } from "@/lib/settings";
import { SITES, SITE_IDS, type SiteId } from "@/lib/sites";

// Top-level sections. Overview is where the app opens.
export const SECTIONS = [
  { id: "overview", label: "Overview", icon: LuLayoutDashboard },
  { id: "crawls", label: "Crawls", icon: LuList },
  { id: "analytics", label: "Analytics", icon: LuChartColumn },
  { id: "pages", label: "Pages", icon: LuFileText },
  { id: "issues", label: "Issues", icon: LuCircleAlert },
  { id: "settings", label: "Settings", icon: LuSettings },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export function SiteSwitcher({ logoH = "10", full = false }: { logoH?: string; full?: boolean }) {
  const navigate = useNavigate();
  const site = useSite();
  return (
    <Menu.Root positioning={{ placement: "bottom-start", gutter: 6 }}>
      <Menu.Trigger asChild>
        <Button variant="ghost" h="12" px="2" ms="-2" gap="3" w={full ? "calc(100% + 1rem)" : undefined} justifyContent="space-between"
          aria-label={`${SITES[site].name}: switch site`}>
          <SiteLogo id={site} h={logoH} />
          <Icon as={LuChevronsUpDown} boxSize="4" color="fg.muted" />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="80" p="1.5">
            <Text textStyle="xs" fontWeight="medium" color="fg.muted" px="2" pt="1" pb="2">Switch site</Text>
            {SITE_IDS.map((id) => (
              <Menu.Item key={id} value={id} onClick={() => id !== site && navigate(`/${id}/overview`)} gap="3" py="2.5" px="2" rounded="l2">
                <Box w="24" flexShrink={0}><SiteLogo id={id} h="9" /></Box>
                <Box flex="1" minW="0">
                  <Text textStyle="xs" color="fg.muted" truncate>{hostOf(SITES[id].url)}</Text>
                </Box>
                {id === site && <Icon as={LuCheck} boxSize="4" color="fg" />}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

export function NewCrawlButton(props: ButtonProps) {
  const navigate = useNavigate();
  const site = useSite();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} {...props}><LuPlus />New crawl</Button>
      <CrawlSettingsDialog
        open={open} onOpenChange={setOpen} mode="create" initial={defaultSettings(site)}
        onSubmit={(s) => navigate(`/${site}/crawls/${Number(crawlsFor(site)[0].id) + 1}?settings=${encodeURIComponent(JSON.stringify(s))}`)}
      />
    </>
  );
}

// QA copies share the production logo, so SiteLogo pins this badge to the shield's bottom-right corner
function QaBadge() {
  return (
    <Badge size="xs" variant="solid" colorPalette="orange" position="absolute" left="26%" bottom="-1"
      boxShadow="0 0 0 2px var(--chakra-colors-bg-panel)" pointerEvents="none">QA</Badge>
  );
}

// Official logo; the white version is used in dark mode
export function SiteLogo({ id, h = "8" }: { id: SiteId; h?: string }) {
  const s = SITES[id];
  return (
    <Box position="relative" display="inline-flex" flexShrink={0}>
      <Image src={s.logo.light} alt={s.name} h={h} w="auto" _dark={{ display: "none" }} />
      <Image src={s.logo.dark} alt={s.name} h={h} w="auto" display="none" _dark={{ display: "block" }} />
      {s.qa && <QaBadge />}
    </Box>
  );
}
