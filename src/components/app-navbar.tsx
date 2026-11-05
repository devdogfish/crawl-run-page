"use client";

// App-wide top bar: site switcher (logo + name) on the left, New crawl on the right.
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Box, Button, Container, Flex, HStack, Icon, Image, Menu, Portal, Text } from "@chakra-ui/react";
import { LuCheck, LuChevronsUpDown, LuPlus } from "react-icons/lu";

import { CrawlSettingsDialog } from "@/components/crawl-settings-dialog";
import { useSite } from "@/components/site-context";
import { crawlsFor } from "@/lib/crawls-list";
import { defaultSettings } from "@/lib/settings";
import { SITES, SITE_IDS, type SiteId } from "@/lib/sites";

export function AppNavbar() {
  const router = useRouter();
  const path = usePathname();
  const { site, setSite } = useSite();
  const [open, setOpen] = useState(false);

  const switchTo = (id: SiteId) => {
    if (id === site) return;
    setSite(id);
    if (path !== "/crawls") router.push("/crawls"); // a crawl belongs to one site
  };

  return (
    <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
      <Container maxW="7xl">
        <Flex h="14" align="center" gap="4">
          <Menu.Root positioning={{ placement: "bottom-start" }}>
            <Menu.Trigger asChild>
              <Button variant="ghost" size="sm" px="1.5" ms="-1.5" gap="2.5" aria-label="Switch site">
                <SiteMark id={site} />
                <Text fontWeight="semibold">{SITES[site].short}</Text>
                <Icon as={LuChevronsUpDown} boxSize="3.5" color="fg.muted" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="72">
                  <Menu.ItemGroup>
                    <Menu.ItemGroupLabel>Sites</Menu.ItemGroupLabel>
                    {SITE_IDS.map((id) => (
                      <Menu.Item key={id} value={id} onClick={() => switchTo(id)} gap="3" py="2">
                        <SiteMark id={id} />
                        <Box flex="1" minW="0">
                          <Text textStyle="sm" fontWeight="medium">{SITES[id].short}</Text>
                          <Text textStyle="xs" color="fg.muted" truncate>{SITES[id].name}</Text>
                        </Box>
                        {id === site && <Icon as={LuCheck} boxSize="4" />}
                      </Menu.Item>
                    ))}
                  </Menu.ItemGroup>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>

          <HStack ms="auto">
            <Button size="sm" onClick={() => setOpen(true)}><LuPlus />New crawl</Button>
          </HStack>
        </Flex>
      </Container>
      <CrawlSettingsDialog
        open={open} onOpenChange={setOpen} mode="create" initial={defaultSettings(site)}
        onSubmit={(s) => router.push(`/crawls/${Number(crawlsFor(site)[0].id) + 1}?settings=${encodeURIComponent(JSON.stringify(s))}`)}
      />
    </Box>
  );
}

// Site logo; a lettered mark until an official logo file is configured in src/lib/sites.ts
export function SiteMark({ id, size = "7" }: { id: SiteId; size?: string }) {
  const s = SITES[id];
  if (s.logo) return <Image src={s.logo} alt={s.name} boxSize={size} objectFit="contain" />;
  return (
    <Flex boxSize={size} rounded="l2" bg="blue.solid" color="white" align="center" justify="center" flexShrink={0}
      fontSize={s.mark.length > 2 ? "2xs" : "xs"} fontWeight="bold" letterSpacing="tight">
      {s.mark}
    </Flex>
  );
}
