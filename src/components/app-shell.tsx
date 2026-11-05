"use client";

// PROTOTYPE: two navigation layouts to compare, switchable with the floating toggle (bottom-right).
//   top  → navbar (site switcher · product · New crawl) with a row of section tabs underneath
//   side → left sidebar (site switcher, New crawl, sections); pages get the full height
// Pick one, then delete the other and the toggle.
import { useEffect, useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Container, Flex, HStack, Icon, SegmentGroup, Separator, Stack, Text } from "@chakra-ui/react";

import { NewCrawlButton, SECTIONS, SiteSwitcher } from "@/components/app-navbar";
import { useSite } from "@/components/site-context";

type Layout = "top" | "side";
const KEY = "crawler.layout";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [layout, setLayout] = useState<Layout>("top");
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "top" || v === "side") setLayout(v); } catch { /* default */ }
  }, []);
  const choose = (v: Layout) => { setLayout(v); try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };

  return (
    <>
      {layout === "top" ? <TopLayout>{children}</TopLayout> : <SideLayout>{children}</SideLayout>}
      <LayoutToggle value={layout} onChange={choose} />
    </>
  );
}

function useActiveSection() {
  return usePathname().split("/")[2] ?? "crawls";
}

// ───────────────────────── Option A: top bar + tabs ─────────────────────────
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

// ───────────────────────── Option B: left sidebar ─────────────────────────
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
        <SegmentGroup.Items items={[{ value: "top", label: "Top tabs" }, { value: "side", label: "Sidebar" }]} />
      </SegmentGroup.Root>
    </HStack>
  );
}
