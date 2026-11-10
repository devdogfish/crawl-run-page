// Variation S · Summary: assembled from the parts picked across the other layouts.
// What changed since the last crawl (strip) → executive donuts → priority × category heatmap → biggest wins → worst pages.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LuArrowRight, LuCircleAlert, LuCircleCheck, LuPencil, LuPlus } from "react-icons/lu";
import { Link as RouterLink } from "react-router";
import { Badge, Box, Button, Container, Flex, Grid, HStack, Icon, Select, Portal, Stack, Text } from "@chakra-ui/react";

import { useItems } from "@/components/filter-select";
import { ScopeSelect } from "@/components/scope-select";
import { Help, MoreLink, Donut, type Part, Panel, SectionHeading, SegBar } from "@/components/analytics-ui";
import { Heatmap } from "@/components/analytics/board";
import { useHealth } from "@/components/analytics/use-health";
import { PRI_COLOR, PRI_LABEL, diff, fmtInt, attention, pageChanges, pct, snapshot, vitals, VITALS, type VitalStat, type Filter, type Range } from "@/lib/analytics";
import { PRIORITIES, PRIORITY_COLOR, type Priority } from "@/lib/priority";
import { PAGE_TYPES, baselinesFor, defaultCrawl, type PageType } from "@/lib/site-pages";
import type { SiteId } from "@/lib/sites";

const DAY = 86_400_000;
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
type Where = "all" | "shared" | "page";

function templateComponent(pattern: string) {
  if (pattern.includes(".cookie-banner")) return "Cookie banner";
  if (/^header(?:\s|[.#>:]|$)/.test(pattern)) return "Header";
  if (/^footer(?:\s|[.#>:]|$)/.test(pattern)) return "Footer";
  if (/^head\s+script(?:\s|[.#>:]|$)/.test(pattern)) return "Scripts";
  return "Shared markup";
}

export function HealthSummary({ site, range, header }: { site: SiteId; range: Range; header: (filters: ReactNode) => ReactNode }) {
  // Filters live in the URL, so a view can be shared and the tiles can link into Issues and Pages with the same scope
  const sp = new URLSearchParams(window.location.search);
  const [vs, setVs] = useState(sp.get("vs") ?? "prev");
  const [type, setType] = useState(sp.get("type") ?? "all");
  const [year, setYear] = useState(sp.get("year") ?? "all");
  const [where, setWhere] = useState<Where>((sp.get("markup") as Where) ?? "all");
  const [pris, setPris] = useState<Priority[]>((sp.get("pri")?.split(",").filter((x): x is Priority => (PRIORITIES as string[]).includes(x))) ?? []);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const put = (k: string, v: string, def: string) => (v === def ? p.delete(k) : p.set(k, v));
    put("vs", vs, "prev"); put("type", type, "all"); put("year", type === "all" ? "all" : year, "all"); put("markup", where, "all"); put("pri", pris.join(","), "");
    const q = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  }, [vs, type, year, where, pris]);

  // Baselines: every earlier finished crawl; the previous one first, with the ones nearest a week and a month back named
  const latest = defaultCrawl(site);
  const baselines = useMemo(() => {
    const list = baselinesFor(site, latest.id);
    const near = (days: number) => list.reduce<(typeof list)[number] | null>((best, c) => {
      const d = Math.abs((latest.startedAt.getTime() - c.startedAt.getTime()) / DAY - days);
      return !best || d < Math.abs((latest.startedAt.getTime() - best.startedAt.getTime()) / DAY - days) ? c : best;
    }, null);
    const week = near(7)?.id, month = near(30)?.id;
    return list.map((c, i) => ({ value: i === 0 ? "prev" : c.id, id: c.id, label: `${fmtDay(c.startedAt)}${i === 0 ? " · previous crawl" : c.id === week ? " · a week ago" : c.id === month ? " · a month ago" : ""}`, date: c.startedAt }));
  }, [site, latest.id, latest.startedAt]);
  const base = baselines.find((b) => b.value === vs) ?? baselines[0];
  const vsNum = base ? Number(base.id) : null;

  const typeItems = useMemo(() => [{ value: "all", label: "All page types" }, ...PAGE_TYPES.map((t) => ({ value: t.id, label: t.label }))], []);
  // The year filter exists only for page types that have year folders
  const years = useMemo(() => type === "all" ? [] : snapshot(site, { type: type as PageType }).groups.map((g) => g.filter.sub).filter((x): x is string => !!x && /^\d{4}$/.test(x)), [site, type]);
  const yearValue = years.includes(year) ? year : "all";
  const scope: Filter = useMemo(() => type === "all" ? {} : { type: type as PageType, sub: yearValue === "all" ? undefined : yearValue }, [type, yearValue]);
  const markup = where === "all" ? undefined : where;

  const h = useHealth(site, range, scope, { pri: pris, markup });
  const { snap, L } = h;
  const d = useMemo(() => diff(site, scope, { vs: vsNum, pri: pris, markup }), [site, scope, vsNum, pris, markup]);
  const pc = useMemo(() => pageChanges(site, scope, vsNum), [site, scope, vsNum]);

  const date = base ? fmtDay(base.date) : null;
  const since = date ? `since ${date}` : "no earlier crawl";
  const net = d.added - d.fixed;
  const share = (n: number) => (snap.issues ? `${((n / snap.issues) * 100).toFixed(1)}% of current issues` : "");
  const vsParam = vs === "prev" || !base ? undefined : base.id;
  // Most serious first, then the most pages.
  const fixes = [...snap.fixes]
    .sort((x, y) => x.priority.localeCompare(y.priority) || y.pages - x.pages).slice(0, 5);
  const worstPages = useMemo(() => attention(site, scope, { pri: pris, markup }), [site, scope, pris, markup]);
  // Where the pages with a critical (P1) issue are: by page type, or by year or folder once a type is picked
  const SECTION_COLORS = ["cyan.500", "blue.500", "purple.500", "teal.500", "pink.500", "green.500", "gray.400"];
  const p1Groups = snap.groups.filter((g) => g.p1Pages > 0).sort((x, y) => y.p1Pages - x.p1Pages);
  const p1Parts: Part[] = p1Groups.slice(0, 6).map((g, i) => ({ name: g.label, value: g.p1Pages, color: SECTION_COLORS[i], to: L.pages(g.filter, "worst") }));
  const p1Rest = p1Groups.slice(6).reduce((t, g) => t + g.p1Pages, 0);
  if (p1Rest > 0) p1Parts.push({ name: "Other", value: p1Rest, color: SECTION_COLORS[6], to: L.pages(scope, "worst") });
  const vt = useMemo(() => vitals(site, scope), [site, scope]);
  const passed = vt.stats.every((x) => x.rating === "good");
  const priorityItems = useItems([
    { value: "all", label: "All priorities" },
    ...PRIORITIES.map((p) => ({ value: p, label: `${p} · ${PRI_LABEL[p]}` })),
  ]);
  const filtered = type !== "all" || pris.length > 0 || where !== "all";
  const reset = () => { setType("all"); setYear("all"); setWhere("all"); setPris([]); setVs("prev"); };

  return (
    <>
      {header(
          <HStack gap="2" wrap="wrap" align="center">
            <HStack gap="2"><Text textStyle="sm" color="fg.muted">Compare</Text>
              <ScopeSelect label="Comparison crawl" value={base?.value ?? "prev"} onChange={setVs} items={baselines.length ? baselines.map((b) => ({ value: b.value, label: b.label })) : [{ value: "prev", label: "No earlier crawl" }]} /></HStack>
            <Select.Root collection={priorityItems} multiple closeOnSelect={false} size="sm" w="32" aria-label="Filter by priority"
              value={pris.length ? pris : ["all"]}
              onValueChange={({ value }) => {
                if (pris.length && value.includes("all")) setPris([]);
                else setPris(value.filter((v): v is Priority => PRIORITIES.includes(v as Priority)));
              }} positioning={{ sameWidth: false }}>
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger bg="bg">
                  <Select.ValueText>{pris.length ? `Priority (${pris.length})` : "Priority"}</Select.ValueText>
                </Select.Trigger>
                <Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content minW="48">
                    {priorityItems.items.map((item) => (
                      <Select.Item key={item.value} item={item}>
                        {item.value !== "all" && <Box boxSize="2" rounded="full" bg={PRI_COLOR[item.value as Priority]} />}
                        <Text flex="1">{item.label}</Text>
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
            <ScopeSelect label="Markup" value={where} onChange={(v) => setWhere(v as Where)} items={[{ value: "all", label: "Template and page" }, { value: "shared", label: "Shared template" }, { value: "page", label: "Page-specific" }]} />
            <ScopeSelect label="Page type" value={type} onChange={(v) => { setType(v); setYear("all"); }} items={typeItems} />
            {years.length > 0 && <ScopeSelect label="Year" value={yearValue} onChange={setYear} items={[{ value: "all", label: "All years" }, ...years.map((y) => ({ value: y, label: y }))]} />}
            {filtered && <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>}
          </HStack>
      )}
    <Container maxW="5xl" py={{ base: "6", md: "10" }}>
      <Stack gap={{ base: "10", md: "14" }}>

        {/* ───────── Since the last crawl ───────── */}
        <Box as="section">
          <Text textStyle="sm" mb="3">
            <Text as="span" fontWeight="medium" color={net <= 0 ? "green.fg" : "red.fg"}>
              {net === 0 ? "No net change in issues" : `Net ${net < 0 ? "−" : "+"}${fmtInt(Math.abs(net))} issues`}
            </Text>{" "}
            <Text as="span" color="fg.muted">{since}</Text>
          </Text>
          <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} borderWidth="1px" rounded="l3" overflow="hidden">
            {[
              { label: "New issues", icon: LuCircleAlert, value: `+${fmtInt(d.added)}`, color: "red.fg", sub: share(d.added), to: L.issues({ vs: vsParam, seg: "new" }) },
              { label: "Fixed issues", icon: LuCircleCheck, value: `−${fmtInt(d.fixed)}`, color: "green.fg", sub: share(d.fixed), to: L.issues({ vs: vsParam, seg: "fixed" }) },
              { label: "Pages added", icon: LuPlus, value: fmtInt(pc.added), color: undefined, sub: `first seen ${since}`, to: L.pages(scope, undefined, { vs: vsParam, change: "new" }) },
              { label: "Pages changed", icon: LuPencil, value: fmtInt(pc.changed), color: undefined, sub: `edited ${since}`, to: L.pages(scope, undefined, { vs: vsParam, change: "changed" }) },
            ].map((t, k) => (
              <Box asChild key={t.label} display="block" p="4" borderColor="border" bg="bg" cursor="pointer" transition="background .15s" _hover={{ bg: "bg.subtle", "& .go": { opacity: 1 } }}
                borderStartWidth={{ base: k % 2 ? "1px" : 0, md: k ? "1px" : 0 }} borderTopWidth={{ base: k > 1 ? "1px" : 0, md: 0 }}>
                <RouterLink to={t.to}>
                  <HStack justify="space-between" color="fg.muted">
                    <HStack gap="1.5"><Icon as={t.icon} boxSize="3.5" /><Text textStyle="xs">{t.label}</Text></HStack>
                    <Icon className="go" as={LuArrowRight} boxSize="3.5" opacity={0} transition="opacity .15s" />
                  </HStack>
                  <Text textStyle="2xl" fontWeight="semibold" lineHeight="1" mt="2.5" fontVariantNumeric="tabular-nums" color={t.color}>{t.value}</Text>
                  <Text textStyle="xs" color="fg.muted" mt="2">{t.sub}</Text>
                </RouterLink>
              </Box>
            ))}
          </Grid>
        </Box>

        {/* ───────── Executive overview ───────── */}
        <Box as="section">
          <SectionHeading title="Executive overview" />
          <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }} gap="4">
            <Panel title="Issues by priority"><Donut parts={h.parts.priority} center={fmtInt(snap.issues)} centerLabel="issues" /></Panel>
            <Panel title="Issues by category"><Donut parts={h.parts.category} center={`${pct(snap.category.accessibility.issues, snap.issues)}%`} centerLabel="accessibility" /></Panel>
            <Panel title={scope.type ? "Critical pages by year or folder" : "Critical pages by page type"}>
              {p1Parts.length ? <Donut parts={p1Parts} center={fmtInt(snap.p1Pages)} centerLabel="pages with a P1" /> : <Text textStyle="sm" color="fg.muted">No page here has a critical issue.</Text>}
            </Panel>
            <Panel title="Shared template vs page-specific issues"><Donut parts={h.parts.markup} center={`${pct(snap.shared.issues, snap.issues)}%`} centerLabel="shared" /></Panel>
          </Grid>
        </Box>

        {/* ───────── Priority × category ───────── */}
        <Box as="section">
          <Panel title="Issues by priority and category" action={<MoreLink to={L.issues()}>All issues</MoreLink>}>
            <Heatmap h={h} />
            <Box mt="5"><SegBar parts={h.parts.priority} h="2.5" /></Box>
            <HStack gap="4" mt="2" wrap="wrap">
              {PRIORITIES.map((p) => (
                <HStack key={p} gap="1.5" textStyle="xs"><Box boxSize="2" rounded="sm" bg={PRI_COLOR[p]} /><Text>{p} {PRI_LABEL[p]}</Text><Text color="fg.muted">{pct(snap.priority[p].issues, snap.issues)}%</Text></HStack>
              ))}
            </HStack>
          </Panel>
        </Box>

        {/* ───────── Core Web Vitals ───────── */}
        <Box as="section">
          <Panel
            title={<HStack gap="1.5"><Text>Core Web Vitals</Text><Help text={vt.audited ? `Lighthouse lab results on ${fmtInt(vt.audited)} of ${fmtInt(vt.pages)} pages${vt.full ? "" : " (a sample; running Lighthouse on every page is more accurate but takes about 8 hours)"}.` : "Lighthouse didn't audit any pages in this selection."} /></HStack>}
            action={vt.audited > 0 ? <HStack gap="2"><Status rating={passed ? "good" : "poor"} /><Text textStyle="sm" fontWeight="semibold" color={passed ? "green.fg" : "red.fg"}>{passed ? "Passed" : "Failed"}</Text></HStack> : undefined}>
            {vt.audited > 0 && <Box mt="-2">{vt.stats.map((st) => <VitalRow key={st.id} st={st} audited={vt.audited} />)}</Box>}
          </Panel>
        </Box>

        {/* ───────── Template fixes ───────── */}
        <Box as="section">
          <SectionHeading title="Template fixes that clear the most issues" action={<MoreLink to={L.issues({ markup: "shared" })}>All template issues</MoreLink>} />
          <Stack gap="0" borderWidth="1px" rounded="l3" overflow="hidden">
            {fixes.length === 0 && <Text px="4" py="3" textStyle="sm" color="fg.muted">No template fixes match these filters.</Text>}
            {fixes.map((f) => (
              <HStack asChild key={f.rule.id + f.pattern} gap="4" px="4" py="3" borderTopWidth="1px" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }}>
                <RouterLink to={L.rule(f.rule.id, f.pattern)}>
                  <Badge variant="subtle" colorPalette="green" flexShrink={0} w={{ base: "24", sm: "28" }} justifyContent="center">{templateComponent(f.pattern)}</Badge>
                  <Stack gap="0" flex="1" minW="0">
                    <Text textStyle="sm" truncate>{f.rule.title}</Text>
                    <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate>{f.pattern}</Text>
                  </Stack>
                  <Text textStyle="xs" color={PRIORITY_COLOR[f.priority]} flexShrink={0}>{f.priority}</Text>
                </RouterLink>
              </HStack>
            ))}
          </Stack>
        </Box>

        {/* ───────── Pages to fix first ───────── */}
        <Box as="section">
          <SectionHeading title={pris.length > 0 && !pris.includes("P1") ? "Pages with the most matching issues" : "Pages with the most critical issues"} action={<MoreLink to={L.pages(scope, "worst")}>All pages</MoreLink>} />
          <Stack gap="0" borderWidth="1px" rounded="l3" overflow="hidden">
            {worstPages.length === 0 && <Text px="4" py="3" textStyle="sm" color="fg.muted">No pages match these filters.</Text>}
            {worstPages.map((w) => (
              <Flex asChild key={w.page.i} gap="3" direction={{ base: "column", sm: "row" }} align={{ base: "stretch", sm: "center" }} px="4" py="3" borderTopWidth="1px" _first={{ borderTopWidth: 0 }} _hover={{ bg: "bg.subtle" }}>
                <RouterLink to={L.page(w.page.i)} title={w.page.path}>
                  <Stack gap="0" flex="1" minW="0">
                    <Text textStyle="sm" truncate>{w.page.title}</Text>
                    <Text textStyle="xs" color="fg.muted" truncate>{w.page.path}</Text>
                  </Stack>
                  <Stack gap="1" align={{ base: "start", sm: "end" }} flexShrink={0}>
                    <HStack gap="3" wrap="wrap" textStyle="xs" fontVariantNumeric="tabular-nums">
                      {PRIORITIES.filter((p) => w.counts[p] > 0).map((p) => (
                        <Text key={p} color={PRIORITY_COLOR[p]}>{w.counts[p]} {PRI_LABEL[p].toLowerCase()}</Text>
                      ))}
                    </HStack>
                    <Text textStyle="xs" color="fg.muted">{w.total} issues total</Text>
                  </Stack>
                </RouterLink>
              </Flex>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Container>
    </>
  );
}

// Laid out like Google's PageSpeed Insights: a status icon and value per metric, and one bar showing how many pages are good,
// need improvement or are poor. Pages are ordered good → poor along the bar, so the 75th percentile (what Google rates) sits at 75%.
// Status is never colour alone: circle = good, square = needs improvement, triangle = poor.
const ZONE = { good: "green.500", ni: "orange.500", poor: "red.500" } as const;
function Status({ rating }: { rating: "good" | "ni" | "poor" }) {
  return <Box boxSize="3" flexShrink={0} bg={ZONE[rating]} rounded={rating === "good" ? "full" : rating === "ni" ? "xs" : undefined} style={rating === "poor" ? { clipPath: "polygon(50% 0, 100% 100%, 0 100%)" } : undefined} />;
}
function VitalRow({ st, audited }: { st: VitalStat; audited: number }) {
  const v = VITALS.find((x) => x.id === st.id)!;
  const color = st.rating === "good" ? "green.fg" : st.rating === "ni" ? "orange.fg" : "red.fg";
  const segs = ([["good", st.good], ["ni", st.ni], ["poor", st.poor]] as const).filter(([, n]) => n > 0);
  return (
    <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "200px minmax(0, 1fr)" }} gap={{ base: "3", md: "8" }} py="4" borderTopWidth="1px" borderColor="border.muted" _first={{ borderTopWidth: 0 }} alignItems="center">
      <Stack gap="1.5">
        <HStack gap="1.5"><Text textStyle="sm" color="fg.muted">{v.full}</Text><Help text={`${v.name}. ${v.help} The value is the 75th percentile: three in four pages do better.`} /></HStack>
        <HStack gap="2"><Status rating={st.rating} /><Text textStyle="2xl" fontWeight="semibold" lineHeight="1" color={color} fontVariantNumeric="tabular-nums">{v.fmt(st.p75)}</Text></HStack>
      </Stack>
      <Box role="img" aria-label={`${v.full}: ${pct(st.good, audited)}% good, ${pct(st.ni, audited)}% needs improvement, ${pct(st.poor, audited)}% poor`}>
        <Flex gap="2px" mb="1.5" textStyle="xs" fontVariantNumeric="tabular-nums">
          {segs.map(([k, n]) => <Text key={k} style={{ flexGrow: n }} flexBasis="0" minW="8" fontWeight="medium" color={ZONE[k]}>{pct(n, audited)}%</Text>)}
        </Flex>
        <Box position="relative">
          <Flex h="2.5" gap="2px" rounded="full" overflow="hidden">
            {segs.map(([k, n]) => <Box key={k} style={{ flexGrow: n }} flexBasis="0" bg={ZONE[k]} />)}
          </Flex>
          <Box position="absolute" w="2px" bg="fg" rounded="full" style={{ left: "75%", top: "-3px", bottom: "-3px", transform: "translateX(-1px)" }} />
        </Box>
      </Box>
    </Grid>
  );
}
