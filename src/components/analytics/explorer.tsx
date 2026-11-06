import { TrendRange } from "@/components/analytics/trend-range";
// Variation C · Explorer: pick a part of the site on the left (whole site → page type → year or folder) and every
// chart on the right follows it. Drilling happens in place; the links at the end of each block open Issues or Pages
// narrowed to the same part.
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Box, Breadcrumb, Button, Container, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { LuChevronRight } from "react-icons/lu";

import { BarRows, Delta, Donut, Help, MoreLink, Panel, ScoreChip, ScoreDial, ScoreTrend, Sparkline } from "@/components/analytics-ui";
import { p1Outlook, useHealth } from "@/components/analytics/use-health";
import { PRI_COLOR, PRI_LABEL, SCORE_HELP, fmtInt, pct, scopeName, snapshot, subName, typeName, type Filter, type Range } from "@/lib/analytics";
import { PRIORITIES } from "@/lib/priority";
import type { PageType } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

const parseScope = (v: string | null): Filter => {
  const [type, sub] = (v ?? "").split("/");
  return { type: (type || undefined) as PageType | undefined, sub: sub || undefined };
};

export function HealthExplorer({ site, range }: { site: SiteId; range: Range }) {
  const [scope, setScope] = useState<Filter>(() => parseScope(new URLSearchParams(window.location.search).get("scope")));
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (scope.type) p.set("scope", [scope.type, scope.sub].filter(Boolean).join("/")); else p.delete("scope");
    const q = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    return () => { // leaving the explorer drops its scope from the URL
      const p2 = new URLSearchParams(window.location.search); p2.delete("scope");
      const q2 = p2.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${q2 ? `?${q2}` : ""}`);
    };
  }, [scope]);

  return (
    <Container maxW="7xl" py="6">
      <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "260px minmax(0, 1fr)" }} gap="6" alignItems="start">
        <ScopeRail site={site} scope={scope} onScope={setScope} />
        <ScopeView key={`${scope.type}/${scope.sub}`} site={site} range={range} scope={scope} onScope={setScope} />
      </Grid>
    </Container>
  );
}

// ───────── The tree on the left ─────────
function ScopeRail({ site, scope, onScope }: { site: SiteId; scope: Filter; onScope: (f: Filter) => void }) {
  const root = snapshot(site);
  const subs = useMemo(() => (scope.type ? snapshot(site, { type: scope.type }).groups : []), [site, scope.type]);
  const Row = ({ f, label, score, pages, depth, on }: { f: Filter; label: string; score: number; pages: number; depth: number; on: boolean }) => (
    <Button variant="ghost" size="sm" justifyContent="start" w="full" h="auto" py="1.5" ps={`${2 + depth * 4}`} pe="2" gap="2"
      color="fg" bg={on ? "bg.muted" : undefined} fontWeight={on ? "semibold" : "normal"} onClick={() => onScope(f)} aria-current={on ? "true" : undefined}>
      <Text flex="1" textAlign="start" truncate textStyle="sm">{label}</Text>
      <Text textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums">{fmtInt(pages)}</Text>
      <ScoreChip score={score} />
    </Button>
  );
  return (
    <Box position={{ lg: "sticky" }} top={{ lg: "calc(var(--sticky-top, 0px) + 1.5rem)" }} borderWidth="1px" rounded="l3" p="2"
      maxH={{ base: "72", lg: "calc(100vh - var(--sticky-top, 0px) - 3rem)" }} overflowY="auto">
      <HStack justify="space-between" px="2" pt="1" pb="2" textStyle="xs" color="fg.muted"><Text>Section</Text><Text>Pages · score</Text></HStack>
      <Row f={{}} label="Whole site" score={root.score} pages={root.pages} depth={0} on={!scope.type} />
      {root.groups.map((g) => (
        <Box key={g.filter.type}>
          <Row f={{ type: g.filter.type }} label={g.label} score={g.score} pages={g.pages} depth={1} on={scope.type === g.filter.type && !scope.sub} />
          {scope.type === g.filter.type && subs.map((s) => (
            <Row key={s.filter.sub} f={s.filter} label={s.label} score={s.score} pages={s.pages} depth={2} on={scope.sub === s.filter.sub} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

// ───────── Everything about the chosen part ─────────
function ScopeView({ site, range, scope, onScope }: { site: SiteId; range: Range; scope: Filter; onScope: (f: Filter) => void }) {
  const h = useHealth(site, range, scope);
  const { snap, pts, first, last, L } = h;
  const type = scope.type;
  const crumbs: { label: string; f: Filter }[] = [
    { label: "Whole site", f: {} },
    ...(type ? [{ label: typeName(type), f: { type } }] : []),
    ...(type && scope.sub ? [{ label: subName(type, scope.sub), f: scope }] : []),
  ];

  return (
    <Stack gap="6" minW="0">
      {/* Scope header */}
      <Stack gap="4">
        <Breadcrumb.Root size="sm">
          <Breadcrumb.List>
            {crumbs.map((c, k) => (
              <Box key={k} display="contents">
                {k > 0 && <Breadcrumb.Separator><LuChevronRight /></Breadcrumb.Separator>}
                <Breadcrumb.Item>
                  {k === crumbs.length - 1 ? <Breadcrumb.CurrentLink>{c.label}</Breadcrumb.CurrentLink>
                    : <Breadcrumb.Link asChild><button type="button" onClick={() => onScope(c.f)}>{c.label}</button></Breadcrumb.Link>}
                </Breadcrumb.Item>
              </Box>
            ))}
          </Breadcrumb.List>
        </Breadcrumb.Root>
        <Flex gap="6" align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }}>
          <ScoreDial score={snap.score} size={112} />
          <Stack gap="2" flex="1" minW="0">
            <HStack gap="2"><Text textStyle="xl" fontWeight="semibold">{scopeName(scope)}</Text><Help text={SCORE_HELP} /></HStack>
            <Text textStyle="sm" color="fg.muted" maxW="2xl">
              {fmtInt(snap.pages)} pages{type ? ` (${pct(snap.pages, snapshot(site).pages)}% of the site)` : ""}. {fmtInt(snap.p1Pages)} ({h.p1Share}%) have a critical issue.{" "}
              Fixing shared markup would take this part from {snap.score} to {snap.scoreNoShared}. {p1Outlook(h)}
            </Text>
            <HStack gap="4" wrap="wrap">
              <Delta now={last.score} then={first.score} goodWhen="up" suffix=" pts" label={h.since} />
              <MoreLink to={L.pages(scope, "worst")}>Open these pages</MoreLink>
              <MoreLink to={L.issues({ type })}>Open these issues</MoreLink>
            </HStack>
          </Stack>
        </Flex>
      </Stack>

      {/* Priority */}
      <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap="3">
        {PRIORITIES.map((p) => {
          const s = snap.priority[p];
          return (
            <Box key={p} borderWidth="1px" rounded="l3" p="4" borderTopWidth="3px" borderTopColor={PRI_COLOR[p]} minW="0">
              <Box asChild display="block" _hover={{ "& .v": { textDecoration: "underline" } }}>
                <RouterLink to={L.issues({ pri: p, type })}>
                  <HStack gap="1.5" textStyle="xs"><Text fontWeight="semibold">{p}</Text><Text color="fg.muted">{PRI_LABEL[p]}</Text></HStack>
                  <Text className="v" textStyle="2xl" fontWeight="semibold" mt="1" lineHeight="1.1" fontVariantNumeric="tabular-nums">{fmtInt(s.issues)}</Text>
                  <Text textStyle="xs" color="fg.muted">on {pct(s.pages, snap.pages)}% of pages</Text>
                </RouterLink>
              </Box>
              <Box mt="2"><Sparkline values={pts.map((x) => x[p])} color={PRI_COLOR[p]} h="7" /></Box>
              <Delta now={last[p]} then={first[p]} goodWhen="down" />
              <Stack gap="0" mt="2" pt="2" borderTopWidth="1px" borderColor="border.muted">
                {s.rules.slice(0, 2).map((r) => (
                  <Text asChild key={r.rule.id} textStyle="xs" truncate color="fg.muted" _hover={{ color: "fg", textDecoration: "underline" }} title={r.rule.title}>
                    <RouterLink to={L.rule(r.rule.id)}>{r.rule.title}</RouterLink>
                  </Text>
                ))}
                {!s.rules.length && <Text textStyle="xs" color="fg.subtle">None</Text>}
              </Stack>
            </Box>
          );
        })}
      </Grid>

      {/* Trend + overview */}
      <Panel action={<TrendRange />} title="Health score over time" description={`Last ${h.days} days`}><ScoreTrend points={pts} h="48" /></Panel>
      <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" }} gap="4">
        <Panel title="Issues by category"><Donut parts={h.parts.category} legend="below" size={120} center={fmtInt(snap.issues)} centerLabel="issues" /></Panel>
        <Panel title="Pages by health"><Donut parts={h.parts.bands} legend="below" size={120} center={fmtInt(snap.pages)} centerLabel="pages" /></Panel>
        <Panel title="Where issues live"><Donut parts={h.parts.markup} legend="below" size={120} center={`${pct(snap.shared.issues, snap.issues)}%`} centerLabel="shared" /></Panel>
      </Grid>

      {/* Parts + pages */}
      <Grid templateColumns={{ base: "1fr", xl: snap.groups.length ? "repeat(2, minmax(0, 1fr))" : "1fr" }} gap="4">
        {snap.groups.length > 0 && (
          <Panel title={type ? `Inside ${typeName(type)}` : "Sections"} description="Bar is pages; click to drill in">
            <BarRows rows={snap.groups.slice(0, 12).map((g) => ({
              label: <Box asChild w="full" textAlign="start" cursor="pointer"><button type="button" onClick={() => onScope(g.filter)}>{g.label}</button></Box>,
              value: g.pages, display: <ScoreChip score={g.score} />,
              right: <Text textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums">{fmtInt(g.pages)}</Text>,
            }))} />
          </Panel>
        )}
        <Panel title="Lowest-scoring pages" action={<MoreLink to={L.pages(scope, "worst")}>All</MoreLink>}>
          <Stack gap="0">
            {snap.worst.slice(0, 8).map((w) => (
              <HStack asChild key={w.page.i} gap="3" py="2" borderTopWidth="1px" borderColor="border.muted" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }} px="1" mx="-1">
                <RouterLink to={L.page(w.page.i)}>
                  <ScoreChip score={w.score} />
                  <Stack gap="0" flex="1" minW="0">
                    <Text textStyle="sm" truncate>{w.page.title}</Text>
                    <Text textStyle="xs" color="fg.muted" truncate>{w.page.path}</Text>
                  </Stack>
                  {w.p1 > 0 && <Text textStyle="xs" color="red.fg" flexShrink={0}>{w.p1} P1</Text>}
                </RouterLink>
              </HStack>
            ))}
          </Stack>
        </Panel>
      </Grid>
    </Stack>
  );
}
