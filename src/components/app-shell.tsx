"use client";

// PROTOTYPE: the three shortlisted navigation layouts, switchable in Settings → Navigation layout.
//   compact → one row: site switcher · section pills · New crawl
//   center  → one row: site switcher · centered segmented sections · New crawl, no border
//   side    → left sidebar (site switcher, New crawl, sections); pages get the full height
// Pick one, then delete the others and the Settings control.
import { createContext, useContext, useEffect, useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Container, Flex, Grid, HStack, Icon, Stack, Text } from "@chakra-ui/react";

import { NewCrawlButton, SECTIONS, SiteSwitcher } from "@/components/app-navbar";
import { useSite } from "@/components/site-context";

export type Layout = "compact" | "center" | "side";
export const LAYOUTS: { value: Layout; label: string; description: string }[] = [
  { value: "compact", label: "Compact", description: "One top bar: logo, sections, New crawl" },
  { value: "center", label: "Centered", description: "Top bar with the sections centered" },
  { value: "side", label: "Sidebar", description: "Sections in a sidebar on the left" },
];
const KEY = "crawler.layout";

// Primary colour: one hex, saved in this browser, applied as --brand (the whole brand palette derives from it)
export const DEFAULT_BRAND = "#005daa";
const BRAND_KEY = "crawler.brand";
export function applyBrand(hex: string) {
  document.documentElement.style.setProperty("--brand", hex);
  try { if (hex === DEFAULT_BRAND) localStorage.removeItem(BRAND_KEY); else localStorage.setItem(BRAND_KEY, hex); } catch { /* ignore */ }
}
export function savedBrand() {
  try { const v = localStorage.getItem(BRAND_KEY); return v && /^#[0-9a-f]{6}$/i.test(v) ? v : DEFAULT_BRAND; } catch { return DEFAULT_BRAND; }
}

const LayoutContext = createContext<{ layout: Layout; setLayout: (v: Layout) => void }>({ layout: "compact", setLayout: () => {} });
export const useLayout = () => useContext(LayoutContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [layout, setLayout] = useState<Layout>("compact");
  useEffect(() => { applyBrand(savedBrand()); }, []);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY) as Layout | null; if (v && LAYOUTS.some((l) => l.value === v)) setLayout(v); } catch { /* default */ }
  }, []);
  const choose = (v: Layout) => { setLayout(v); try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };

  return (
    <LayoutContext.Provider value={{ layout, setLayout: choose }}>
      {layout === "compact" && <CompactLayout>{children}</CompactLayout>}
      {layout === "center" && <CenterLayout>{children}</CenterLayout>}
      {layout === "side" && <SideLayout>{children}</SideLayout>}
    </LayoutContext.Provider>
  );
}

function useActiveSection() {
  return usePathname().split("/")[2] ?? "crawls";
}

// ───────────────────────── Option 1: compact, one row ─────────────────────────
function CompactLayout({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const active = useActiveSection();
  return (
    <Box css={{ "--sticky-top": "3.5rem" }}>
      <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
        <Container maxW="7xl">
          <Flex h="14" align="center" gap="6">
            <SiteSwitcher logoH="9" />
            <HStack gap="1" as="nav" aria-label="Sections">
              {SECTIONS.map((s) => {
                const on = s.id === active;
                return (
                  <Box asChild key={s.id} px="3" py="1.5" rounded="l2" textStyle="sm" fontWeight="medium"
                    color={on ? "fg" : "fg.muted"} bg={on ? "bg.muted" : undefined} _hover={{ color: "fg", bg: "bg.muted" }}
                    aria-current={on ? "page" : undefined}>
                    <NextLink href={`/${site}/${s.id}`}>{s.label}</NextLink>
                  </Box>
                );
              })}
            </HStack>
            <NewCrawlButton ms="auto" />
          </Flex>
        </Container>
      </Box>
      {children}
    </Box>
  );
}

// ───────────────────────── Option 2: centered segmented sections ─────────────────────────
function CenterLayout({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const active = useActiveSection();
  return (
    <Box css={{ "--sticky-top": "4rem" }}>
      <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/80" backdropFilter="blur(10px)">
        <Container maxW="7xl">
          <Grid h="16" templateColumns="1fr auto 1fr" alignItems="center" gap="4">
            <Box><SiteSwitcher logoH="9" /></Box>
            <HStack as="nav" aria-label="Sections" gap="0.5" p="1" rounded="full" bg="bg.muted" borderWidth="1px">
              {SECTIONS.map((s) => {
                const on = s.id === active;
                return (
                  <Box asChild key={s.id} px="3.5" py="1" rounded="full" textStyle="sm" fontWeight="medium"
                    color={on ? "fg" : "fg.muted"} bg={on ? "bg" : undefined} shadow={on ? "xs" : undefined}
                    _hover={{ color: "fg" }} aria-current={on ? "page" : undefined}>
                    <NextLink href={`/${site}/${s.id}`}>{s.label}</NextLink>
                  </Box>
                );
              })}
            </HStack>
            <Flex justify="flex-end"><NewCrawlButton variant="outline" /></Flex>
          </Grid>
        </Container>
      </Box>
      {children}
    </Box>
  );
}

// ───────────────────────── Option 3: left sidebar ─────────────────────────
function SideLayout({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const active = useActiveSection();
  return (
    <Flex minH="100vh" css={{ "--sticky-top": "0.5rem" }}>
      <Flex as="nav" aria-label="Sections" direction="column" w="60" flexShrink={0} position="sticky" top="0" h="100vh"
        borderEndWidth="1px" bg="bg.subtle" px="4" py="3">
        <SiteSwitcher full />
        <NewCrawlButton w="full" mt="4" />
        <Stack gap="0.5" mt="6">
          {SECTIONS.map((s) => {
            const on = s.id === active;
            return (
              <HStack asChild key={s.id} gap="2.5" px="2.5" py="2" rounded="l2" textStyle="sm" fontWeight="medium"
                color={on ? "fg" : "fg.muted"} bg={on ? "bg.muted" : undefined} _hover={{ bg: "bg.muted", color: "fg" }}
                aria-current={on ? "page" : undefined}>
                <NextLink href={`/${site}/${s.id}`}>
                  <Icon as={s.icon} boxSize="4" />
                  {s.label}
                </NextLink>
              </HStack>
            );
          })}
        </Stack>
        <Text mt="auto" px="2.5" textStyle="xs" color="fg.subtle">Crawler</Text>
      </Flex>
      <Box flex="1" minW="0">{children}</Box>
    </Flex>
  );
}
