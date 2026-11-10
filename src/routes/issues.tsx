// Issues · /[site]/issues: every rule failing in one crawl, across the whole site.
// The Pages page is per page ("what's wrong here"); this is per rule ("what fails most, and on which elements"):
// one row per rule, its pages and elements, and the element pattern most of them are on. "Shared" means the
// markup is identical on every page it's on, so one fix covers them all. Comparing adds New / Fixed since the baseline.
// Nothing here guesses who owns the markup or which CMS field it comes from: the preview shows that.
// Filters live in the URL like the Pages page. Rows open the rule: /[site]/issues/[ruleId].
// PROTOTYPE: data from src/lib/site-issues.ts.
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Box, Button, CloseButton, Container, Flex, Grid, HStack, Heading, Stack, Text } from "@chakra-ui/react";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { FilterSelect } from "@/components/filter-select";
import { CrawlScope } from "@/components/scope-select";
import { useSite } from "@/components/site-context";
import { SCOPES, loadRules, saveRules, type CustomRule } from "@/lib/custom-rules";
import { PRIORITIES, PRIORITY, PRIORITY_COLOR } from "@/lib/priority";
import { folderLabel, inPageScope, issueScopeDefaults, matchesIssueScope, pageScopeDefaults, queryString, useRouteQuery } from "@/lib/route-query";
import { byRule, hitsFor, rulesPrompt, type RuleRow, type Seg } from "@/lib/site-issues";
import { CATEGORIES, defaultScope, lighthouseCoverage, PAGE_TYPES } from "@/lib/site-pages";
import { fmtNum } from "@/lib/types";

type Sort = "priority" | "pages" | "elements" | "new";

const n = (x: number) => x.toLocaleString("en-US");

export default function IssuesPage() {
  return <Suspense><Issues /></Suspense>;
}

function Issues() {
  const site = useSite();
  const [custom, setCustom] = useState<CustomRule[]>([]);
  useEffect(() => {
    const refresh = () => setCustom(loadRules(site));
    refresh();
    window.addEventListener("crawler:rules-changed", refresh);
    return () => window.removeEventListener("crawler:rules-changed", refresh);
  }, [site]);
  const updateCustom = (next: CustomRule[]) => { setCustom(next); saveRules(site, next); };
  const defaults = { ...defaultScope(site), ...pageScopeDefaults, ...issueScopeDefaults, q: "", sort: "priority" };
  const [s, set] = useRouteQuery(site, defaults);

  const a = Number(s.crawl);
  const b = s.vs === "none" ? null : Number(s.vs);
  const comparing = b != null;
  const coverage = lighthouseCoverage(site, a);
  const seg: Seg = comparing ? s.seg as Seg : "all";
  const all = useMemo(() => hitsFor(site, a, b), [site, a, b]);

  // Page type and markup narrow the hits before grouping, so every number follows them
  const { type, year, sub, cat, pri, markup, auditRule, el } = s;
  const hits = useMemo(() => all.filter((h) => inPageScope(h.p, { type, year, sub }) && matchesIssueScope(h, { cat, pri, markup, auditRule, el })),
    [all, type, year, sub, cat, pri, markup, auditRule, el]);

  const ruleFilter = (r: RuleRow) => {
    const q = s.q.trim().toLowerCase();
    return !q || r.rule.title.toLowerCase().includes(q) || r.rule.id.includes(q) || r.patterns.some((x) => x.pattern.toLowerCase().includes(q));
  };
  const segCount = (g: Seg) => byRule(hits, g).filter(ruleFilter).reduce((t, r) => t + r.pages, 0); // issues = rule × page
  const counts = useMemo(() => comparing ? { all: segCount("all"), new: segCount("new"), fixed: segCount("fixed") } : null,
    [hits, comparing, s.q, s.cat, s.pri]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const sort = (s.sort === "new" && !comparing ? "priority" : s.sort) as Sort;
    const by: Record<Sort, (x: RuleRow, y: RuleRow) => number> = {
      priority: (x, y) => x.priority.localeCompare(y.priority) || y.pages - x.pages,
      pages: (x, y) => y.pages - x.pages,
      elements: (x, y) => y.elements - x.elements,
      new: (x, y) => y.added - x.added,
    };
    return byRule(hits, seg).filter(ruleFilter).sort(by[sort]);
  }, [hits, seg, s.q, s.cat, s.pri, s.sort, comparing]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = (["q", "cat", "pri", "markup", "type", "year", "sub", "auditRule", "el"] as const).some((k) => s[k] !== defaults[k]);
  const issues = rows.reduce((t, r) => t + r.pages, 0);
  const scope = { crawl: s.crawl, vs: s.vs, type, year, sub, seg, cat, pri, markup, el };
  const from = `/${site}/issues${queryString({ ...scope, q: s.q, sort: s.sort })}`;
  const hrefOf = (id: string) => `/${site}/issues/${id}${queryString({ ...scope, from })}`;

  const toCsv = () => ["rule,priority,category,pages,elements,top_element,top_element_pages,shared" + (comparing ? ",pages_with_new,pages_with_fixed" : ""),
    ...rows.map((r) => [r.rule.id, r.priority, r.rule.category, r.pages, r.elements, r.patterns[0]?.pattern ?? "", r.patterns[0]?.pages ?? "", r.patterns[0]?.shared ? r.patterns[0].specific ? "partly" : "yes" : "no", ...(comparing ? [r.added, r.fixed] : [])]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

  const showChange = comparing && seg === "all";
  const cols = ["minmax(0, 1fr)", "minmax(0, 260px)", "84px", "84px", ...(showChange ? ["150px"] : [])].join(" ");

  return (
    <Box bg="bg" minH="100vh">
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="7" pb="5">
          <Flex justify="space-between" align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }} gap="4">
            <Heading size="xl" fontWeight="semibold">Issues</Heading>
            <HStack gap="3">
              <CrawlScope crawl={s.crawl} vs={s.vs} onChange={(crawl, vs) => set({ crawl, vs, ...(vs === "none" ? { seg: "all" as Seg } : {}) })} />
            </HStack>
          </Flex>
        </Container>
      </Box>

      <Container maxW="7xl" py="6">
        {custom.length > 0 && (
          <Stack gap="0" mb="4" borderWidth="1px" rounded="l2" textStyle="sm">
            <Text px="3" py="2" textStyle="xs" fontWeight="medium" color="fg.muted" borderBottomWidth="1px" bg="bg.subtle">Custom rules · run on the next crawl</Text>
            {custom.map((r) => (
              <HStack key={r.id} px="3" py="1.5" gap="3" borderBottomWidth="1px" borderColor="border.muted" _last={{ borderBottomWidth: 0 }}>
                <Text fontWeight="medium" color={PRIORITY_COLOR[r.priority]}>{r.priority}</Text>
                <Text flex="1" truncate>{r.name}</Text>
                <Text textStyle="xs" color="fg.muted" truncate maxW="xs">{SCOPES.find((o) => o.value === r.scope)!.label} · {r.when === "found" ? "found" : "missing"}: {r.pattern}</Text>
                <CloseButton size="2xs" aria-label={`Delete ${r.name}`} onClick={() => updateCustom(custom.filter((x) => x.id !== r.id))} />
              </HStack>
            ))}
          </Stack>
        )}
        <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
          <DataToolbar<Seg>
            query={s.q} onQuery={(q) => set({ q })} placeholder="Search rule or element"
            segments={counts ? [
              { value: "all", label: `All in #${s.crawl} (${fmtNum(counts.all)})` },
              { value: "new", label: `New (${fmtNum(counts.new)})` },
              { value: "fixed", label: `Fixed (${fmtNum(counts.fixed)})` },
            ] : undefined}
            value={seg} onValue={(v) => set({ seg: v })}
            count={`${rows.length} rule${rows.length === 1 ? "" : "s"}${comparing ? "" : ` · ${n(issues)} issues`}`}
            copyLabel="Copy as one prompt" onCopy={() => navigator.clipboard.writeText(rulesPrompt(site, a, rows))}
            downloadLabel="Download these rules (.csv)" onDownload={() => downloadText(toCsv(), `issues-${site}-${s.crawl}.csv`, "text/csv")}
          />

          <HStack gap="2" px="2" py="1.5" borderBottomWidth="1px" bg="bg.subtle" wrap="wrap">
            <FilterSelect value={s.pri} onChange={(pri) => set({ pri })} w="28" items={[
              { value: "all", label: "Any priority" },
              ...(s.pri.includes(",") ? [{ value: s.pri, label: s.pri.replaceAll(",", ", ") }] : []),
              ...PRIORITIES.map((p) => ({ value: p, label: p, hint: Object.entries(PRIORITY).find(([, v]) => v === p)![0].replace(/^\w/, (c) => c.toUpperCase()) })),
            ]} />
            <FilterSelect value={s.cat} onChange={(cat) => set({ cat })} w="36" items={[{ value: "all", label: "All categories" }, ...(s.cat.includes(",") ? [{ value: s.cat, label: "Selected categories" }] : []), ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} />
            <FilterSelect value={s.markup} onChange={(markup) => set({ markup })} w="40" items={[
              { value: "all", label: "Any markup" },
              { value: "shared", label: "Shared markup", hint: "Identical on many pages: one fix covers all" },
              { value: "page", label: "Page-specific markup", hint: "Different on each page" },
            ]} />
            <FilterSelect value={s.type} onChange={(type) => set({ type, year: "all", sub: "" })} w="32" items={[
              { value: "all", label: "All page types" }, ...PAGE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.prefix ?? "No match" })),
            ]} />
            {(s.year !== "all" || s.sub) && <Button size="xs" variant="ghost" onClick={() => set({ year: "all", sub: "" })}>{folderLabel(s.sub) || (s.year === "none" ? "No year" : s.year)} ×</Button>}
            {active && <Button size="xs" variant="ghost" onClick={() => set({ ...pageScopeDefaults, ...issueScopeDefaults, q: "", seg })}>Clear filters</Button>}
            <HStack gap="2" ms="auto">
              <Text textStyle="xs" color="fg.muted">Sort</Text>
              <FilterSelect value={s.sort === "new" && !comparing ? "priority" : s.sort} onChange={(v) => set({ sort: v as Sort })} w="36" items={[
                { value: "priority", label: "Priority", hint: "P1 first, then most pages" },
                { value: "pages", label: "Most pages" },
                { value: "elements", label: "Most elements" },
                ...(comparing ? [{ value: "new", label: "Most new", hint: "Pages with new elements" }] : []),
              ]} />
            </HStack>
          </HStack>

          <Box overflowX="auto">
            <Box minW="720px">
              <Grid templateColumns={cols} gap="4" px="3" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
                <Text>Issue</Text>
                <Text>Most common element</Text>
                <Text textAlign="right">Pages</Text>
                <Text textAlign="right">Elements</Text>
                {showChange && <Text>Since #{s.vs}</Text>}
              </Grid>
              {rows.length === 0 ? (
                <Text p="4" textStyle="sm" color="fg.muted">
                  {seg === "new" ? `Nothing new since #${s.vs}.` : seg === "fixed" ? `Nothing fixed since #${s.vs}.` : "No issues match these filters."}
                </Text>
              ) : rows.map((r) => <RuleRowView key={r.rule.id} r={r} cols={cols} showChange={showChange} href={hrefOf(r.rule.id)} />)}
            </Box>
          </Box>
        </Flex>
        {coverage.audited < coverage.pages && (s.cat === "all" || s.cat.split(",").includes("performance")) && (
          <Text mt="3" textStyle="xs" color="fg.muted">
            This sample includes Lighthouse results for {coverage.audited} of {coverage.pages} pages in this crawl.
          </Text>
        )}
      </Container>
    </Box>
  );
}

function RuleRowView({ r, cols, showChange, href }: { r: RuleRow; cols: string; showChange: boolean; href: string }) {
  const top = r.patterns[0];
  const share = Math.round((top.pages / r.pages) * 100);
  const cat = CATEGORIES.find((c) => c.id === r.rule.category)!.label;
  return (
    <Grid asChild templateColumns={cols} gap="4" px="3" py="2.5" alignItems="center" textStyle="xs"
      borderBottomWidth="1px" borderColor="border.muted" _hover={{ bg: "bg.subtle" }} fontVariantNumeric="tabular-nums">
      <RouterLink to={href}>
        <HStack gap="3" minW="0" align="start">
          <Text fontWeight="medium" color={PRIORITY_COLOR[r.priority]} w="5" flexShrink={0} lineHeight="1.25rem">{r.priority}</Text>
          <Stack gap="0" minW="0">
            <Text textStyle="sm" truncate title={r.rule.title}>{r.rule.title}</Text>
            <Text color="fg.muted" truncate>{cat} · {r.rule.id}{r.rule.criterion ? ` · WCAG ${r.rule.criterion.split(" ")[0]}` : ""}</Text>
          </Stack>
        </HStack>
        <Stack gap="0" minW="0">
          <Text fontFamily="mono" truncate title={top.pattern}>{top.pattern}</Text>
          <Text color="fg.muted" truncate>
            {top.shared ? top.specific ? "Partly shared markup" : "Shared markup" : "Page-specific"}{share < 100 ? ` · ${share}% of pages` : ""}{r.patterns.length > 1 ? ` · +${r.patterns.length - 1} more` : ""}
          </Text>
        </Stack>
        <Text textAlign="right" fontWeight="medium">{n(r.pages)}</Text>
        <Text textAlign="right" color="fg.muted">{n(r.elements)}</Text>
        {showChange && (
          <HStack gap="3" whiteSpace="nowrap">
            {r.added > 0 && <Text color="red.fg">+{n(r.added)} new</Text>}
            {r.fixed > 0 && <Text color="green.fg">{n(r.fixed)} fixed</Text>}
            {!r.added && !r.fixed && <Text color="fg.subtle">No change</Text>}
          </HStack>
        )}
      </RouterLink>
    </Grid>
  );
}
