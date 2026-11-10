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
import { Suspense, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Badge, Box, Button, Container, Flex, Grid, HStack, Heading, IconButton, Input, InputGroup, Stack, Text,
} from "@chakra-ui/react";
import { LuLink, LuX } from "react-icons/lu";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { FilterSelect } from "@/components/filter-select";
import { CrawlScope } from "@/components/scope-select";
import { TablePagination } from "@/components/table-pagination";
import { useSite } from "@/components/site-context";
import { bandOf, WEIGHT } from "@/lib/analytics";
import { crawlsFor } from "@/lib/crawls-list";
import { RULE_CATALOG } from "@/lib/page-issues";
import { PRIORITIES, PRIORITY } from "@/lib/priority";
import { folderLabel, inPageScope, issueScopeDefaults, matchesIssueScope, pageScopeDefaults, queryString, useRouteQuery } from "@/lib/route-query";
import { countOf, hitsFor, type Seg } from "@/lib/site-issues";
import {
  CATEGORIES, currentIssueCounts, defaultScope, lighthouseCoverage, PAGE_TYPES, RULES, YEARS, issuesIn, linksTo, normalizeTarget, pagesFor, ruleMatches,
  severity, totalIssues, type Category, type Change, type PageView, type RuleId,
} from "@/lib/site-pages";
import { fmtNum } from "@/lib/types";

type Sort = "worst" | `cat:${Category}` | "changed" | "path" | "matches";
type ChangeFilter = "all" | Exclude<Change, "same">;

const PAGE_SIZE = 50;
const bandDefaults = { band: "all", worst: "all" };
const noMatchingIssues = { issues: 0, critical: 0, serious: 0, score: 100, worst: "none" };
const CHANGE_BADGE: Record<Change, { label: string; color: string } | null> = {
  new: { label: "New", color: "green" }, changed: { label: "Changed", color: "blue" }, removed: { label: "Removed", color: "red" }, same: null,
};

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function PagesPage() {
  return <Suspense><Pages /></Suspense>;
}

function Pages() {
  const site = useSite();
  const dates = useMemo(() => new Map(crawlsFor(site).map((c) => [Number(c.id), c.startedAt])), [site]); // any crawl, failed ones too
  const defaults = { ...defaultScope(site), ...pageScopeDefaults, ...issueScopeDefaults, ...bandDefaults, q: "", rule: "none", links: "", sort: "worst", change: "all" };
  const [s, set, query] = useRouteQuery(site, defaults);
  const paginationKey = `${site}:${query}`;
  const [pagination, setPagination] = useState({ key: paginationKey, page: 1 });
  const page = pagination.key === paginationKey ? pagination.page : 1;
  const setPage = (next: number) => setPagination({ key: paginationKey, page: next });

  const a = Number(s.crawl);
  const b = s.vs === "none" ? null : Number(s.vs);
  const all = useMemo(() => pagesFor(site, a, b), [site, a, b]);
  const comparing = b != null;
  const coverage = lighthouseCoverage(site, a);
  // Sorting by an issue category ranks pages by that category and shows it in the Issues column; it never hides pages
  const cat = s.cat !== "all" && !s.cat.includes(",") ? s.cat as Category : s.cat === "all" && s.sort.startsWith("cat:") ? (s.sort.slice(4) as Category) : null;
  const rule = s.rule === "none" ? null : (s.rule as RuleId);
  const target = normalizeTarget(s.links);
  const links = useMemo(() => (target ? linksTo(target, all) : null), [target, all]);
  const { type, year, sub, pri, markup, auditRule, el } = s;
  const seg = (comparing ? s.seg : "all") as Seg;
  const issueFiltered = Object.keys(issueScopeDefaults).some((key) => s[key as keyof typeof issueScopeDefaults] !== issueScopeDefaults[key as keyof typeof issueScopeDefaults]);
  const { band, worst } = s;
  const bandFiltered = band !== "all" || worst !== "all";
  const matchingIssues = useMemo(() => {
    if (!issueFiltered && !bandFiltered) return null;
    const rules = new Map<number, Set<string>>();
    for (const hit of hitsFor(site, a, b)) {
      if (!countOf(hit, seg) || !matchesIssueScope(hit, { pri, cat: s.cat, markup, auditRule, el })) continue;
      const matched = rules.get(hit.p.i) ?? new Set();
      matched.add(hit.rule);
      rules.set(hit.p.i, matched);
    }
    return new Map([...rules].map(([id, matched]) => {
      const priorities = [...matched].map((ruleId) => PRIORITY[RULE_CATALOG[ruleId].severity]);
      return [id, {
        issues: matched.size,
        critical: priorities.filter((priority) => priority === "P1").length,
        serious: priorities.filter((priority) => priority === "P2").length,
        score: Math.max(0, 100 - priorities.reduce((points, priority) => points + WEIGHT[priority], 0)),
        worst: PRIORITIES.find((priority) => priorities.includes(priority)) ?? "none",
      }];
    }));
  }, [site, a, b, seg, issueFiltered, bandFiltered, pri, s.cat, markup, auditRule, el]);

  // Every filter except the change segment, so the segment counts follow the other filters
  const filtered = useMemo(() => {
    const q = s.q.trim().toLowerCase();
    return all
      .map((p) => ({ p, matches: rule ? ruleMatches(p, rule) : 0, matching: matchingIssues ? matchingIssues.get(p.i) ?? noMatchingIssues : null }))
      .filter(({ p, matches, matching }) =>
        (!q || p.path.toLowerCase().includes(q) || p.title.toLowerCase().includes(q) || p.h1.toLowerCase().includes(q)) &&
        inPageScope(p, { type, year, sub }) &&
        (!matching || (bandFiltered ? p.change !== "removed" && (band === "all" || bandOf(matching.score) === band) && (worst === "all" || matching.worst === worst) : matching.issues > 0)) &&
        (!rule || matches > 0) &&
        (!links || links.from.has(p.i)));
  }, [all, s.q, type, year, sub, rule, links, matchingIssues, bandFiltered, band, worst]);

  const counts = useMemo(() => {
    const c = { all: 0, new: 0, changed: 0, removed: 0 };
    for (const { p } of filtered) { if (p.change !== "removed") c.all++; if (p.change && p.change !== "same") c[p.change]++; }
    return c;
  }, [filtered]);

  const rows = useMemo(() => {
    const change = comparing ? s.change : "all";
    const r = filtered.filter(({ p }) => (change === "all" ? p.change !== "removed" : p.change === change));
    const sort = (s.sort === "matches" && !rule ? "worst" : s.sort) as Sort;
    type Row = (typeof r)[number];
    const by: Record<"worst" | "cat" | "changed" | "path" | "matches", (x: Row, y: Row) => number> = {
      worst: (x, y) => severity(y.p, null) - severity(x.p, null),
      cat: (x, y) => severity(y.p, cat) - severity(x.p, cat),
      changed: (x, y) => (y.p.lastChanged ?? 0) - (x.p.lastChanged ?? 0),
      path: (x, y) => x.p.path.localeCompare(y.p.path),
      matches: (x, y) => y.matches - x.matches,
    };
    return r.sort((x, y) => {
      const order = (sort === "worst" || sort.startsWith("cat:")) && x.matching && y.matching
        ? y.matching.critical - x.matching.critical || y.matching.serious - x.matching.serious || y.matching.issues - x.matching.issues
        : by[sort.startsWith("cat:") ? "cat" : (sort as Exclude<Sort, `cat:${Category}`>)](x, y);
      return order || x.p.path.localeCompare(y.p.path);
    });
  }, [filtered, comparing, s.change, s.sort, rule, cat]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const active = issueFiltered || bandFiltered || (["q", "type", "year", "sub", "rule", "links"] as const).some((k) => s[k] !== defaults[k]);
  const issuesCount = (p: PageView) => cat ? issuesIn(p, cat) : totalIssues(p);
  const criticalCount = (p: PageView) => !cat || cat === "accessibility" ? currentIssueCounts(p).critical : 0;
  const from = `/${site}/pages${queryString({ ...s })}`;

  const toCsv = () => ["url,title,type,status,issues,critical,change,last_changed" + (rule ? ",rule_matches" : ""),
    ...rows.map(({ p, matches, matching }) => [p.path, p.title, p.type, p.status, matching ? matching.issues : issuesCount(p) ?? "", matching?.critical ?? criticalCount(p), p.change ?? "", p.lastChanged ?? "", ...(rule ? [matches] : [])]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

  // Page · Issues · Matches (only with a rule) · Last changed. Type is visible in the path; status shows only when it isn't 200;
  // the New / Changed / Removed badge sits next to the date, since both answer "what happened to this page".
  const cols = ["minmax(0, 1fr)", "150px", ...(rule ? ["72px"] : []), "170px"].join(" ");

  return (
    <Box bg="bg" minH="100vh">
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="7" pb="5">
          <Flex justify="space-between" align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }} gap="4">
            <Heading size="xl" fontWeight="semibold">Pages</Heading>
            <CrawlScope crawl={s.crawl} vs={s.vs} onChange={(crawl, vs) => set({ crawl, vs, change: "all" })} />
          </Flex>

        </Container>
      </Box>

      <Container maxW="7xl" py="6">
        <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
          <DataToolbar<ChangeFilter>
            query={s.q} onQuery={(q) => set({ q })} placeholder="Search URL, title or H1"
            segments={comparing ? [
              { value: "all", label: `All in #${s.crawl} (${fmtNum(counts.all)})` }, // A's pages = new + changed + unchanged
              { value: "new", label: `New (${fmtNum(counts.new)})` },
              { value: "changed", label: `Changed (${fmtNum(counts.changed)})` },
              { value: "removed", label: `Removed (${fmtNum(counts.removed)})` },
            ] : undefined}
            value={s.change as ChangeFilter} onValue={(change) => set({ change })}
            count={active ? `${rows.length.toLocaleString("en-US")} matches` : comparing ? "" : `${counts.all.toLocaleString("en-US")} pages`}
            copyLabel="Copy URLs" onCopy={() => navigator.clipboard.writeText(rows.map(({ p }) => p.path).join("\n"))}
            downloadLabel="Download these pages (.csv)" onDownload={() => downloadText(toCsv(), `pages-${site}-${s.crawl}.csv`, "text/csv")}
          />

          {/* Filters: one row, every control the same small size */}
          <HStack gap="2" px="2" py="1.5" borderBottomWidth="1px" bg="bg.subtle" wrap="wrap">
            <FilterSelect value={s.type} onChange={(type) => set({ type, sub: "" })} w="36" items={[
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
            {s.sub && <Button size="xs" variant="ghost" onClick={() => set({ sub: "" })}>{folderLabel(s.sub)} ×</Button>}
            {issueFiltered && <Button size="xs" variant="ghost" onClick={() => set(issueScopeDefaults)}>Issue scope {[pri !== "all" ? pri : "", s.cat !== "all" ? s.cat : "", markup !== "all" ? markup : ""].filter(Boolean).join(" · ")} ×</Button>}
            {bandFiltered && <Button size="xs" variant="ghost" onClick={() => set(bandDefaults)}>{[band !== "all" ? `Health: ${band}` : "", worst !== "all" ? `Worst: ${worst}` : ""].filter(Boolean).join(" · ")} ×</Button>}
            {active && <Button size="xs" variant="ghost" onClick={() => set({ ...pageScopeDefaults, ...issueScopeDefaults, ...bandDefaults, q: "", rule: "none", links: "", sort: s.sort === "matches" ? "worst" : s.sort })}>Clear filters</Button>}
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
            <Box minW="640px">
              <Grid templateColumns={cols} gap="3" px="3" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
                <Text>Page</Text>
                <Text>{cat ? CATEGORIES.find((c) => c.id === cat)!.label : "Issues"}</Text>
                {rule && <Text textAlign="right">Matches</Text>}
                <Text>Last changed</Text>
              </Grid>
              {rows.length === 0 ? (
                <Text p="4" textStyle="sm" color="fg.muted">
                  {links && links.from.size === 0 ? `No page in crawl #${s.crawl} links to ${target}.` : "No pages match these filters."}
                </Text>
              ) : pageRows.map(({ p, matches, matching }) => (
                <PageRowView key={p.i} p={p} cols={cols} issues={matching ? matching.issues : issuesCount(p)} critical={matching?.critical ?? criticalCount(p)} matches={rule ? matches : null}
                  href={`/${site}/pages/${p.i}${queryString({ crawl: s.crawl, vs: s.vs, pri, cat: s.cat, markup, auditRule, el, seg, from })}`}
                  changedOn={p.lastChanged != null ? dates.get(p.lastChanged) ?? null : null} since={crawlsFor(site).at(-1)!.startedAt} />
              ))}
            </Box>
          </Box>

          {rows.length > 0 && (
            <TablePagination count={rows.length} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
          )}
        </Flex>
        {coverage.audited < coverage.pages && cat === "performance" && (
          <Text mt="3" textStyle="xs" color="fg.muted">
            This sample includes Lighthouse results for {coverage.audited} of {coverage.pages} pages in this crawl.
          </Text>
        )}
      </Container>
    </Box>
  );
}

function PageRowView({ p, cols, issues, critical, matches, changedOn, since, href }: {
  p: PageView; cols: string; issues: number | null; critical: number; matches: number | null; changedOn: Date | null; since: Date; href: string;
}) {
  const removed = p.change === "removed";
  const change = p.change ? CHANGE_BADGE[p.change] : null;
  return (
    <Grid asChild templateColumns={cols} gap="3" px="3" py="2" alignItems="center" textStyle="xs"
      borderBottomWidth="1px" borderColor="border.muted" _hover={{ bg: "bg.subtle" }} fontVariantNumeric="tabular-nums">
      <RouterLink to={href}>
      <Stack gap="0" minW="0">
        <HStack gap="2" minW="0">
          <Text textStyle="sm" truncate color={removed ? "fg.muted" : undefined} title={p.title}>{p.title}</Text>
          {p.status !== 200 && <Badge size="xs" variant="subtle" flexShrink={0} colorPalette={p.status === 301 ? "blue" : p.status === 404 ? "orange" : "red"}>{p.status}</Badge>}
        </HStack>
        <Text fontFamily="mono" color="fg.muted" truncate title={p.path}>{p.path}</Text>
      </Stack>
      <HStack gap="2">
        {issues == null ? <Text color="fg.subtle">Not audited</Text> : <Text fontWeight="medium" color={issues === 0 ? "fg.subtle" : undefined}>{issues}</Text>}
        {critical > 0 && <Badge size="xs" variant="subtle" colorPalette="red">{critical} critical</Badge>}
      </HStack>
      {matches != null && <Text textAlign="right" fontWeight="medium">{matches}</Text>}
      <HStack gap="2">
        {change && <Badge size="xs" variant="outline" colorPalette={change.color}>{change.label}</Badge>}
        {!removed && <Text color="fg.muted">{changedOn ? fmtDay(changedOn) : `Before ${fmtDay(since)}`}</Text>}
      </HStack>
      </RouterLink>
    </Grid>
  );
}
