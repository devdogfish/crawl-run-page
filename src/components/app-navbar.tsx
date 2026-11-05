"use client";

// App-wide top bar: site switcher (official logo) on the left, New crawl on the right.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Container, Flex, Icon, Image, Menu, Portal, Separator, Text } from "@chakra-ui/react";
import { LuCheck, LuChevronsUpDown, LuPlus } from "react-icons/lu";

import { CrawlSettingsDialog } from "@/components/crawl-settings-dialog";
import { useSite } from "@/components/site-context";
import { crawlsFor } from "@/lib/crawls-list";
import { defaultSettings, hostOf } from "@/lib/settings";
import { SITES, SITE_IDS, type SiteId } from "@/lib/sites";

export function AppNavbar() {
  const router = useRouter();
  const site = useSite();
  const [open, setOpen] = useState(false);

  return (
    <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
      <Container maxW="7xl">
        <Flex h="16" align="center" gap="4">
          <Menu.Root positioning={{ placement: "bottom-start", gutter: 6 }}>
            <Menu.Trigger asChild>
              <Button variant="ghost" h="12" px="2" ms="-2" gap="3" aria-label={`${SITES[site].name}: switch site`}>
                <SiteLogo id={site} h="10" />
                <Icon as={LuChevronsUpDown} boxSize="4" color="fg.muted" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="80" p="1.5">
                  <Text textStyle="xs" fontWeight="medium" color="fg.muted" px="2" pt="1" pb="2">Switch site</Text>
                  {SITE_IDS.map((id) => (
                    <Menu.Item key={id} value={id} onClick={() => id !== site && router.push(`/${id}/crawls`)} gap="3" py="2.5" px="2" rounded="l2">
                      <Box w="24" flexShrink={0}><SiteLogo id={id} h="9" /></Box>
                      <Box flex="1" minW="0">
                        <Text textStyle="xs" color="fg.muted" truncate>{hostOf(SITES[id].environments.production)}</Text>
                      </Box>
                      {id === site && <Icon as={LuCheck} boxSize="4" color="fg" />}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>

          <Separator orientation="vertical" h="6" />
          <Text textStyle="sm" fontWeight="medium" color="fg.muted">Crawler</Text>

          <Button size="sm" ms="auto" onClick={() => setOpen(true)}><LuPlus />New crawl</Button>
        </Flex>
      </Container>
      <CrawlSettingsDialog
        open={open} onOpenChange={setOpen} mode="create" initial={defaultSettings(site)}
        onSubmit={(s) => router.push(`/${site}/crawls/${Number(crawlsFor(site)[0].id) + 1}?settings=${encodeURIComponent(JSON.stringify(s))}`)}
      />
    </Box>
  );
}

// Official logo; the white version is used in dark mode
export function SiteLogo({ id, h = "8" }: { id: SiteId; h?: string }) {
  const s = SITES[id];
  return (
    <>
      <Image src={s.logo.light} alt={s.name} h={h} w="auto" _dark={{ display: "none" }} />
      <Image src={s.logo.dark} alt={s.name} h={h} w="auto" display="none" _dark={{ display: "block" }} />
    </>
  );
}
