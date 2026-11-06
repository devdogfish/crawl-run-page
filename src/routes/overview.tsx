// Overview · /[site]/overview: the executive view, and the page the app opens on.
// One screen, four blocks, each answering one question (see src/lib/overview.ts):
//   Trend → Fix next → What changed → By category.
// Numbers are always the latest finished crawl, so the page never shows half-crawled data; the only trace of the
// crawler is "as of <date>". Everything links into Pages or Issues for the people doing the fixing.
import { useMemo, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import { Badge, Box, Container, Flex, Grid, HStack, Heading, SegmentGroup, Stack, Text } from "@chakra-ui/react";

import { Delta, Help, MoreLink, Panel, SectionHeading, Sparkline } from "@/components/analytics-ui";
import { useSite } from "@/components/site-context";
import { BANDS, CAT_COLOR, SCORE_HELP, bandColor, bandOf, diff, fmtInt, history, inRange, links, snapshot } from "@/lib/analytics";
import { URGENCY_HELP, WINDOWS, changes, fmtUrgency, fmtViews, model, typeLabel, type ChangedPage, type RankedPage, type Window } from "@/lib/overview";
import type { Priority } from "@/lib/priority";
import { CATEGORIES } from "@/lib/site-pages";
import { SITES, type SiteId } from "@/lib/sites";

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

export default function Overview({ header }: { header?: (filters?: ReactNode) => ReactNode }) {
  const site = useSite();
  const m = model(site);
  const snap = snapshot(site);
  return (
    <Box bg="bg" minH="100vh">
      {header ? header(
        <Text textStyle="sm" color="fg.muted">
          {SITES[site].url.replace(/^https?:\/\/(www\.)?/, "")} · {fmtInt(snap.pages)} pages · as of {fmtDate(m.date)}
        </Text>
      ) : <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="6xl" pt="7" pb="5">
          <Heading size="xl" fontWeight="semibold">Overview</Heading>
          <Text textStyle="sm" color="fg.muted" mt="1">
            {SITES[site].url.replace(/^https?:\/\/(www\.)?/, "")} · {fmtInt(snap.pages)} pages · as of {fmtDate(m.date)}
          </Text>
        </Container>
      </Box>}
      <Container maxW="6xl" py={{ base: "6", md: "8" }}>
        <Stack gap={{ base: "10", md: "12" }}>
          <Trend site={site} />
          <FixNext site={site} />
          <WhatChanged site={site} />
          <ByCategory site={site} />
        </Stack>
      </Container>
    </Box>
  );
}

// ───────── 1. Are we getting better or worse? ─────────
function Trend({ site }: { site: SiteId }) {
  const { snap, pts, d } = useMemo(() => {
    const snap = snapshot(site);
    return { snap, pts: inRange(history(site, snap), "30"), d: diff(site) };
  }, [site]);
  const first = pts[0], prev = pts[pts.length - 2] ?? first;
  const L = links(site);
  return (
    <Box as="section">
      <SectionHeading title="Are we getting better?" description="The whole site, compared with 30 days ago." />
      <Grid templateColumns={{ base: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }} gap="3">
        <TrendCard label="Health score" help={SCORE_HELP} value={snap.score} spark={pts.map((p) => p.score)}
          delta={<Delta now={snap.score} then={first.score} goodWhen="up" label="in 30 days" />} />
        <TrendCard label="P1 critical issues" value={fmtInt(snap.priority.P1.issues)} spark={pts.map((p) => p.P1)} to={L.issues({ pri: "P1" })}
          delta={<Delta now={snap.priority.P1.issues} then={first.P1} goodWhen="down" label="in 30 days" />} />
        <TrendCard label="P2 serious issues" value={fmtInt(snap.priority.P2.issues)} spark={pts.map((p) => p.P2)} to={L.issues({ pri: "P2" })}
          delta={<Delta now={snap.priority.P2.issues} then={first.P2} goodWhen="down" label="in 30 days" />} />
        <TrendCard label="Since yesterday" value={<HStack gap="2" as="span"><Text as="span" color="green.fg">−{fmtInt(d.fixed)}</Text><Text as="span" color="fg.subtle">/</Text><Text as="span" color="red.fg">+{fmtInt(d.added)}</Text></HStack>}
          help="Issues fixed since the previous crawl, and issues that are new in this one."
          delta={<Text textStyle="xs" color="fg.muted">fixed / new · score {snap.score - prev.score >= 0 ? "+" : "−"}{Math.abs(snap.score - prev.score)} vs yesterday</Text>} />
      </Grid>
    </Box>
  );
}

function TrendCard({ label, value, delta, spark, help, to }: { label: string; value: React.ReactNode; delta: React.ReactNode; spark?: number[]; help?: string; to?: string }) {
  const body = (
    <Stack gap="2" h="full">
      <HStack gap="1.5"><Text textStyle="xs" color="fg.muted" truncate>{label}</Text>{help && <Help text={help} />}</HStack>
      <Text textStyle="2xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{value}</Text>
      {delta}
      {spark && <Box mt="auto" pt="1"><Sparkline values={spark} h="8" /></Box>}
    </Stack>
  );
  return (
    <Box borderWidth="1px" rounded="l3" p="4" minW="0" asChild={!!to} _hover={to ? { borderColor: "border.emphasized" } : undefined}>
      {to ? <RouterLink to={to}>{body}</RouterLink> : body}
    </Box>
  );
}

// ───────── 2. What should we fix next? ─────────
function FixNext({ site }: { site: SiteId }) {
  const m = model(site);
  const L = links(site);
  return (
    <Box as="section">
      <SectionHeading title="Fix next" description={<>Ranked by urgency: how bad a page is, weighed by how many people see it. <Help text={URGENCY_HELP} /></>} />
      <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 1.6fr) minmax(0, 1fr)" }} gap="4" alignItems="start">
        <Panel title="Pages" description="Issues on the page itself" action={<MoreLink to={L.pages({}, "worst")}>All pages</MoreLink>}>
          <PageList site={site} rows={m.ranked.slice(0, 10)} max={m.ranked[0]?.urgency ?? 1} />
        </Panel>
        <Panel title="Template fixes" description="Markup shared across pages: one fix clears every page it's on" action={<MoreLink to={L.issues({ markup: "shared" })}>All shared</MoreLink>}>
          <Stack gap="1">
            {m.fixes.slice(0, 6).map((f) => (
              <Box asChild key={`${f.rule}|${f.pattern}`} display="block" rounded="l2" px="2" py="2" mx="-2" _hover={{ bg: "bg.muted" }}>
                <RouterLink to={L.rule(f.rule)}>
                  <HStack gap="2" align="start">
                    <PriBadge p={f.priority} />
                    <Box flex="1" minW="0">
                      <Text textStyle="sm" lineClamp={1}>{f.title}</Text>
                      <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate>{f.pattern}</Text>
                      <Text textStyle="xs" color="fg.muted">{fmtInt(f.pages)} pages · {fmtViews(f.views)} views</Text>
                    </Box>
                    <Urgency value={f.urgency} />
                  </HStack>
                </RouterLink>
              </Box>
            ))}
          </Stack>
        </Panel>
      </Grid>
    </Box>
  );
}

function PageList({ site, rows, max, extra }: { site: SiteId; rows: (RankedPage | ChangedPage)[]; max: number; extra?: (r: ChangedPage) => React.ReactNode }) {
  const L = links(site);
  if (!rows.length) return <Text textStyle="sm" color="fg.muted" py="6" textAlign="center">Nothing here.</Text>;
  return (
    <Stack gap="0" separator={<Box borderTopWidth="1px" borderColor="border.muted" />}>
      {rows.map((r, k) => {
        const counts = countBy(r.rules.map((x) => x.priority));
        return (
          <Box asChild key={r.page.i} display="block" rounded="l2" px="2" py="2.5" mx="-2" _hover={{ bg: "bg.muted" }}>
            <RouterLink to={L.page(r.page.i)}>
              <Flex gap="3" align="center">
                <Text textStyle="xs" color="fg.subtle" w="4" textAlign="right" fontVariantNumeric="tabular-nums" flexShrink={0}>{k + 1}</Text>
                <Box flex="1" minW="0">
                  <HStack gap="2" minW="0">
                    {extra && "change" in r && extra(r)}
                    <Text textStyle="sm" fontWeight="medium" truncate>{r.page.title}</Text>
                  </HStack>
                  <HStack gap="2" textStyle="xs" color="fg.muted" mt="0.5" wrap="wrap" rowGap="0.5">
                    <Text>{typeLabel(r.page.type)}</Text>
                    <Text color="fg.subtle">·</Text>
                    <Text fontVariantNumeric="tabular-nums">{fmtViews(r.views)} views{r.estimated && <Text as="span" color="fg.subtle"> (est.)</Text>}</Text>
                    {(["P1", "P2", "P3"] as Priority[]).filter((p) => counts[p]).map((p) => (
                      <Text key={p} color={p === "P3" ? "fg.muted" : PRI_TEXT[p]} fontWeight="medium">{counts[p]} {p}</Text>
                    ))}
                  </HStack>
                </Box>
                <Box w={{ base: "14", sm: "28" }} flexShrink={0}>
                  <Urgency value={r.urgency} max={max} />
                </Box>
              </Flex>
            </RouterLink>
          </Box>
        );
      })}
    </Stack>
  );
}

const PRI_TEXT: Record<Priority, string> = { P1: "red.fg", P2: "orange.fg", P3: "fg.muted", P4: "fg.muted" };
const countBy = (xs: Priority[]) => xs.reduce((o, p) => ({ ...o, [p]: (o[p] ?? 0) + 1 }), {} as Partial<Record<Priority, number>>);

function PriBadge({ p }: { p: Priority }) {
  return <Badge size="sm" variant="subtle" colorPalette={p === "P1" ? "red" : p === "P2" ? "orange" : "gray"} flexShrink={0}>{p}</Badge>;
}

// The urgency number, with a bar against the list's top when there's a max
function Urgency({ value, max }: { value: number; max?: number }) {
  return (
    <Stack gap="1" align="end" flexShrink={0}>
      <Text textStyle="sm" fontWeight="semibold" fontVariantNumeric="tabular-nums" lineHeight="1">{fmtUrgency(value)}</Text>
      {max != null && (
        <Box w="full" h="1" rounded="full" bg="bg.muted" display={{ base: "none", sm: "block" }}>
          <Box h="full" rounded="full" bg="red.solid" w={`${Math.max(3, (value / max) * 100)}%`} />
        </Box>
      )}
    </Stack>
  );
}

// ───────── 3. What did the latest changes do? ─────────
function WhatChanged({ site }: { site: SiteId }) {
  const [w, setW] = useState<Window>("1");
  const c = useMemo(() => changes(site, w), [site, w]);
  const win = WINDOWS.find((x) => x.value === w)!;
  const top = c.rows.slice(0, 8);
  return (
    <Box as="section">
      <SectionHeading title="What changed" description="New and edited pages, ranked by urgency. New pages get the most traffic, so they rise; an edited article from years ago stays low."
        action={
          <SegmentGroup.Root size="sm" value={w} onValueChange={(e) => e.value && setW(e.value as Window)}>
            <SegmentGroup.Indicator bg="bg" />
            <SegmentGroup.Items items={WINDOWS.map((x) => ({ value: x.value, label: x.label }))} />
          </SegmentGroup.Root>
        } />
      <Panel>
        <Grid templateColumns={{ base: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }} gap="4" pb="4" mb="2" borderBottomWidth="1px">
          <Fact label="New pages" value={c.newPages} />
          <Fact label="Edited pages" value={c.changedPages} />
          <Fact label="Brought new P1 or P2 issues" value={c.newP1P2} tone={c.newP1P2 ? "red.fg" : undefined} />
          <Fact label="Removed pages" value={c.removed} />
        </Grid>
        <Text textStyle="xs" color="fg.muted" mb="1">
          {c.since ? `${fmtInt(c.rows.length)} new or edited ${win.long} (since ${fmtDate(c.since)})${c.rows.length > top.length ? `, top ${top.length} shown` : ""}` : "No earlier crawl to compare with."}
        </Text>
        <PageList site={site} rows={top} max={top[0]?.urgency || 1} extra={(r) => (
          <>
            <Badge size="sm" variant="subtle" colorPalette={r.change === "new" ? "blue" : "gray"} flexShrink={0}>{r.change === "new" ? "New" : "Edited"}</Badge>
            {r.added > 0 && r.addedTop && (r.addedTop === "P1" || r.addedTop === "P2") && (
              <Badge size="sm" variant="outline" colorPalette={r.addedTop === "P1" ? "red" : "orange"} flexShrink={0}>+{r.added} new</Badge>
            )}
          </>
        )} />
      </Panel>
    </Box>
  );
}

function Fact({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Stack gap="1" minW="0">
      <Text textStyle="xs" color="fg.muted" lineClamp={1}>{label}</Text>
      <Text textStyle="xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums" color={tone}>{fmtInt(value)}</Text>
    </Stack>
  );
}

// ───────── 4. How do we do per category? ─────────
function ByCategory({ site }: { site: SiteId }) {
  const { snap, pts } = useMemo(() => {
    const snap = snapshot(site);
    return { snap, pts: inRange(history(site, snap), "30") };
  }, [site]);
  const L = links(site);
  return (
    <Box as="section">
      <SectionHeading title="By category" description="Score out of 100 per area, with the last 30 days." />
      <Grid templateColumns={{ base: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }} gap="3">
        {CATEGORIES.map((c) => {
          const s = snap.category[c.id];
          return (
            <Box asChild key={c.id} display="block" borderWidth="1px" rounded="l3" p="4" minW="0" _hover={{ borderColor: "border.emphasized" }}>
              <RouterLink to={L.issues({ cat: c.id })}>
                <Stack gap="2">
                  <HStack gap="2"><Box boxSize="2.5" rounded="sm" bg={CAT_COLOR[c.id]} flexShrink={0} /><Text textStyle="xs" color="fg.muted" truncate>{c.label}</Text></HStack>
                  <HStack gap="2" align="baseline">
                    <Text textStyle="2xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{s.score}</Text>
                    <Text textStyle="xs" color={`${bandColor(s.score)}.fg`} fontWeight="medium">{BANDS.find((b) => b.id === bandOf(s.score))!.label}</Text>
                  </HStack>
                  <Delta now={s.score} then={pts[0].cat[c.id]} goodWhen="up" label="in 30 days" />
                  <Sparkline values={pts.map((p) => p.cat[c.id])} color={CAT_COLOR[c.id]} h="8" />
                  <Text textStyle="xs" color="fg.muted">{fmtInt(s.pages)} pages with issues</Text>
                </Stack>
              </RouterLink>
            </Box>
          );
        })}
      </Grid>
    </Box>
  );
}
