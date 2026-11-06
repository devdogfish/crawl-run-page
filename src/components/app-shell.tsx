// PROTOTYPE: the three shortlisted navigation layouts, switchable in Settings → Navigation layout.
//   compact → one row: site switcher · section pills · New crawl
//   center  → one row: site switcher · centered segmented sections · New crawl, no border
//   side    → left sidebar (site switcher, New crawl, sections); pages get the full height
// Pick one, then delete the others and the Settings control.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { useLocation } from "react-router";
import { Box, ChakraProvider, Container, Flex, Grid, HStack, Icon, Menu, Portal, Stack, Text, useMediaQuery } from "@chakra-ui/react";

import { RuleDialogHost } from "./rule-dialog-host";
import { LuMenu } from "react-icons/lu";
import { system, dockedSystem } from "./ui/system";
import { CompactNavActions, NavAction } from "./nav-action";
import { NewCrawlButton, NewRuleButton, SECTIONS, SiteSwitcher } from "@/components/app-navbar";
import { AskAiButton, AssistantProvider, PANEL_W, useAssistant } from "@/components/assistant";
import { PaletteProvider, SearchButton } from "@/components/command-palette";
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
      <Box css={{ "--app-header-height": layout === "center" ? "65px" : "57px" }}>
      <AssistantProvider><PaletteProvider>
        <Content>
          {layout === "compact" && <CompactLayout>{children}</CompactLayout>}
          {layout === "center" && <CenterLayout>{children}</CenterLayout>}
          {layout === "side" && <SideLayout>{children}</SideLayout>}
        </Content>
        <RuleDialogHost />
      </PaletteProvider></AssistantProvider>
      </Box>
    </LayoutContext.Provider>
  );
}

// Reserve the dock beside the entire app, including its navigation. Overlay on narrow screens.
const AvailableWidth = createContext(window.innerWidth);

function Content({ children }: { children: React.ReactNode }) {
  const { open, placement } = useAssistant();
  const [canShare] = useMediaQuery(["(min-width: 48rem)"], { ssr: false });
  const docked = open && placement !== "floating" && canShare;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Box ref={ref} minW="0" w={docked ? `calc(100% - ${PANEL_W})` : "full"} ms={docked && placement === "left" ? PANEL_W : 0}>
    <ChakraProvider value={docked ? dockedSystem : system}>
      <AvailableWidth.Provider value={width}>{children}</AvailableWidth.Provider>
    </ChakraProvider>
  </Box>;
}

function useActiveSection() {
  return useLocation().pathname.split("/")[2] ?? "overview";
}

// ───────────────────────── Option 1: compact, one row ─────────────────────────
function CompactLayout({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const active = useActiveSection();
  return (
    <Box css={{ "--sticky-top": "3.5rem" }}>
      <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
        <Container maxW="7xl" css={{ containerType: "inline-size", containerName: "navbar" }}>
          <Flex h="14" align="center" gap="6" minW="0" css={{
            "--nav-logo-height": "2.25rem",
            "& .section-menu": { display: "none" },
            "@container navbar (max-width: 1035px)": { gap: "2", "--nav-logo-height": "1.5rem", "& .nav-actions": { gap: "1" } },
            "@container navbar (max-width: 667px)": { "& .section-menu": { display: "block" }, "& .section-links": { display: "none" } },
          }}>
            <SiteSwitcher logoH="var(--nav-logo-height)" />
            <Box className="section-menu"><SectionMenu /></Box>
            <HStack className="section-links" gap="1" as="nav" aria-label="Sections" flexShrink={0}>
              {SECTIONS.map((s) => {
                const on = s.id === active;
                return (
                  <Box asChild key={s.id} px="3" py="1.5" rounded="l2" textStyle="sm" fontWeight="medium"
                    color={on ? "fg" : "fg.muted"} bg={on ? "bg.muted" : undefined} _hover={{ color: "fg", bg: "bg.muted" }}
                    aria-current={on ? "page" : undefined}>
                    <RouterLink to={`/${site}/${s.id}`}>{s.label}</RouterLink>
                  </Box>
                );
              })}
            </HStack>
            <CompactNavActions.Provider value="container"><HStack className="nav-actions" ms="auto" gap="2" flexShrink={0}><SearchButton /><AskAiButton /><NewRuleButton /><NewCrawlButton /></HStack></CompactNavActions.Provider>
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
  const width = useContext(AvailableWidth);
  if (width < 1200) return <CompactLayout>{children}</CompactLayout>;
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
                    <RouterLink to={`/${site}/${s.id}`}>{s.label}</RouterLink>
                  </Box>
                );
              })}
            </HStack>
            <Flex justify="flex-end" gap="2"><SearchButton /><AskAiButton /><NewRuleButton /><NewCrawlButton variant="outline" /></Flex>
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
  const width = useContext(AvailableWidth);
  if (width < 1000) return <CompactLayout>{children}</CompactLayout>;
  return (
    <Flex minH="100vh" css={{ "--sticky-top": "0.5rem" }}>
      <Flex as="nav" aria-label="Sections" direction="column" w="60" flexShrink={0} position="sticky" top="0" h="100vh"
        borderEndWidth="1px" bg="bg.subtle" px="4" py="3">
        <SiteSwitcher full />
        <NewRuleButton /><NewCrawlButton w="full" mt="4" />
        <Box mt="2"><SearchButton full /></Box>
        <Box mt="1"><AskAiButton /></Box>
        <Stack gap="0.5" mt="6">
          {SECTIONS.map((s) => {
            const on = s.id === active;
            return (
              <HStack asChild key={s.id} gap="2.5" px="2.5" py="2" rounded="l2" textStyle="sm" fontWeight="medium"
                color={on ? "fg" : "fg.muted"} bg={on ? "bg.muted" : undefined} _hover={{ bg: "bg.muted", color: "fg" }}
                aria-current={on ? "page" : undefined}>
                <RouterLink to={`/${site}/${s.id}`}>
                  <Icon as={s.icon} boxSize="4" />
                  {s.label}
                </RouterLink>
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


function SectionMenu() {
  const site = useSite();
  const active = useActiveSection();
  return <Menu.Root>
    <Menu.Trigger asChild><NavAction w="9" minW="9" h="9" px="0" aria-label="Sections"><LuMenu /></NavAction></Menu.Trigger>
    <Portal><Menu.Positioner><Menu.Content>
      {SECTIONS.map((section) => <Menu.Item key={section.id} value={section.id} asChild>
        <RouterLink to={`/${site}/${section.id}`} aria-current={active === section.id ? "page" : undefined}><Icon as={section.icon} />{section.label}</RouterLink>
      </Menu.Item>)}
    </Menu.Content></Menu.Positioner></Portal>
  </Menu.Root>;
}
