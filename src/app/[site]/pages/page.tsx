"use client";

// Pages · /[site]/pages: every page of the site in one crawl, or the delta between two crawls.
// Same frame as Crawl history: header (scope) → facts row → one data panel (toolbar + filters + table + pagination).
//
// Scope: "Crawl" picks the snapshot; "Compared with" picks an older baseline (default: the previous crawl).
//   Comparing adds the segments "All in #A" (every page in crawl A: new + changed + unchanged), New, Changed, Removed
//   (in the baseline, gone from A; the only rows that aren't in A) and a Change column. Changed = content hash differs.
// Filters (all combine, all live in the URL so a filtered view can be shared):
//   search (URL, title, H1) · type (from the URL path) · year (from the URL path) · rule (regex, shows match count)
//   · links to (pages that link to a pasted URL). Issue categories are sort options ("Most accessibility issues"),
//   not a filter: a sort never hides pages, so there's no "has any" vs "has only" ambiguity.
//
// PROTOTYPE: data comes from src/lib/site-pages.ts. Rows don't open a page detail yet.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge, Box, Button, ButtonGroup, Container, DataList, Flex, Grid, HStack, Heading, IconButton, Input, InputGroup, Pagination, Portal,
  Select, Span, Stack, Text, createListCollection,
} from "@chakra-ui/react";
import { LuChevronLeft, LuChevronRight, LuLink, LuX } from "react-icons/lu";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { useSite } from "@/components/site-context";
import { crawlsFor } from "@/lib/crawls-list";
import { ENVIRONMENTS } from "@/lib/settings";
import {
  CATEGORIES, LH_SAMPLE, PAGE_TYPES, RULES, YEARS, crawlChoices, fullLighthouse, issuesIn, linksTo, normalizeTarget, pagesFor, ruleMatches,
  severity, totalIssues, typeLabel, yearOf, type Category, type Change, type PageView, type RuleId,
} from "@/lib/site-pages";
import { fmtNum } from "@/lib/types";

type Sort = "worst" | `cat:${Category}` | "changed" | "path" | "matches";
type ChangeFilter = "all" | Exclude<Change, "same">;
type State = { crawl: string; vs: string; q: string; type: string; year: string; rule: string; links: string; sort: Sort; change: ChangeFilter };

const PAGE_SIZE = 50;
const CHANGE_BADGE: Record<Change, { label: string; color: string } | null> = {
  new: { label: "New", color: "green" }, changed: { label: "Changed", color: "blue" }, removed: { label: "Removed", color: "red" }, same: null,
};

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function PagesPage() {
  return <Suspense><Pages /></Suspense>;
}

function Pages() {
  const site = useSite();
  const crawls = useMemo(() => crawlChoices(site), [site]);
  const dates = useMemo(() => new Map(crawlsFor(site).map((c) => [Number(c.id), c.startedAt])), [site]); // any crawl, failed ones too
  const sp = useSearchParams();

  // Defaults: the latest finished crawl, compared with the one before it
  const defaults: State = { crawl: crawls[0].id, vs: crawls[1]?.id ?? "none", q: "", type: "all", year: "all", rule: "none", links: "", sort: "worst", change: "all" };
  const [s, setS] = useState<State>(() => {
    const init = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof State)[]) { const v = sp.get(k); if (v != null) (init as Record<string, string>)[k] = v; }
    return init;
  });
  const [page, setPage] = useState(1);
  const set = (patch: Partial<State>) => { setS((x) => ({ ...x, ...patch })); setPage(1); };

  // Mirror non-default values into the URL without a navigation
  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of Object.keys(s) as (keyof State)[]) if (s[k] !== defaults[k]) p.set(k, s[k]);
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = Number(s.crawl);
  const b = s.vs === "none" ? null : Number(s.vs);
  const all = useMemo(() => pagesFor(site, a, b), [site, a, b]);
  const comparing = b != null;
  // Sorting by an issue category ranks pages by that category and shows it in the Issues column; it never hides pages
  const cat = s.sort.startsWith("cat:") ? (s.sort.slice(4) as Category) : null;
  const rule = s.rule === "none" ? null : (s.rule as RuleId);
  const target = normalizeTarget(s.links);
  const links = useMemo(() => (target ? linksTo(target, all) : null), [target, all]);

  // Every filter except the change segment, so the segment counts follow the other filters
  const filtered = useMemo(() => {
    const q = s.q.trim().toLowerCase();
    const year = s.year === "all" ? null : s.year === "none" ? "none" : Number(s.year);
    return all
      .map((p) => ({ p, matches: rule ? ruleMatches(p, rule) : 0 }))
      .filter(({ p, matches }) =>
        (!q || p.path.toLowerCase().includes(q) || p.title.toLowerCase().includes(q) || p.h1.toLowerCase().includes(q)) &&
        (s.type === "all" || p.type === s.type) &&
        (year == null || (year === "none" ? yearOf(p.path) == null : yearOf(p.path) === year)) &&
        (!rule || matches > 0) &&
        (!links || links.from.has(p.i)));
  }, [all, s.q, s.type, s.year, rule, links]);

  const counts = useMemo(() => {
    const c = { all: 0, new: 0, changed: 0, removed: 0 };
    for (const { p } of filtered) { if (p.change !== "removed") c.all++; if (p.change && p.change !== "same") c[p.change]++; }
    return c;
  }, [filtered]);

  const rows = useMemo(() => {
    const change = comparing ? s.change : "all";
    const r = filtered.filter(({ p }) => (change === "all" ? p.change !== "removed" : p.change === change));
    const sort = s.sort === "matches" && !rule ? "worst" : s.sort;
    type Row = (typeof r)[number];
    const by: Record<"worst" | "cat" | "changed" | "path" | "matches", (x: Row, y: Row) => number> = {
      worst: (x, y) => severity(y.p, null) - severity(x.p, null),
      cat: (x, y) => severity(y.p, cat) - severity(x.p, cat),
      changed: (x, y) => (y.p.lastChanged ?? 0) - (x.p.lastChanged ?? 0),
      path: (x, y) => x.p.path.localeCompare(y.p.path),
      matches: (x, y) => y.matches - x.matches,
    };
    return r.sort((x, y) => by[sort.startsWith("cat:") ? "cat" : (sort as Exclude<Sort, `cat:${Category}`>)](x, y) || x.p.path.localeCompare(y.p.path));
  }, [filtered, comparing, s.change, s.sort, rule, cat]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const inCrawl = all.filter((p) => p.change !== "removed");
  const audited = inCrawl.filter((p) => p.perf != null).length;
  const active = (["q", "type", "year", "rule", "links"] as const).some((k) => s[k] !== defaults[k]);
  const crawlLabel = (id: string) => { const c = crawls.find((x) => x.id === id); return c ? `#${c.id} · ${fmtDay(c.startedAt)}` : `#${id}`; };

  const toCsv = () => ["url,title,type,status,issues,critical,change,last_changed" + (rule ? ",rule_matches" : ""),
    ...rows.map(({ p, matches }) => [p.path, p.title, p.type, p.status, totalIssues(p), p.critical, p.change ?? "", p.lastChanged ?? "", ...(rule ? [matches] : [])]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

  // Columns appear only when they say something: Matches with a rule, Change while comparing
  const cols = ["minmax(280px, 3fr)", "96px", "56px", "132px", ...(rule ? ["72px"] : []), ...(comparing ? ["84px"] : []), "92px"].join(" ");

  return (
    <Box bg="bg" minH="100vh">
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="7" pb="5">
          <Flex justify="space-between" align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }} gap="4" mb="5">
            <Heading size="xl" fontWeight="semibold">Pages</Heading>
            <HStack gap="2" wrap="wrap">
              <ScopeSelect label="Crawl" value={s.crawl} onChange={(v) => {
                // The baseline has to be older than the crawl; keep "previous" relative
                const idx = crawls.findIndex((c) => c.id === v);
                set({ crawl: v, vs: s.vs === "none" ? "none" : Number(s.vs) < Number(v) ? s.vs : crawls[idx + 1]?.id ?? "none" });
              }} items={crawls.map((c) => ({ value: c.id, label: crawlLabel(c.id), hint: ENVIRONMENTS[c.environment].label }))} />
              <Text textStyle="sm" color="fg.muted">compared with</Text>
              <ScopeSelect label="Baseline" value={s.vs} onChange={(v) => set({ vs: v, change: "all" })}
                items={[{ value: "none", label: "No comparison", hint: "" }, ...crawls.filter((c) => Number(c.id) < a).map((c) => {
                  const days = Math.round(((dates.get(a)?.getTime() ?? 0) - c.startedAt.getTime()) / 86_400_000);
                  return { value: c.id, label: crawlLabel(c.id), hint: days <= 0 ? "Same day" : `${days} day${days === 1 ? "" : "s"} earlier` };
                })]} />
            </HStack>
          </Flex>

          <DataList.Root orientation="vertical" size="sm" display="grid" gridTemplateColumns={{ base: "repeat(2, 1fr)", md: "repeat(5, minmax(0, 1fr))" }} gap="5">
            <Fact label="Pages in this crawl">{inCrawl.length.toLocaleString("en-US")}</Fact>
            <Fact label="New" muted={!comparing}>{comparing ? <Delta n={all.filter((p) => p.change === "new").length} color="green.fg" /> : "—"}</Fact>
            <Fact label="Changed" muted={!comparing}>{comparing ? <Delta n={all.filter((p) => p.change === "changed").length} color="blue.fg" /> : "—"}</Fact>
            <Fact label="Removed" muted={!comparing}>{comparing ? <Delta n={all.filter((p) => p.change === "removed").length} color="red.fg" /> : "—"}</Fact>
            <Fact label="Lighthouse coverage">
              {fullLighthouse(a) ? "Full site" : <>Sample · <Span color="fg.muted">{audited.toLocaleString("en-US")} of {fmtNum(inCrawl.length)}</Span></>}
            </Fact>
          </DataList.Root>
        </Container>
      </Box>

      <Container maxW="7xl" py="6">
        <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
          <DataToolbar<ChangeFilter>
            query={s.q} onQuery={(q) => set({ q })} placeholder="Search URL, title or H1"
            segments={comparing ? [
              { value: "all", label: `All in #${s.crawl} ${fmtNum(counts.all)}` }, // A's pages = new + changed + unchanged
              { value: "new", label: `New ${fmtNum(counts.new)}` },
              { value: "changed", label: `Changed ${fmtNum(counts.changed)}` },
              { value: "removed", label: `Removed ${fmtNum(counts.removed)}` },
            ] : undefined}
            value={s.change} onValue={(change) => set({ change })}
            count={active ? `${rows.length.toLocaleString("en-US")} matches` : ""}
            copyLabel="Copy URLs" onCopy={() => navigator.clipboard.writeText(rows.map(({ p }) => p.path).join("\n"))}
            downloadLabel="Download these pages (.csv)" onDownload={() => downloadText(toCsv(), `pages-${site}-${s.crawl}.csv`, "text/csv")}
          />

          {/* Filters: one row, every control the same small size */}
          <HStack gap="2" px="2" py="1.5" borderBottomWidth="1px" bg="bg.subtle" wrap="wrap">
            <FilterSelect value={s.type} onChange={(type) => set({ type })} w="36" items={[
              { value: "all", label: "All types" }, ...PAGE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.prefix ?? "No match" })),
            ]} />
            <FilterSelect value={s.year} onChange={(year) => set({ year })} w="28" items={[
              { value: "all", label: "Any year" }, ...YEARS.map((y) => ({ value: String(y), label: String(y) })), { value: "none", label: "No year in URL" },
            ]} />
            <FilterSelect value={s.rule} onChange={(r) => set({ rule: r, sort: r !== "none" ? "matches" : s.sort === "matches" ? "worst" : s.sort })} w="44" items={[
              { value: "none", label: "Any rule" }, ...RULES.map((r) => ({ value: r.id, label: r.name, hint: r.pattern, mono: true })),
            ]} />
            <InputGroup w="64" startElement={<LuLink />}
              endElement={s.links ? <IconButton aria-label="Clear link target" size="2xs" variant="ghost" onClick={() => set({ links: "" })}><LuX /></IconButton> : undefined}>
              <Input size="xs" placeholder="Links to… paste a URL" value={s.links} onChange={(e) => set({ links: e.target.value })} />
            </InputGroup>
            {active && <Button size="xs" variant="ghost" onClick={() => set({ q: "", type: "all", year: "all", rule: "none", links: "", sort: s.sort === "matches" ? "worst" : s.sort })}>Clear filters</Button>}
            <HStack gap="2" ms="auto">
              <Text textStyle="xs" color="fg.muted">Sort</Text>
              <FilterSelect value={s.sort === "matches" && !rule ? "worst" : s.sort} onChange={(v) => set({ sort: v as Sort })} w="48" items={[
                ...(rule ? [{ value: "matches", label: "Most rule matches" }] : []),
                { value: "worst", label: "Most issues", hint: "All categories, critical first" },
                ...CATEGORIES.map((c) => ({ value: `cat:${c.id}`, label: `Most ${c.short} issues`, hint: c.label })),
                { value: "changed", label: "Recently changed" },
                { value: "path", label: "Path A–Z" },
              ]} />
            </HStack>
          </HStack>

          {/* What "Links to" resolved to, so a pasted URL is never a guess */}
          {links && (
            <HStack gap="2" px="3" py="1.5" borderBottomWidth="1px" textStyle="xs" color="fg.muted" wrap="wrap">
              <LuLink />
              <Text>{links.from.size.toLocaleString("en-US")} {links.from.size === 1 ? "page links" : "pages link"} to</Text>
              <Text fontFamily="mono" color="fg">{target}</Text>
              {links.target
                ? <Badge size="xs" variant="subtle" colorPalette={links.target.status === 200 ? "green" : links.target.status === 301 ? "blue" : "red"}>{links.target.status}</Badge>
                : <Text>· not a page in this crawl{target.startsWith("/") ? "" : " (external)"}</Text>}
            </HStack>
          )}

          <Box overflowX="auto">
            <Box minW="820px">
              <Grid templateColumns={cols} gap="3" px="3" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
                <Text>Page</Text><Text>Type</Text><Text>Status</Text>
                <Text>{cat ? CATEGORIES.find((c) => c.id === cat)!.label : "Issues"}</Text>
                {rule && <Text textAlign="right">Matches</Text>}
                {comparing && <Text>Change</Text>}
                <Text>Last changed</Text>
              </Grid>
              {rows.length === 0 ? (
                <Text p="4" textStyle="sm" color="fg.muted">
                  {links && links.from.size === 0 ? `No page in crawl #${s.crawl} links to ${target}.` : "No pages match these filters."}
                </Text>
              ) : pageRows.map(({ p, matches }) => (
                <PageRowView key={p.i} p={p} cols={cols} cat={cat} matches={rule ? matches : null} comparing={comparing}
                  changedOn={p.lastChanged != null ? dates.get(p.lastChanged) ?? null : null} since={crawlsFor(site).at(-1)!.startedAt} />
              ))}
            </Box>
          </Box>

          {rows.length > 0 && (
            <Pagination.Root count={rows.length} pageSize={PAGE_SIZE} page={page} onPageChange={(e) => setPage(e.page)}>
              <HStack justify="space-between" px="3" py="2" borderTopWidth="1px" bg="bg.subtle">
                <Pagination.PageText format="long" textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums" />
                <ButtonGroup variant="ghost" size="xs">
                  <Pagination.PrevTrigger asChild><IconButton aria-label="Previous page"><LuChevronLeft /></IconButton></Pagination.PrevTrigger>
                  <Pagination.Items render={(pg) => <IconButton variant="ghost" color="fg.muted" _selected={{ bg: "bg.emphasized", color: "fg", fontWeight: "semibold" }}>{pg.value}</IconButton>} />
                  <Pagination.NextTrigger asChild><IconButton aria-label="Next page"><LuChevronRight /></IconButton></Pagination.NextTrigger>
                </ButtonGroup>
              </HStack>
            </Pagination.Root>
          )}
        </Flex>
        {!fullLighthouse(a) && cat === "performance" && (
          <Text mt="3" textStyle="xs" color="fg.muted">
            Performance issues come from Lighthouse, which audited a sample of {LH_SAMPLE} pages in this crawl. Pick a full-site crawl (every 10th) to see all pages.
          </Text>
        )}
      </Container>
    </Box>
  );
}

function PageRowView({ p, cols, cat, matches, comparing, changedOn, since }: {
  p: PageView; cols: string; cat: Category | null; matches: number | null; comparing: boolean; changedOn: Date | null; since: Date;
}) {
  const removed = p.change === "removed";
  const n = cat ? issuesIn(p, cat) : totalIssues(p);
  const change = p.change ? CHANGE_BADGE[p.change] : null;
  return (
    <Grid templateColumns={cols} gap="3" px="3" py="2" alignItems="center" textStyle="xs"
      borderBottomWidth="1px" borderColor="border.muted" _hover={{ bg: "bg.subtle" }} fontVariantNumeric="tabular-nums">
      <Stack gap="0" minW="0">
        <Text textStyle="sm" truncate color={removed ? "fg.muted" : undefined} title={p.title}>{p.title}</Text>
        <Text fontFamily="mono" color="fg.muted" truncate title={p.path}>{p.path}</Text>
      </Stack>
      <Text color="fg.muted">{typeLabel(p.type)}</Text>
      <Box><Badge size="xs" variant="subtle" colorPalette={p.status === 200 ? "green" : p.status === 301 ? "blue" : p.status === 404 ? "orange" : "red"}>{p.status}</Badge></Box>
      <HStack gap="2">
        {n == null ? <Text color="fg.subtle">Not audited</Text> : <Text fontWeight="medium" color={n === 0 ? "fg.subtle" : undefined}>{n}</Text>}
        {p.critical > 0 && (!cat || cat === "accessibility") && <Badge size="xs" variant="subtle" colorPalette="red">{p.critical} critical</Badge>}
      </HStack>
      {matches != null && <Text textAlign="right" fontWeight="medium">{matches}</Text>}
      {comparing && <Box>{change ? <Badge size="xs" variant="outline" colorPalette={change.color}>{change.label}</Badge> : <Text color="fg.subtle">—</Text>}</Box>}
      <Text color="fg.muted">{changedOn ? fmtDay(changedOn) : p.lastChanged != null ? `#${p.lastChanged}` : `Before ${fmtDay(since)}`}</Text>
    </Grid>
  );
}

function Fact({ label, muted, children }: { label: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <DataList.Item>
      <DataList.ItemLabel>{label}</DataList.ItemLabel>
      <DataList.ItemValue display="block" fontWeight="medium" fontVariantNumeric="tabular-nums" color={muted ? "fg.subtle" : undefined}>{children}</DataList.ItemValue>
    </DataList.Item>
  );
}

const Delta = ({ n, color }: { n: number; color: string }) => <Span color={n ? color : "fg.subtle"}>{n.toLocaleString("en-US")}</Span>;

// ───────── Selects ─────────
type Item = { value: string; label: string; hint?: string; mono?: boolean };
// Items are rebuilt on every render; keep the collection stable while their content is the same
function useItems(items: Item[]) {
  const key = JSON.stringify(items);
  return useMemo(() => createListCollection({ items }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Filter dropdowns in the panel: Chakra Select (styled), xs to match the toolbar
function FilterSelect({ value, onChange, items, w }: { value: string; onChange: (v: string) => void; items: Item[]; w: string }) {
  const collection = useItems(items);
  const on = value !== items[0].value; // the first item is the "no filter" value
  return (
    <Select.Root collection={collection} size="xs" w={w} value={[value]} onValueChange={(e) => e.value[0] && onChange(e.value[0])} positioning={{ sameWidth: false }}>
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger borderColor={on ? "border.emphasized" : undefined} bg={on ? "bg" : undefined} fontWeight={on ? "medium" : undefined}>
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content minW="56" maxH="80">
            {items.map((item) => (
              <Select.Item key={item.value} item={item}>
                <Stack gap="0" minW="0">
                  <Text>{item.label}</Text>
                  {item.hint && <Text textStyle="xs" color="fg.muted" fontFamily={item.mono || item.hint.startsWith("/") ? "mono" : undefined} truncate>{item.hint}</Text>}
                </Stack>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

// Crawl / baseline pickers in the header: crawl id + date, environment or distance as a hint
function ScopeSelect({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: Item[] }) {
  const collection = useItems(items);
  return (
    <Select.Root collection={collection} size="sm" w="48" value={[value]} onValueChange={(e) => e.value[0] && onChange(e.value[0])} aria-label={label}>
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger bg="bg"><Select.ValueText /></Select.Trigger>
        <Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content maxH="80">
            {items.map((item) => (
              <Select.Item key={item.value} item={item}>
                <Text flex="1">{item.label}</Text>
                {item.hint && <Text textStyle="xs" color="fg.muted">{item.hint}</Text>}
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}
