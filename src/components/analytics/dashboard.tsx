import { TrendRange } from "@/components/analytics/trend-range";
// Variation D · Dashboard: the layout the prior-art research recommends (reports/Enterprise site health dashboard patterns.md).
// One column, executive answer first, then the detail to act on:
//   scope bar (sticky, in the URL) → headline: score with change, band, a bar against the target with the points
//   at stake, and pages by worst issue → the four categories, each with its biggest fix → where the missing points
//   go (rules ranked by points, Silktide/Siteimprove style) → trend with target and change markers, and the diff since
//   the previous crawl → sections ranked worst first, a row click narrows the whole page.
// No gauges, donuts, treemaps or forecasts: lengths and positions compare better than angles and areas, and no
// shipped health tool forecasts its score.
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Badge, Box, Button, Container, Flex, Grid, HStack, Icon, NativeSelect, Stack, Table, Text } from "@chakra-ui/react";
import { Chart, useChart } from "@chakra-ui/charts";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { LuCircleAlert, LuCircleCheck, LuCircleX, LuLayoutTemplate } from "react-icons/lu";

import { Delta, Help, MoreLink, Panel, ScoreChip, SectionHeading, SegBar, Sparkline, type Part } from "@/components/analytics-ui";
import { useHealth, type Health } from "@/components/analytics/use-health";
import { Tooltip } from "@/components/ui/tooltip";
import {
  BANDS, CAT_COLOR, PRI_COLOR, PRI_LABEL, RULESET, SCORE_HELP, TARGET, bandOf, diff, fmtInt, history, inRange, pct, ruleCost,
  scopeName, snapshot, subName, typeName, type Band, type Filter, type Range,
} from "@/lib/analytics";
import { PRIORITIES, PRIORITY_COLOR } from "@/lib/priority";
import { CATEGORIES, type Category, type PageType } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

const BAND_ICON: Record<Band, typeof LuCircleCheck> = { good: LuCircleCheck, fair: LuCircleAlert, poor: LuCircleX };
const bandInfo = (score: number) => BANDS.find((b) => b.id === bandOf(score))!;

// ───────── Scope in the URL (?scope=type/sub), so every chart and link follows it ─────────
const parseScope = (v: string | null): Filter => {
  const [type, sub] = (v ?? "").split("/");
  return { type: (type || undefined) as PageType | undefined, sub: sub || undefined };
};
function useScope() {
  const [scope, setScope] = useState<Filter>(() => parseScope(new URLSearchParams(window.location.search).get("scope")));
  useEffect(() => {
    const write = (f: Filter) => {
      const p = new URLSearchParams(window.location.search);
      if (f.type) p.set("scope", [f.type, f.sub].filter(Boolean).join("/")); else p.delete("scope");
      const q = p.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    };
    write(scope);
    return () => write({});
  }, [scope]);
  return [scope, setScope] as const;
}

export function HealthDashboard({ site, range }: { site: SiteId; range: Range }) {
  const [scope, setScope] = useScope();
  const h = useHealth(site, range, scope);
  const d = useMemo(() => diff(site, scope), [site, scope.type, scope.sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useState<{ gain: number; label: string } | null>(null);
  // Every rule, by the points it costs this scope
  const costs = useMemo(() => h.snap.rules.map((r) => ({ r, cost: ruleCost(r, h.snap.pages), template: r.sharedPages >= r.pages * 0.8 }))
    .sort((a, b) => b.cost - a.cost), [h.snap]);

  return (
    <>
      <ScopeBar site={site} scope={scope} onScope={setScope} h={h} focus={focus} />
      <Container maxW="6xl" py={{ base: "6", md: "8" }}>
        <Stack gap={{ base: "10", md: "12" }}>
          <Headline h={h} scope={scope} focus={focus} />
          <Pillars h={h} costs={costs} scope={scope} />
          <MissingPoints h={h} costs={costs} scope={scope} onFocus={setFocus} />
          <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 1.7fr) minmax(0, 1fr)" }} gap="4" alignItems="start">
            <TrendPanel h={h} />
            <DiffPanel h={h} d={d} scope={scope} />
          </Grid>
          {h.snap.groups.length > 1 && <Sections site={site} range={range} h={h} scope={scope} onScope={setScope} />}
        </Stack>
      </Container>
    </>
  );
}

// ───────── Scope bar: what part of the site, and how much of it the numbers cover ─────────
function ScopeBar({ site, scope, onScope, h, focus }: { site: SiteId; scope: Filter; onScope: (f: Filter) => void; h: Health; focus: { gain: number; label: string } | null }) {
  const types = snapshot(site).groups;
  const subs = scope.type ? snapshot(site, { type: scope.type }).groups.filter((g) => g.filter.sub) : [];
  const asOf = h.snap.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <Box position="sticky" top="var(--sticky-top, 0px)" zIndex="docked" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
      <Container maxW="6xl" py="2.5">
        <Flex gap={{ base: "2", md: "4" }} align={{ base: "stretch", md: "center" }} direction={{ base: "column", md: "row" }}>
          <HStack gap="2" flex="1" minW="0">
            <Text textStyle="xs" color="fg.muted" flexShrink={0}>Showing</Text>
            <NativeSelect.Root size="sm" maxW="56">
              <NativeSelect.Field aria-label="Section" value={scope.type ?? ""} onChange={(e) => onScope({ type: (e.currentTarget.value || undefined) as PageType | undefined })}>
                <option value="">Whole site</option>
                {types.map((g) => <option key={g.filter.type} value={g.filter.type}>{g.label} ({fmtInt(g.pages)})</option>)}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            {subs.length > 0 && (
              <NativeSelect.Root size="sm" maxW="44">
                <NativeSelect.Field aria-label="Part" value={scope.sub ?? ""} onChange={(e) => onScope({ type: scope.type, sub: e.currentTarget.value || undefined })}>
                  <option value="">All of {typeName(scope.type!).toLowerCase()}</option>
                  {subs.map((g) => <option key={g.filter.sub} value={g.filter.sub}>{subName(scope.type!, g.filter.sub!)} ({fmtInt(g.pages)})</option>)}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            )}
          </HStack>
          {focus ? (
            // While a fix is hovered further down, the bar that's always in view shows what it's worth
            <HStack gap="2" textStyle="xs" minW="0">
              <Text color="fg.muted" flexShrink={0}>Score</Text>
              <Text fontWeight="semibold" fontVariantNumeric="tabular-nums">{h.snap.score}</Text>
              <Text color="fg.muted">→</Text>
              <Text fontWeight="semibold" color="blue.fg" fontVariantNumeric="tabular-nums">{Math.min(100, h.snap.score + focus.gain).toFixed(1)}</Text>
              <Text color="fg.muted" truncate>if {focus.label} is fixed</Text>
            </HStack>
          ) : (
          <HStack gap="1.5" textStyle="xs" color="fg.muted" wrap="wrap">
            <Text>{fmtInt(h.snap.pages)} pages · crawl #{h.snap.crawl} · {asOf} · rule set {RULESET} · automated checks only</Text>
            <Help text="Automated checks find part of the problems: studies put it at 13–57% of accessibility barriers. The score is a lower bound on what's wrong, not a conformance rating. Performance is scored on the pages Lighthouse audited." />
          </HStack>
          )}
        </Flex>
      </Container>
    </Box>
  );
}

// ───────── Headline: the answer before any chart ─────────
function Headline({ h, scope, focus }: { h: Health; scope: Filter; focus: { gain: number; label: string } | null }) {
  const { snap, first, last, all, L } = h;
  const band = bandInfo(snap.score);
  const prev = all.length > 1 ? all[all.length - 2] : null;
  const change = last.score - first.score;
  const top = snap.fixes[0];
  const shared = Math.max(0, snap.scoreNoShared - snap.score);
  const worstCat = CATEGORIES.map((c) => ({ c, s: snap.category[c.id], t: last.cat[c.id] - first.cat[c.id] })).sort((a, b) => a.t - b.t)[0];
  const sentence = [
    `${scopeName(scope)} scores ${snap.score}, ${change === 0 ? "unchanged" : `${change > 0 ? "up" : "down"} ${Math.abs(change)} point${Math.abs(change) === 1 ? "" : "s"}`} in ${h.days} days.`,
    worstCat.t <= -2 ? `${worstCat.c.label} fell ${Math.abs(Math.round(worstCat.t))} points.` : null,
    top && top.gain >= 0.5 ? `Fixing "${top.rule.title}" in one template would add ${top.gain.toFixed(1)} points.` : null,
  ].filter(Boolean).join(" ");

  const parts: Part[] = [...PRIORITIES.map((p) => ({ name: `Worst issue ${p} ${PRI_LABEL[p]}`, value: snap.worstPages[p], color: PRI_COLOR[p], to: L.pages(scope, "worst", { worst: p }) })),
    { name: "No issues", value: snap.worstPages.none, color: "green.solid", to: L.pages(scope, "worst", { worst: "none" }) }];

  return (
    <Box as="section">
      <Text textStyle={{ base: "lg", md: "2xl" }} fontWeight="medium" lineHeight="1.35" maxW="4xl" textWrap="balance">{sentence}</Text>
      <Grid mt="6" templateColumns={{ base: "minmax(0, 1fr)", md: "minmax(0, 1.25fr) minmax(0, 1fr)" }} gap="4">
        <Panel>
          <Flex gap="6" align="end" wrap="wrap">
            <Stack gap="1">
              <HStack gap="1.5"><Text textStyle="xs" color="fg.muted">Health score</Text><Help text={`${SCORE_HELP} Without issues in shared markup (header, footer, banners) it would be ${snap.scoreNoShared}.`} /></HStack>
              <HStack gap="1" align="baseline">
                <Text fontSize="5xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{snap.score}</Text>
                <Text textStyle="lg" color="fg.muted">/100</Text>
              </HStack>
            </Stack>
            <Stack gap="1.5" pb="1">
              <HStack gap="1.5" color={`${band.color}.fg`} textStyle="sm" fontWeight="medium"><Icon as={BAND_ICON[band.id]} />{band.label}</HStack>
              <Delta now={last.score} then={first.score} goodWhen="up" suffix=" pts" label={h.since} />
              {prev && <Delta now={last.score} then={prev.score} goodWhen="up" suffix=" pts" label="vs last crawl" />}
            </Stack>
            <Box flex="1" minW="32" alignSelf="stretch" display="flex" alignItems="end"><Sparkline values={h.pts.map((p) => p.score)} color="brand.solid" h="12" pad={2} /></Box>
          </Flex>
          <ScoreBar score={snap.score} shared={shared} focus={focus} />
        </Panel>
        <Panel title="Pages by their worst issue" description="Each page counted once. Critical blocks some users entirely.">
          <Stack gap="3">
            <HStack align="baseline" gap="2">
              <Text textStyle="3xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums" color={snap.p1Pages ? "red.fg" : "fg"}>{h.p1Share}%</Text>
              <Text textStyle="sm" color="fg.muted">of pages have a critical issue ({fmtInt(snap.p1Pages)} of {fmtInt(snap.pages)})</Text>
            </HStack>
            <SegBar parts={parts} h="3" />
            <Stack gap="0.5">
              {parts.map((p) => (
                <HStack key={p.name} gap="2" textStyle="xs" fontVariantNumeric="tabular-nums">
                  <Box boxSize="2.5" rounded="sm" bg={p.color} flexShrink={0} />
                  <Text flex="1" color="fg.muted">{p.name.replace("Worst issue ", "")}</Text>
                  <Text>{fmtInt(p.value)}</Text>
                  <Text w="9" textAlign="right" fontWeight="medium">{pct(p.value, snap.pages)}%</Text>
                </HStack>
              ))}
            </Stack>
          </Stack>
        </Panel>
      </Grid>
    </Box>
  );
}

// A bullet bar against 100: the score, the points one template pass would add, and the target tick.
// Hovering a rule below lights its gain here.
function ScoreBar({ score, shared, focus }: { score: number; shared: number; focus: { gain: number; label: string } | null }) {
  const band = bandInfo(score);
  const gain = focus ? Math.min(100 - score, focus.gain) : shared;
  return (
    <Box mt="5">
      <Box position="relative" h="3" rounded="full" bg="bg.muted">
        <Box position="absolute" insetY="0" left="0" w={`${score}%`} bg={`${band.color}.solid`} roundedLeft="full" />
        <Box position="absolute" insetY="0" left={`${score}%`} w={`${gain}%`} bg="blue.solid" opacity={focus ? 0.9 : 0.45}
          transition="width 0.15s, opacity 0.15s" css={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, rgba(255,255,255,.35) 4px 6px)" }} />
        <Box position="absolute" top="-1" bottom="-1" left={`${TARGET}%`} w="2px" bg="fg" rounded="full" />
      </Box>
      <HStack mt="2" justify="space-between" textStyle="xs" color="fg.muted" gap="3" wrap="wrap">
        <HStack gap="1.5">
          <Box boxSize="2.5" rounded="sm" bg="blue.solid" opacity={0.6} />
          <Text>{focus ? <>+{focus.gain.toFixed(1)} pts if <Text as="span" color="fg">{focus.label}</Text> is fixed</> : <>+{shared} pts if every shared-template issue is fixed</>}</Text>
        </HStack>
        <Text>Target {TARGET} · {score >= TARGET ? "met" : `${TARGET - score} to go`}</Text>
      </HStack>
    </Box>
  );
}

// ───────── The four categories, each ending in its biggest fix ─────────
type Cost = { r: Health["snap"]["rules"][number]; cost: number; template: boolean };
function Pillars({ h, costs, scope }: { h: Health; costs: Cost[]; scope: Filter }) {
  const { snap, pts, first, last, L } = h;
  const note: Partial<Record<Category, string>> = {
    accessibility: "Automated checks only",
    performance: `Lab scores on ${fmtInt(snap.category.performance.scored)} audited pages`,
  };
  return (
    <Box as="section">
      <SectionHeading title="By category" description="Each category scored on its own rules. The line under each is the fix worth the most points there." />
      <Grid templateColumns={{ base: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }} gap="3">
        {CATEGORIES.map((c) => {
          const s = snap.category[c.id];
          const band = bandInfo(s.score);
          const top = costs.find((x) => x.r.rule.category === c.id);
          return (
            <Stack key={c.id} gap="3" borderWidth="1px" rounded="l3" p="4" minW="0" borderTopWidth="3px" borderTopColor={CAT_COLOR[c.id]}>
              <HStack justify="space-between" gap="2">
                <Text textStyle="sm" fontWeight="semibold" truncate>{c.label}</Text>
                <HStack gap="1" color={`${band.color}.fg`} textStyle="xs" flexShrink={0}><Icon as={BAND_ICON[band.id]} />{band.label}</HStack>
              </HStack>
              <HStack justify="space-between" align="end" gap="3">
                <Stack gap="1">
                  <Text textStyle="3xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{s.score}</Text>
                  <Delta now={last.cat[c.id]} then={first.cat[c.id]} goodWhen="up" label={h.since} />
                </Stack>
                <Box flex="1" minW="0" maxW="24"><Sparkline values={pts.map((p) => p.cat[c.id])} color={CAT_COLOR[c.id]} h="9" pad={3} /></Box>
              </HStack>
              <Text textStyle="xs" color="fg.muted">
                <RouterLink to={L.issues({ cat: c.id, type: scope.type })}><Text as="span" color="fg" textDecoration="underline" textDecorationColor="border">{fmtInt(s.issues)} issues</Text></RouterLink>
                {" "}on {pct(s.pages, s.scored || 1)}% of pages{note[c.id] ? ` · ${note[c.id]}` : ""}
              </Text>
              <Box mt="auto" pt="3" borderTopWidth="1px" borderColor="border.muted">
                {top ? (
                  <HStack asChild gap="2" textStyle="xs" _hover={{ "& .t": { textDecoration: "underline" } }}>
                    <RouterLink to={L.rule(top.r.rule.id)}>
                      <Badge size="sm" variant="subtle" colorPalette="blue" fontVariantNumeric="tabular-nums" flexShrink={0}>{top.cost < 0.1 ? "<0.1" : `+${top.cost.toFixed(1)}`}</Badge>
                      <Text className="t" truncate title={top.r.rule.title}>Fix {top.r.rule.title}</Text>
                    </RouterLink>
                  </HStack>
                ) : <Text textStyle="xs" color="fg.subtle">Nothing costing points</Text>}
              </Box>
            </Stack>
          );
        })}
      </Grid>
    </Box>
  );
}

// ───────── Where the missing points go: every rule, ranked by the points it costs ─────────
function MissingPoints({ h, costs, scope, onFocus }: { h: Health; costs: Cost[]; scope: Filter; onFocus: (f: { gain: number; label: string } | null) => void }) {
  const { snap, L } = h;
  const [all, setAll] = useState(false);
  const ranked = costs.filter((x) => x.cost >= 0.05);
  const rows = all ? ranked.slice(0, 30) : ranked.slice(0, 8);
  const max = Math.max(1, ...ranked.map((x) => x.cost));
  const shown = ranked.slice(0, 8).reduce((t, x) => t + x.cost, 0);
  return (
    <Box as="section">
      <SectionHeading title={`Where the missing ${100 - snap.score} points go`}
        description={`Each rule costs the score its weight on every page it fails. The top ${Math.min(8, ranked.length)} account for ${Math.round(Math.min(shown, 100 - snap.score))} points. Hover a row to see its gain on the score bar.`}
        action={<MoreLink to={L.issues({ type: scope.type })}>All issues</MoreLink>} />
      <Box borderWidth="1px" rounded="l3" overflow="hidden" onMouseLeave={() => onFocus(null)}>
        {rows.map(({ r, cost, template }) => (
          <Box asChild key={r.rule.id} display="block" borderTopWidth="1px" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }}>
            <RouterLink to={L.rule(r.rule.id)} onMouseEnter={() => onFocus({ gain: cost, label: r.rule.title })} onFocus={() => onFocus({ gain: cost, label: r.rule.title })}>
              <Grid templateColumns={{ base: "56px minmax(0, 1fr)", md: "64px minmax(0, 1fr) 160px 90px" }} gap={{ base: "3", md: "4" }} px="4" py="2.5" alignItems="center">
                <Text textStyle="sm" fontWeight="semibold" color="blue.fg" fontVariantNumeric="tabular-nums" textAlign="right">−{cost.toFixed(1)}</Text>
                <Stack gap="0.5" minW="0">
                  <HStack gap="2" minW="0">
                    <Box boxSize="2" rounded="full" bg={CAT_COLOR[r.rule.category]} flexShrink={0} />
                    <Text textStyle="sm" truncate>{r.rule.title}</Text>
                    {template && (
                      <Tooltip content="Mostly in markup shared across pages: one fix in the template covers all of them." openDelay={100}>
                        <Badge size="xs" variant="outline" flexShrink={0} gap="1"><Icon as={LuLayoutTemplate} boxSize="3" />Template</Badge>
                      </Tooltip>
                    )}
                  </HStack>
                  <HStack gap="2" textStyle="xs" color="fg.muted">
                    <Text color={PRIORITY_COLOR[r.priority]} fontWeight="medium">{r.priority} {PRI_LABEL[r.priority]}</Text>
                    <Text>·</Text><Text>{fmtInt(r.pages)} pages</Text>
                    <Text display={{ md: "none" }}>· {pct(r.pages, snap.pages)}%</Text>
                  </HStack>
                </Stack>
                <Box display={{ base: "none", md: "block" }} h="2" rounded="full" bg="bg.muted" overflow="hidden">
                  <Box h="full" w={`${(cost / max) * 100}%`} bg="blue.solid" rounded="full" />
                </Box>
                <Text display={{ base: "none", md: "block" }} textStyle="xs" color="fg.muted" textAlign="right" fontVariantNumeric="tabular-nums">{pct(r.pages, snap.pages)}% of pages</Text>
              </Grid>
            </RouterLink>
          </Box>
        ))}
        {ranked.length > 8 && (
          <Box borderTopWidth="1px" px="4" py="2">
            <Button size="xs" variant="ghost" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${Math.min(30, ranked.length) - 8} more`}</Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ───────── Trend: score with target and bands, marked where something other than the site changed ─────────
function TrendPanel({ h }: { h: Health }) {
  const data = h.pts.map((p) => ({ label: p.label, score: p.score, pages: p.pages, note: p.note }));
  const chart = useChart({ data, series: [{ name: "score", color: "brand.solid", label: "Health score" }] });
  const pagesChart = useChart({ data, series: [{ name: "pages", color: "gray.emphasized", label: "Pages crawled" }] });
  const ys = data.map((d) => d.score);
  const lo = Math.max(0, Math.floor((Math.min(...ys, TARGET) - 6) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...ys, TARGET) + 4) / 5) * 5);
  const notes = data.filter((d) => d.note);
  const step = hi - lo > 30 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, k) => lo + k * step);
  return (
    <Panel action={<TrendRange />} title="Health score over time" description={`One point per crawl. Dashed lines mark changes to the rules or releases, so a jump isn't misread.`}>
      <Chart.Root chart={chart} h="56">
        <LineChart responsive data={chart.data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }} syncId="trend">
          <ReferenceArea y1={80} y2={100} fill={chart.color("green.subtle")} fillOpacity={0.35} ifOverflow="hidden" />
          <ReferenceArea y1={60} y2={80} fill={chart.color("orange.subtle")} fillOpacity={0.3} ifOverflow="hidden" />
          <ReferenceArea y1={0} y2={60} fill={chart.color("red.subtle")} fillOpacity={0.3} ifOverflow="hidden" />
          <CartesianGrid stroke={chart.color("border.muted")} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} interval="preserveStartEnd" minTickGap={32} />
          <YAxis domain={[lo, hi]} ticks={ticks} width={30} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} />
          <ReferenceLine y={TARGET} stroke={chart.color("fg")} strokeDasharray="4 3" label={{ value: `Target ${TARGET}`, position: "insideTopRight", fontSize: 11, fill: chart.color("fg.muted") }} />
          {notes.map((n) => (
            <ReferenceLine key={n.label} x={n.label} stroke={chart.color("orange.solid")} strokeDasharray="3 3" />
          ))}
          <RTooltip animationDuration={0} content={<Chart.Tooltip />} />
          <Line isAnimationActive={false} type="monotone" dataKey="score" stroke={chart.color("brand.solid")} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: chart.color("bg"), strokeWidth: 2 }} />
        </LineChart>
      </Chart.Root>
      <Chart.Root chart={pagesChart} h="10" mt="1">
        <BarChart responsive data={pagesChart.data} margin={{ top: 0, right: 12, left: 30, bottom: 0 }} syncId="trend">
          <XAxis dataKey="label" hide />
          <YAxis hide domain={[0, "dataMax"]} />
          <RTooltip animationDuration={0} cursor={false} content={<Chart.Tooltip formatter={(v) => `${fmtInt(Number(v))} pages crawled`} hideLabel />} />
          <Bar isAnimationActive={false} dataKey="pages" fill={pagesChart.color("gray.emphasized")} radius={1} />
        </BarChart>
      </Chart.Root>
      <HStack mt="3" gap="4" wrap="wrap" textStyle="xs" color="fg.muted">
        <HStack gap="1.5"><Box w="3" h="0.5" bg="brand.solid" rounded="full" />Score</HStack>
        <HStack gap="1.5"><Box w="3" h="2" bg="gray.emphasized" rounded="sm" />Pages crawled (coverage)</HStack>
        {notes.map((n) => <HStack key={n.label} gap="1.5"><Box w="0" h="3" borderStartWidth="2px" borderStyle="dashed" borderColor="orange.solid" />{n.label}: {n.note}</HStack>)}
      </HStack>
    </Panel>
  );
}

// ───────── Since the previous crawl: new, fixed, still open ─────────
function DiffPanel({ h, d, scope }: { h: Health; d: ReturnType<typeof diff>; scope: Filter }) {
  const { L } = h;
  if (d.prev == null) return <Panel title="Since the last crawl"><Text textStyle="sm" color="fg.muted">This is the first crawl, so there's nothing to compare yet.</Text></Panel>;
  const max = Math.max(1, ...PRIORITIES.flatMap((p) => [d.byPriority[p].added, d.byPriority[p].fixed]));
  return (
    <Panel title="Since the last crawl" description={`Crawl #${d.prev} → #${h.snap.crawl}. An issue is one rule failing on one page.`}>
      <Grid templateColumns="repeat(3, 1fr)" gap="3">
        {[
          { label: "New", v: d.added, c: "red.fg" },
          { label: "Fixed", v: d.fixed, c: "green.fg" },
          { label: "Still open", v: d.persisting, c: "fg" },
        ].map((x) => (
          <Stack key={x.label} gap="0.5">
            <Text textStyle="xs" color="fg.muted">{x.label}</Text>
            <Text textStyle="2xl" fontWeight="semibold" lineHeight="1" color={x.c} fontVariantNumeric="tabular-nums">{fmtInt(x.v)}</Text>
          </Stack>
        ))}
      </Grid>
      <Stack gap="2" mt="5">
        <HStack textStyle="2xs" color="fg.muted" gap="2"><Box w="24" /><Text flex="1" textAlign="right">New</Text><Box w="px" /><Text flex="1">Fixed</Text></HStack>
        {PRIORITIES.map((p) => {
          const x = d.byPriority[p];
          return (
            <HStack asChild key={p} gap="2" textStyle="xs" fontVariantNumeric="tabular-nums" rounded="l1" _hover={{ bg: "bg.subtle" }}>
              <RouterLink to={L.issues({ pri: p, type: scope.type })}>
                <Text w="24" color={PRIORITY_COLOR[p]} fontWeight="medium" truncate>{p} {PRI_LABEL[p]}</Text>
                <HStack flex="1" justify="end" gap="1.5">
                  <Text color="fg.muted">{x.added ? `+${fmtInt(x.added)}` : "0"}</Text>
                  <Box h="2" w={`${(x.added / max) * 70}%`} minW={x.added ? "1" : 0} bg="red.solid" roundedLeft="sm" />
                </HStack>
                <Box w="px" alignSelf="stretch" bg="border" />
                <HStack flex="1" gap="1.5">
                  <Box h="2" w={`${(x.fixed / max) * 70}%`} minW={x.fixed ? "1" : 0} bg="green.solid" roundedRight="sm" />
                  <Text color="fg.muted">{x.fixed ? `−${fmtInt(x.fixed)}` : "0"}</Text>
                </HStack>
              </RouterLink>
            </HStack>
          );
        })}
      </Stack>
    </Panel>
  );
}

// ───────── Sections, worst first; a row narrows the whole page to it ─────────
function Sections({ site, range, h, scope, onScope }: { site: SiteId; range: Range; h: Health; scope: Filter; onScope: (f: Filter) => void }) {
  const { L } = h;
  const rows = useMemo(() => h.snap.groups.map((g) => {
    const pts = inRange(history(site, snapshot(site, g.filter)), range);
    return { g, pts, change: pts.length ? pts[pts.length - 1].score - pts[0].score : 0 };
  }).sort((a, b) => a.g.score - b.g.score), [site, range, h.snap]);
  const canNarrow = !scope.sub;
  return (
    <Box as="section">
      <SectionHeading title={scope.type ? `Parts of ${typeName(scope.type).toLowerCase()}` : "By section"}
        description={canNarrow ? "Lowest score first. Click a row to narrow the whole dashboard to it." : "Lowest score first."}
        action={<MoreLink to={L.pages(scope, "worst")}>Pages, worst first</MoreLink>} />
      <Box borderWidth="1px" rounded="l3" overflowX="auto">
        <Table.Root size="sm" interactive={canNarrow}>
          <Table.Header>
            <Table.Row bg="bg.subtle">
              <Table.ColumnHeader>Section</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end" display={{ base: "none", sm: "table-cell" }}>Pages</Table.ColumnHeader>
              <Table.ColumnHeader minW="40">Score</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Change</Table.ColumnHeader>
              <Table.ColumnHeader display={{ base: "none", md: "table-cell" }} w="32">Trend</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end" display={{ base: "none", sm: "table-cell" }}>Pages with P1</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map(({ g, pts, change }) => (
              <Table.Row key={g.label} cursor={canNarrow ? "pointer" : undefined} onClick={canNarrow ? () => { onScope(g.filter); window.scrollTo({ top: 0, behavior: "smooth" }); } : undefined}>
                <Table.Cell fontWeight="medium" maxW="56" truncate>{g.label}</Table.Cell>
                <Table.Cell textAlign="end" color="fg.muted" fontVariantNumeric="tabular-nums" display={{ base: "none", sm: "table-cell" }}>{fmtInt(g.pages)}</Table.Cell>
                <Table.Cell>
                  <HStack gap="2">
                    <ScoreChip score={g.score} />
                    <Box flex="1" h="1.5" rounded="full" bg="bg.muted" position="relative" minW="16">
                      <Box position="absolute" insetY="0" left="0" w={`${g.score}%`} rounded="full" bg={`${bandInfo(g.score).color}.solid`} />
                      <Box position="absolute" top="-1" bottom="-1" left={`${TARGET}%`} w="1px" bg="fg.muted" />
                    </Box>
                  </HStack>
                </Table.Cell>
                <Table.Cell textAlign="end"><Box display="inline-flex"><Delta now={change} then={0} goodWhen="up" /></Box></Table.Cell>
                <Table.Cell display={{ base: "none", md: "table-cell" }}><Sparkline values={pts.map((p) => p.score)} color="fg.muted" h="6" pad={2} /></Table.Cell>
                <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums" display={{ base: "none", sm: "table-cell" }} color={g.p1Pages ? "red.fg" : "fg.muted"}>
                  {g.p1Pages ? `${fmtInt(g.p1Pages)} (${pct(g.p1Pages, g.pages)}%)` : "None"}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Box>
  );
}
