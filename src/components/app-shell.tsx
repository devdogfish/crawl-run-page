"use client";

// PROTOTYPE: navigation layouts to compare, switchable with the floating toggle (bottom-right).
//   top     → two rows: site switcher · product · New crawl, then section tabs underneath
//   compact → one row: site switcher · section pills · New crawl
//   brand   → one row on RBC blue: white logo, white tabs with a yellow active underline, yellow New crawl
//   center  → one row: site switcher · centered segmented sections · New crawl, no border
//   side    → left sidebar (site switcher, New crawl, sections); pages get the full height
// Pick one, then delete the others and the toggle.
import { useEffect, useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Container, Flex, Grid, HStack, Icon, SegmentGroup, Separator, Stack, Text } from "@chakra-ui/react";

import { NewCrawlButton, SECTIONS, SiteSwitcher } from "@/components/app-navbar";
import { useSite } from "@/components/site-context";

type Layout = "top" | "compact" | "brand" | "center" | "side";
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "top", label: "Two rows" },
  { value: "compact", label: "Compact" },
  { value: "brand", label: "Brand bar" },
  { value: "center", label: "Centered" },
  { value: "side", label: "Sidebar" },
];
const KEY = "crawler.layout";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [layout, setLayout] = useState<Layout>("top");
  useEffect(() => {
    try { const v = localStorage.getItem(KEY) as Layout | null; if (v && LAYOUTS.some((l) => l.value === v)) setLayout(v); } catch { /* default */ }
  }, []);
  const choose = (v: Layout) => { setLayout(v); try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };

  return (
    <>
      {layout === "top" && <TopLayout>{children}</TopLayout>}
      {layout === "compact" && <CompactLayout>{children}</CompactLayout>}
      {layout === "brand" && <BrandLayout>{children}</BrandLayout>}
      {layout === "center" && <CenterLayout>{children}</CenterLayout>}
      {layout === "side" && <SideLayout>{children}</SideLayout>}
      <LayoutToggle value={layout} onChange={choose} />
    </>
  );
}

function useActiveSection() {
  return usePathname().split("/")[2] ?? "crawls";
}

// ───────────────────────── Option A: two rows (bar + tabs) ─────────────────────────
function TopLayout({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const active = useActiveSection();
  return (
    // --sticky-top: how far sticky content (e.g. the step list) must stay below the header
    <Box css={{ "--sticky-top": "6.5rem" }}>
      <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
        <Container maxW="7xl">
          <Flex h="14" align="center" gap="4">
            <SiteSwitcher />
            <Separator orientation="vertical" h="6" />
            <Text textStyle="sm" fontWeight="medium" color="fg.muted">Crawler</Text>
            <NewCrawlButton ms="auto" />
          </Flex>
          <HStack gap="1" as="nav" aria-label="Sections">
            {SECTIONS.map((s) => {
              const on = s.id === active;
              return (
                <Box asChild key={s.id} px="3" py="2.5" textStyle="sm" fontWeight="medium" mb="-1px"
                  color={on ? "fg" : "fg.muted"} borderBottomWidth="2px" borderColor={on ? "fg" : "transparent"}
                  _hover={{ color: "fg" }} aria-current={on ? "page" : undefined}>
                  <NextLink href={`/${site}/${s.id}`}>{s.label}</NextLink>
                </Box>
              );
            })}
          </HStack>
        </Container>
      </Box>
      {children}
    </Box>
  );
}

// ───────────────────────── Option B: compact, one row ─────────────────────────
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

// ───────────────────────── Option C: RBC brand bar ─────────────────────────
const RBC_BLUE = "#0051A5";
const RBC_YELLOW = "#FEDF01";
function BrandLayout({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const active = useActiveSection();
  return (
    <Box css={{ "--sticky-top": "4rem" }}>
      <Box as="header" position="sticky" top="0" zIndex="sticky" bg={RBC_BLUE} color="white">
        <Container maxW="7xl">
          <Flex h="16" align="stretch" gap="6">
            <Flex align="center"><SiteSwitcher logoH="10" onBrand /></Flex>
            <HStack gap="1" as="nav" aria-label="Sections" align="stretch">
              {SECTIONS.map((s) => {
                const on = s.id === active;
                return (
                  <Flex asChild key={s.id} align="center" px="3" textStyle="sm" fontWeight="medium"
                    color={on ? "white" : "whiteAlpha.800"} borderBottomWidth="3px" borderColor={on ? RBC_YELLOW : "transparent"}
                    borderTopWidth="3px" borderTopColor="transparent" _hover={{ color: "white" }} aria-current={on ? "page" : undefined}>
                    <NextLink href={`/${site}/${s.id}`}>{s.label}</NextLink>
                  </Flex>
                );
              })}
            </HStack>
            <Flex align="center" ms="auto">
              <NewCrawlButton bg={RBC_YELLOW} color="gray.900" _hover={{ bg: "#F2D400" }} />
            </Flex>
          </Flex>
        </Container>
      </Box>
      {children}
    </Box>
  );
}

// ───────────────────────── Option D: centered segmented sections ─────────────────────────
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

// ───────────────────────── Option E: left sidebar ─────────────────────────
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

function LayoutToggle({ value, onChange }: { value: Layout; onChange: (v: Layout) => void }) {
  return (
    <HStack position="fixed" bottom="4" right="4" zIndex="toast" gap="2" px="2.5" py="1.5" rounded="l3"
      bg="bg.panel" borderWidth="1px" shadow="lg">
      <Text textStyle="xs" color="fg.muted" fontWeight="medium">Layout</Text>
      <SegmentGroup.Root size="xs" value={value} onValueChange={(e) => onChange(e.value as Layout)}>
        <SegmentGroup.Indicator />
        <SegmentGroup.Items items={LAYOUTS} />
      </SegmentGroup.Root>
    </HStack>
  );
}
