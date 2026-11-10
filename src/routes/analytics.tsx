// Analytics · /[site]/analytics: how healthy the site is and where it's heading, for everyone who works on it
// (operations, marketing, content, development). High level first; every number links to the Issues or Pages
// view behind it so anyone can drill down.
//
// PROTOTYPE: variations remain accessible through ?v= and the Prototypes menu. Pick one, then delete the
// others and the control.
//   report   → one column read top to bottom, like a weekly health report
//   board    → a dense dashboard grid: tiles, a priority × category heatmap, a section treemap
//   explorer → pick a part of the site on the left; every chart on the right follows it
//   dashboard → (default) what the prior-art research recommends: report's single column, explorer's scope as a
//               sticky bar, ranked "points at stake" fixes, trend with target and change markers, crawl diff
// Data: src/lib/analytics.ts (always the latest finished crawl; the range only changes how far back trends look).
import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Box, Button, Container, Flex, HStack, Heading, Icon, Menu, Portal, Text } from "@chakra-ui/react";

import { LuCheck, LuChevronDown } from "react-icons/lu";
import { TrendRangeContext } from "@/components/analytics/trend-range";
import { useSite } from "@/components/site-context";
import { HealthReport } from "@/components/analytics/report";
import { HealthBoard } from "@/components/analytics/board";
import { HealthExplorer } from "@/components/analytics/explorer";
import { HealthDashboard } from "@/components/analytics/dashboard";
import { HealthSummary } from "@/components/analytics/summary";
import Overview from "@/routes/overview";
import { RANGES, type Range } from "@/lib/analytics";

type Variant = "overview" | "summary" | "dashboard" | "report" | "board" | "explorer";
const VARIANTS: { value: Variant; label: string }[] = [
  { value: "summary", label: "Overview" },
  { value: "overview", label: "Old overview" },
  { value: "dashboard", label: "Dashboard" }, { value: "report", label: "Report" }, { value: "board", label: "Board" }, { value: "explorer", label: "Explorer" },
];

export default function AnalyticsPage() {
  return <Suspense><Analytics /></Suspense>;
}

function Analytics() {
  const site = useSite();
  const [sp, setSp] = useSearchParams();
  const v = (VARIANTS.find((x) => x.value === sp.get("v"))?.value ?? "summary") as Variant;
  const range = (RANGES.find((x) => x.value === sp.get("range"))?.value ?? "30") as Range;
  const update = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(sp);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setSp(next, { replace: true });
  };
  const setV = (value: Variant) => update("v", value, "summary");
  const setRange = (value: Range) => update("range", value, "30");

  const header = (filters?: ReactNode) => (
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="7" pb="5">
          <Flex gap="4" align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }} justify="space-between" wrap="wrap">
          <HStack gap="3" align="center" flexShrink={0}>
            <Heading size="xl" fontWeight="semibold">Overview</Heading>
            <Menu.Root positioning={{ placement: "bottom-start" }}>
              <Menu.Trigger asChild>
                <Button size="sm" variant="ghost" color="fg.muted">
                  Prototypes<Icon as={LuChevronDown} boxSize="3" />
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="44">
                    {VARIANTS.map((item) => (
                      <Menu.Item key={item.value} value={item.value} onClick={() => setV(item.value)}>
                        <Text flex="1">{item.label}</Text>
                        {v === item.value && <Icon as={LuCheck} boxSize="4" aria-label="Selected" />}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          </HStack>
          {filters && <Box minW="0">{filters}</Box>}
          </Flex>
          <Text textStyle="xs" color="fg.muted" mt="3">Demo · Public page captures with sample audit results and crawl history</Text>
        </Container>
      </Box>
  );

  return (
    <Box bg="bg" minH="100vh">
      {v !== "summary" && v !== "overview" && header()}
      <TrendRangeContext.Provider value={{ range, setRange }}>
      {v === "overview" && <Overview header={header} />}
      {v === "summary" && <HealthSummary site={site} range={range} header={header} />}
      {v === "dashboard" && <HealthDashboard site={site} range={range} />}
      {v === "report" && <HealthReport site={site} range={range} />}
      {v === "board" && <HealthBoard site={site} range={range} />}
      {v === "explorer" && <HealthExplorer site={site} range={range} />}
      </TrendRangeContext.Provider>
    </Box>
  );
}
