import { TrendRange } from "@/components/analytics/trend-range";
// Variation A · Report: one column, read top to bottom like a weekly health report.
// At a glance → executive overview (donuts) → issues by priority → where it's going → biggest wins → sections → pages.
import { Link as RouterLink } from "react-router";
import { Badge, Box, Container, Flex, Grid, HStack, Separator, Stack, Text } from "@chakra-ui/react";

import {
  BarRows, Delta, Donut, Help, MoreLink, Panel, ScoreChip, ScoreDial, ScoreTrend, SectionHeading, Sparkline, Stat, MultiTrend,
} from "@/components/analytics-ui";
import { p1Outlook, seriesOfCategory, seriesOfPriority, useHealth } from "@/components/analytics/use-health";
import { BANDS, PRI_COLOR, PRI_LABEL, SCORE_HELP, bandOf, fmtInt, pct, type Range } from "@/lib/analytics";
import { PRIORITIES, PRIORITY_COLOR } from "@/lib/priority";
import type { SiteId } from "@/lib/sites";

export function HealthReport({ site, range }: { site: SiteId; range: Range }) {
  const h = useHealth(site, range);
  const { snap, pts, first, last, L } = h;
  const band = BANDS.find((b) => b.id === bandOf(snap.score))!;
  const scoreDiff = last.score - first.score;

  return (
    <Container maxW="5xl" py={{ base: "6", md: "10" }}>
      <Stack gap={{ base: "10", md: "14" }}>
        {/* ───────── At a glance ───────── */}
        <Box as="section">
          <Flex gap={{ base: "5", md: "8" }} align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }}>
            <ScoreDial score={snap.score} size={148} />
            <Stack gap="3" flex="1">
              <HStack gap="2"><Text textStyle="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Site health</Text><Help text={SCORE_HELP} /></HStack>
              <Text textStyle={{ base: "lg", md: "xl" }} fontWeight="medium" lineHeight="1.4" maxW="2xl">
                The site {band.id === "good" ? "is in good health" : band.id === "fair" ? "needs work" : "is in poor health"}, {scoreDiff === 0 ? "unchanged" : `${scoreDiff > 0 ? "up" : "down"} ${Math.abs(scoreDiff)} point${Math.abs(scoreDiff) === 1 ? "" : "s"}`} in {h.days} days.{" "}
                <Text as="span" color="fg.muted">
                  {fmtInt(snap.p1Pages)} pages ({h.p1Share}%) have a critical issue. Fixing shared markup in the templates would lift the score to {snap.scoreNoShared}.
                </Text>
              </Text>
              <Text textStyle="sm" color="fg.muted">{p1Outlook(h)}</Text>
            </Stack>
          </Flex>
          <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap="0" mt="8" borderWidth="1px" rounded="l3" overflow="hidden">
            {[
              { label: "Health score", value: snap.score, help: SCORE_HELP, d: <Delta now={last.score} then={first.score} goodWhen="up" label={h.since} />, s: pts.map((p) => p.score), c: "brand.solid" },
              { label: "Critical (P1) issues", value: fmtInt(snap.priority.P1.issues), to: L.issues({ pri: "P1" }), d: <Delta now={last.P1} then={first.P1} goodWhen="down" label={h.since} />, s: pts.map((p) => p.P1), c: "red.solid" },
              { label: "Serious (P2) issues", value: fmtInt(snap.priority.P2.issues), to: L.issues({ pri: "P2" }), d: <Delta now={last.P2} then={first.P2} goodWhen="down" label={h.since} />, s: pts.map((p) => p.P2), c: "orange.solid" },
              { label: "Fixable in templates", value: `${pct(snap.shared.issues, snap.issues)}%`, to: L.issues({ markup: "shared" }), help: "Share of issues in markup shared across pages (header, footer, banners). One fix in the template covers every page.", d: <Text textStyle="xs" color="fg.muted">{fmtInt(snap.shared.issues)} of {fmtInt(snap.issues)} issues</Text> },
            ].map((t, k) => (
              <Box key={t.label} p="4" borderColor="border" borderStartWidth={{ base: k % 2 ? "1px" : 0, md: k ? "1px" : 0 }} borderTopWidth={{ base: k > 1 ? "1px" : 0, md: 0 }}>
                <Stat label={t.label} value={t.value} help={t.help} to={t.to}>{t.d}</Stat>
                {t.s && <Box mt="2"><Sparkline values={t.s} color={t.c} /></Box>}
              </Box>
            ))}
          </Grid>
        </Box>

        {/* ───────── Executive overview ───────── */}
        <Box as="section">
          <SectionHeading title="Executive overview" description="What kind of issues the site has, how bad they are, and where they live. Click a slice's row to see those issues." />
          <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }} gap="4">
            <Panel title="Issues by priority" description="P1 critical blocks some users entirely"><Donut parts={h.parts.priority} center={fmtInt(snap.issues)} centerLabel="issues" /></Panel>
            <Panel title="Issues by category"><Donut parts={h.parts.category} center={`${pct(snap.category.accessibility.issues, snap.issues)}%`} centerLabel="accessibility" /></Panel>
            <Panel title="Pages by health" description="Each page's own score"><Donut parts={h.parts.bands} center={fmtInt(snap.pages)} centerLabel="pages" /></Panel>
            <Panel title="Where issues live" description="Shared markup is fixed once, in the template"><Donut parts={h.parts.markup} center={`${pct(snap.shared.issues, snap.issues)}%`} centerLabel="shared" /></Panel>
          </Grid>
        </Box>

        {/* ───────── Issues by priority ───────── */}
        <Box as="section">
          <SectionHeading title="Issues by priority" description="An issue is one rule failing on one page. The trend is the last point of each line against the first in the range."
            action={<MoreLink to={L.issues()}>All issues</MoreLink>} />
          <Stack gap="0" borderWidth="1px" rounded="l3" overflow="hidden">
            {PRIORITIES.map((p) => {
              const s = snap.priority[p];
              return (
                <Grid key={p} templateColumns={{ base: "1fr", md: "220px 1fr 1.4fr" }} gap={{ base: "3", md: "6" }} p="4" borderTopWidth="1px" _first={{ borderTopWidth: 0 }} alignItems="center">
                  <HStack gap="3" align="start">
                    <Box w="1" alignSelf="stretch" rounded="full" bg={PRI_COLOR[p]} />
                    <Stack gap="1">
                      <HStack gap="2"><Text fontWeight="semibold">{p}</Text><Text color="fg.muted" textStyle="sm">{PRI_LABEL[p]}</Text></HStack>
                      <Text asChild textStyle="2xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums"><RouterLink to={L.issues({ pri: p })}>{fmtInt(s.issues)}</RouterLink></Text>
                      <Text textStyle="xs" color="fg.muted">on {fmtInt(s.pages)} pages · {s.rules.length} rules</Text>
                    </Stack>
                  </HStack>
                  <Stack gap="1">
                    <Delta now={last[p]} then={first[p]} goodWhen="down" label={h.since} />
                    <Sparkline values={pts.map((x) => x[p])} color={PRI_COLOR[p]} h="10" />
                  </Stack>
                  <Stack gap="0.5">
                    {s.rules.slice(0, 3).map((r) => (
                      <HStack asChild key={r.rule.id} gap="3" textStyle="sm" py="0.5" _hover={{ "& .t": { textDecoration: "underline" } }}>
                        <RouterLink to={L.rule(r.rule.id)}>
                          <Text className="t" flex="1" truncate title={r.rule.title}>{r.rule.title}</Text>
                          <Text color="fg.muted" textStyle="xs" fontVariantNumeric="tabular-nums" flexShrink={0}>{fmtInt(r.pages)} pages</Text>
                        </RouterLink>
                      </HStack>
                    ))}
                    {s.rules.length === 0 && <Text textStyle="sm" color="fg.muted">None. Nice.</Text>}
                  </Stack>
                </Grid>
              );
            })}
          </Stack>
        </Box>

        {/* ───────── Where it's going ───────── */}
        <Box as="section">
          <SectionHeading action={<TrendRange />} title="Where it's going" description={`The last ${h.days} days. ${p1Outlook(h)}`} />
          <Stack gap="4">
            <Panel title="Health score" description="Shaded by band: good 80+, needs work 60–79, poor under 60"><ScoreTrend points={pts} /></Panel>
            <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }} gap="4">
              <Panel title="Open issues by priority"><MultiTrend points={pts} series={seriesOfPriority} stacked h="48" /></Panel>
              <Panel title="Score by category" description="Performance is scored on the pages Lighthouse audited"><MultiTrend points={pts} series={seriesOfCategory} h="48" /></Panel>
            </Grid>
          </Stack>
        </Box>

        {/* ───────── Biggest wins ───────── */}
        <Box as="section">
          <SectionHeading title="Biggest wins" description={`Shared markup fixed once in the template. Together they'd take the score from ${snap.score} to ${snap.scoreNoShared}.`}
            action={<MoreLink to={L.issues({ markup: "shared" })}>All shared-markup issues</MoreLink>} />
          <Stack gap="0" borderWidth="1px" rounded="l3" overflow="hidden">
            {snap.fixes.filter((f) => f.gain >= 0.1).slice(0, 5).map((f) => (
              <HStack asChild key={f.rule.id + f.pattern} gap="4" px="4" py="3" borderTopWidth="1px" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }}>
                <RouterLink to={`${L.rule(f.rule.id, f.pattern)}`}>
                  <Badge variant="subtle" colorPalette="green" fontVariantNumeric="tabular-nums" flexShrink={0} w="16" justifyContent="center">+{f.gain.toFixed(1)} pts</Badge>
                  <Stack gap="0" flex="1" minW="0">
                    <Text textStyle="sm" truncate>{f.rule.title}</Text>
                    <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate>{f.pattern}</Text>
                  </Stack>
                  <Text textStyle="xs" color={PRIORITY_COLOR[f.priority]} fontWeight="medium">{f.priority}</Text>
                  <Text textStyle="sm" color="fg.muted" fontVariantNumeric="tabular-nums" w="24" textAlign="right" display={{ base: "none", sm: "block" }}>{fmtInt(f.pages)} pages</Text>
                </RouterLink>
              </HStack>
            ))}
          </Stack>
        </Box>

        {/* ───────── Sections ───────── */}
        <Box as="section">
          <SectionHeading title="Health by section" description="Sections are page types, from the URL. Open one to see its pages, worst first." action={<MoreLink to={L.pages({}, "worst")}>All pages</MoreLink>} />
          <BarRows rows={snap.groups.map((g) => ({
            label: <HStack gap="2"><Text truncate>{g.label}</Text><Text color="fg.muted" textStyle="xs">{fmtInt(g.pages)} pages</Text></HStack>,
            value: g.pages, display: <ScoreChip score={g.score} />, to: L.pages(g.filter, "worst"),
            right: <Text textStyle="xs" color={g.p1Pages ? "red.fg" : "fg.muted"} display={{ base: "none", sm: "block" }} w="32" textAlign="right">{g.p1Pages ? `${fmtInt(g.p1Pages)} with P1 (${pct(g.p1Pages, g.pages)}%)` : "No P1"}</Text>,
          }))} />
        </Box>

        {/* ───────── Pages ───────── */}
        <Box as="section">
          <SectionHeading title="Pages that need the most attention" description="The lowest scores on the site." action={<MoreLink to={L.pages({}, "worst")}>See all, worst first</MoreLink>} />
          <Stack gap="0" borderWidth="1px" rounded="l3" overflow="hidden">
            {snap.worst.slice(0, 8).map((w) => (
              <HStack asChild key={w.page.i} gap="4" px="4" py="2.5" borderTopWidth="1px" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }}>
                <RouterLink to={L.page(w.page.i)}>
                  <ScoreChip score={w.score} />
                  <Stack gap="0" flex="1" minW="0">
                    <Text textStyle="sm" truncate>{w.page.title}</Text>
                    <Text textStyle="xs" color="fg.muted" truncate>{w.page.path}</Text>
                  </Stack>
                  <Text textStyle="xs" color="red.fg" flexShrink={0}>{w.p1} P1</Text>
                  <Text textStyle="xs" color="fg.muted" flexShrink={0} display={{ base: "none", sm: "block" }}>{w.issues} issues</Text>
                </RouterLink>
              </HStack>
            ))}
          </Stack>
          {snap.broken.notFound + snap.broken.serverError > 0 && (
            <>
              <Separator my="4" />
              <Text textStyle="sm" color="fg.muted">Also: {fmtInt(snap.broken.notFound)} pages return 404 and {fmtInt(snap.broken.serverError)} return a server error.</Text>
            </>
          )}
        </Box>
      </Stack>
    </Container>
  );
}
