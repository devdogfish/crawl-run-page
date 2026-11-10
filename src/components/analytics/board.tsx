import { TrendRange } from "@/components/analytics/trend-range";
// Variation B · Board: a dense dashboard grid, everything on one or two screens.
// Tiles with sparklines → priority × category heatmap and the executive donuts → a treemap of the site's sections
// (click to drill into a section, click again to open its pages) with category scores → trends and the top rules.
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { Box, Button, Container, Grid, GridItem, HStack, Stack, Text } from "@chakra-ui/react";
import { Treemap, ResponsiveContainer } from "recharts";
import { LuChevronLeft } from "react-icons/lu";

import { Delta, Donut, Help, MoreLink, MultiTrend, Panel, ScoreChip, ScoreDial, Sparkline, SegBar } from "@/components/analytics-ui";
import { p1Outlook, seriesOfPriority, useHealth } from "@/components/analytics/use-health";
import { CAT_COLOR, PRI_COLOR, PRI_LABEL, SCORE_HELP, bandColor, fmtInt, links, pct, snapshot, typeName, type Group, type Range } from "@/lib/analytics";
import { PRIORITIES, PRIORITY_COLOR } from "@/lib/priority";
import { CATEGORIES, type PageType } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

const cssVar = (token: string) => `var(--chakra-colors-${token.replace(/\./g, "-")})`;

export function HealthBoard({ site, range }: { site: SiteId; range: Range }) {
  const h = useHealth(site, range);
  const { snap, pts, first, last, L } = h;

  return (
    <Container maxW="7xl" py="6">
      <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" }} gap="4">
        {/* ───────── Tiles ───────── */}
        <Panel>
          <HStack gap="4" align="center">
            <ScoreDial score={snap.score} size={76} thickness={8} />
            <Stack gap="1" minW="0">
              <HStack gap="1.5"><Text textStyle="xs" color="fg.muted">Health score</Text><Help text={SCORE_HELP} /></HStack>
              <Text textStyle="sm" fontWeight="medium">{snap.score >= 80 ? "Good" : snap.score >= 60 ? "Needs work" : "Poor"}</Text>
              <Delta now={last.score} then={first.score} goodWhen="up" label={h.since} />
            </Stack>
          </HStack>
        </Panel>
        <Tile label="Critical (P1) issues" value={fmtInt(snap.priority.P1.issues)} to={L.issues({ pri: "P1" })} values={pts.map((p) => p.P1)} color="red.solid"
          delta={<Delta now={last.P1} then={first.P1} goodWhen="down" label={h.since} />} />
        <Tile label="Pages with a P1 issue" value={`${h.p1Share}%`} to={L.pages({}, "worst", { pri: "P1" })} sub={`${fmtInt(snap.p1Pages)} of ${fmtInt(snap.pages)} pages`}
          values={pts.map((p) => p.P1)} color="red.solid" />
        <Tile label="Fixable in templates" value={`${pct(snap.shared.issues, snap.issues)}%`} to={L.issues({ markup: "shared" })}
          help="Issues in markup shared across pages. One fix in the template covers every page."
          sub={`Fixing them: score ${snap.score} → ${snap.scoreNoShared}`} />

        {/* ───────── Priority × category ───────── */}
        <GridItem colSpan={{ base: 1, md: 2 }}>
          <Panel h="full" title="Issues by priority and category" description="Click a cell to see those issues" action={<MoreLink to={L.issues()}>All issues</MoreLink>}>
            <Heatmap h={h} />
            <Box mt="5"><SegBar parts={h.parts.priority} h="2.5" /></Box>
            <HStack gap="4" mt="2" wrap="wrap">
              {PRIORITIES.map((p) => (
                <HStack key={p} gap="1.5" textStyle="xs"><Box boxSize="2" rounded="sm" bg={PRI_COLOR[p]} /><Text>{p} {PRI_LABEL[p]}</Text><Text color="fg.muted">{pct(snap.priority[p].issues, snap.issues)}%</Text></HStack>
              ))}
            </HStack>
          </Panel>
        </GridItem>
        <Panel title="Issues by category"><Donut parts={h.parts.category} legend="below" size={128} center={fmtInt(snap.issues)} centerLabel="issues" /></Panel>
        <Panel title="Pages by health"><Donut parts={h.parts.bands} legend="below" size={128} center={fmtInt(snap.pages)} centerLabel="pages" /></Panel>

        {/* ───────── Sections ───────── */}
        <GridItem colSpan={{ base: 1, md: 2, xl: 3 }}>
          <SectionMap site={site} />
        </GridItem>
        <Panel title="Score by category" description={`Over ${h.days} days`}>
          <Stack gap="4">
            {CATEGORIES.map((c) => {
              const cs = snap.category[c.id];
              return (
                <Box asChild key={c.id} display="block" _hover={{ "& .n": { textDecoration: "underline" } }}>
                  <RouterLink to={L.issues({ cat: c.id })}>
                    <HStack justify="space-between" gap="2">
                      <HStack gap="2" minW="0"><Box boxSize="2" rounded="sm" bg={CAT_COLOR[c.id]} /><Text className="n" textStyle="sm" truncate>{c.label}</Text></HStack>
                      <ScoreChip score={cs.score} />
                    </HStack>
                    <HStack gap="3" mt="1">
                      <Box flex="1"><Sparkline values={pts.map((p) => p.cat[c.id])} color={CAT_COLOR[c.id]} h="7" pad={4} /></Box>
                      <Delta now={last.cat[c.id]} then={first.cat[c.id]} goodWhen="up" />
                    </HStack>
                  </RouterLink>
                </Box>
              );
            })}
          </Stack>
        </Panel>

        {/* ───────── Trend and top rules ───────── */}
        <GridItem colSpan={{ base: 1, md: 2 }}>
          <Panel action={<TrendRange />} h="full" title="Open issues by priority" description={p1Outlook(h)}>
            <MultiTrend points={pts} series={seriesOfPriority} stacked h="56" />
          </Panel>
        </GridItem>
        <GridItem colSpan={{ base: 1, md: 2 }}>
          <Panel h="full" title="Rules failing on the most pages" description="P1 and P2 first" action={<MoreLink to={L.issues()}>All rules</MoreLink>}>
            <Stack gap="0">
              {snap.rules.filter((r) => r.priority === "P1" || r.priority === "P2").sort((x, y) => x.priority.localeCompare(y.priority) || y.pages - x.pages).slice(0, 7).map((r) => (
                <HStack asChild key={r.rule.id} gap="3" py="2" borderTopWidth="1px" borderColor="border.muted" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }} px="1" mx="-1">
                  <RouterLink to={L.rule(r.rule.id)}>
                    <Text textStyle="xs" fontWeight="semibold" color={PRIORITY_COLOR[r.priority]} w="5">{r.priority}</Text>
                    <Text textStyle="sm" flex="1" truncate title={r.rule.title}>{r.rule.title}</Text>
                    <Box w="20" display={{ base: "none", sm: "block" }}>
                      <Box h="1.5" rounded="full" bg={PRI_COLOR[r.priority]} w={`${Math.max(4, pct(r.pages, snap.pages))}%`} />
                    </Box>
                    <Text textStyle="xs" color="fg.muted" w="24" textAlign="right" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">{pct(r.pages, snap.pages)}% of pages</Text>
                  </RouterLink>
                </HStack>
              ))}
            </Stack>
          </Panel>
        </GridItem>
      </Grid>
    </Container>
  );
}

function Tile({ label, value, sub, delta, values, color, to, help }: {
  label: string; value: React.ReactNode; sub?: string; delta?: React.ReactNode; values?: number[]; color?: string; to: string; help?: string;
}) {
  return (
    <Panel>
      <Box asChild display="block" _hover={{ "& .v": { textDecoration: "underline" } }}>
        <RouterLink to={to}>
          <HStack gap="1.5"><Text textStyle="xs" color="fg.muted">{label}</Text>{help && <Help text={help} />}</HStack>
          <Text className="v" textStyle="2xl" fontWeight="semibold" mt="1.5" lineHeight="1" fontVariantNumeric="tabular-nums">{value}</Text>
          <Box mt="1.5" minH="4">{delta ?? <Text textStyle="xs" color="fg.muted">{sub}</Text>}</Box>
          {values && <Box mt="2"><Sparkline values={values} color={color} h="7" /></Box>}
        </RouterLink>
      </Box>
    </Panel>
  );
}

// Priority rows × category columns; cell shade is the count, on one hue
export function Heatmap({ h }: { h: ReturnType<typeof useHealth> }) {
  const { snap, L } = h;
  const cell = (p: string, c: string) => snap.rules.filter((r) => r.priority === p && r.rule.category === c).reduce((t, r) => t + r.pages, 0);
  const max = Math.max(1, ...PRIORITIES.flatMap((p) => CATEGORIES.map((c) => cell(p, c.id))));
  return (
    <Box minW="0">
      <Grid templateColumns={{ base: "32px repeat(4, minmax(0, 1fr))", sm: "88px repeat(4, minmax(0, 1fr))" }} gap="2px" textStyle="xs">
        <Box />
        {CATEGORIES.map((c) => <Text key={c.id} color="fg.muted" px="2" pb="1" truncate>{c.label}</Text>)}
        {PRIORITIES.map((p) => (
          <Box key={p} display="contents">
            <HStack gap="1.5" px="1"><Box boxSize="2" rounded="sm" bg={PRI_COLOR[p]} /><Text fontWeight="medium">{p}</Text><Text color="fg.muted" display={{ base: "none", sm: "inline" }}>{PRI_LABEL[p]}</Text></HStack>
            {CATEGORIES.map((c) => {
              const v = cell(p, c.id);
              const t = v ? 0.16 + 0.76 * Math.sqrt(v / max) : 0;
              return (
                <Box asChild key={c.id} h="11" rounded="l1" display="flex" alignItems="center" justifyContent="center" fontVariantNumeric="tabular-nums"
                  bg={v ? `color-mix(in srgb, ${cssVar("brand.solid")} ${Math.round(t * 100)}%, ${cssVar("bg.muted")})` : "bg.muted"}
                  color={t > 0.5 ? "white" : v ? "fg" : "fg.subtle"} fontWeight={v ? "medium" : "normal"} _hover={{ outline: "2px solid", outlineColor: "fg", outlineOffset: "-2px" }}>
                  {v ? <RouterLink to={L.issues({ pri: p as never, cat: c.id })} aria-label={`${p} ${c.label}: ${v} issues`}>{fmtInt(v)}</RouterLink> : <span>–</span>}
                </Box>
              );
            })}
          </Box>
        ))}
      </Grid>
    </Box>
  );
}

// Sections as a treemap: area is pages, colour is the section's health. Click a type to see its years or folders;
// click one of those to open its pages.
function SectionMap({ site }: { site: SiteId }) {
  const navigate = useNavigate();
  const [type, setType] = useState<PageType | null>(null);
  const snap = snapshot(site, type ? { type } : {});
  const L = links(site);
  const groups = snap.groups.length ? snap.groups : [];
  const data = groups.map((g) => ({ name: g.label, size: g.pages, g }));
  const open = (g: Group) => (type ? navigate(L.pages(g.filter, "worst")) : g.filter.type && snapshot(site, { type: g.filter.type }).groups.length ? setType(g.filter.type) : navigate(L.pages(g.filter, "worst")));
  return (
    <Panel h="full"
      title={<HStack gap="2">{type && <Button size="2xs" variant="ghost" ms="-2" onClick={() => setType(null)}><LuChevronLeft />All sections</Button>}<Text>{type ? typeName(type) : "Health by section"}</Text></HStack>}
      description={type ? `${fmtInt(snap.pages)} pages · score ${snap.score}. Click a part to open its pages.` : "Area is pages, colour is health. Click a section to drill in."}
      action={<MoreLink to={L.pages(type ? { type } : {}, "worst")}>Pages</MoreLink>}>
      {groups.length === 0 ? <Text textStyle="sm" color="fg.muted">This section has no parts.</Text> : (
        <Box h={{ base: "64", md: "72" }}>
          <ResponsiveContainer width="100%" height="100%">
            <Treemap data={data} dataKey="size" isAnimationActive={false} aspectRatio={1.6}
              content={(props: { x?: number; y?: number; width?: number; height?: number; depth?: number; g?: Group; name?: string }) => {
                const { x = 0, y = 0, width = 0, height = 0, g } = props;
                if (!g || props.depth !== 1) return <g />;
                const c = bandColor(g.score);
                const big = width > 90 && height > 44;
                return (
                  <g style={{ cursor: "pointer" }} onClick={() => open(g)}>
                    <title>{`${g.label}: ${g.pages} pages, score ${g.score}, ${g.p1Pages} with a P1 issue`}</title>
                    <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} rx={4}
                      fill={cssVar(`${c}.muted`)} stroke={cssVar("bg")} strokeWidth={2} />
                    {width > 46 && height > 22 && (
                      <text x={x + 8} y={y + 18} fontSize={12} fontWeight={600} stroke="none" fill={cssVar("fg")}>{fit(g.label, width - 16)}</text>
                    )}
                    {big && (
                      <text x={x + 8} y={y + 35} fontSize={11} stroke="none" fill={cssVar("fg.muted")}>{`${g.score} · ${fmtInt(g.pages)} pages`}</text>
                    )}
                  </g>
                );
              }} />
          </ResponsiveContainer>
        </Box>
      )}
      <HStack gap="4" mt="3" textStyle="xs" color="fg.muted" wrap="wrap">
        {[["green", "Good 80+"], ["orange", "Needs work 60–79"], ["red", "Poor under 60"]].map(([c, l]) => (
          <HStack key={c} gap="1.5"><Box boxSize="2.5" rounded="sm" bg={`${c}.muted`} /><Text>{l}</Text></HStack>
        ))}
      </HStack>
    </Panel>
  );
}
const fit = (s: string, px: number) => { const n = Math.floor(px / 7); return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s; };
