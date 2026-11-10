// One rule across the site · /[site]/issues/[ruleId]
//   Header: the rule, and a one-line summary (element, pages, instances, shared or page-specific markup).
//   Pages: every page this rule fails on, linking to the page detail with the issue selected.
//   Side: why it matters, how to fix, references, and handoff (prompt, API request).
// State in the URL: ?crawl=&vs=&el=&type=&seg=&q=
import { Suspense, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import { useParams } from "react-router";
import { NotFound } from "@/routes/not-found";
import { Box, Button, Container, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { LuCheck, LuCopy, LuTerminal } from "react-icons/lu";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { FilterSelect } from "@/components/filter-select";
import { CrawlScope } from "@/components/scope-select";
import { useSite } from "@/components/site-context";
import { TablePagination } from "@/components/table-pagination";
import { BackLink, RuleGuide, RuleMeta, RuleTitle } from "@/components/rule-ui";
import { RULE_CATALOG } from "@/lib/page-issues";
import { folderLabel, inPageScope, issueScopeDefaults, matchesIssueScope, pageScopeDefaults, queryString, returnPath, useRouteQuery } from "@/lib/route-query";
import { byRule, countOf, elementOf, hitsFor, rulesPrompt, type Seg } from "@/lib/site-issues";
import { defaultScope, lighthouseCoverage, PAGE_TYPES, type PageView } from "@/lib/site-pages";
import { fmtNum } from "@/lib/types";

const PAGE_SIZE = 50;
const n = (x: number) => x.toLocaleString("en-US");

export default function RulePage() {
  const { ruleId = "" } = useParams();
  if (!Object.hasOwn(RULE_CATALOG, ruleId)) return <NotFound />;
  return <Suspense><RuleView key={ruleId} /></Suspense>;
}

function RuleView() {
  const site = useSite();
  const { ruleId = "" } = useParams();
  const rule = RULE_CATALOG[ruleId]; // RulePage only renders this for a known rule
  const defaults = { ...defaultScope(site), ...pageScopeDefaults, ...issueScopeDefaults, q: "", from: "" };
  const [s, set, query] = useRouteQuery(site, defaults);
  const paginationKey = `${site}:${query}`;
  const [pagination, setPagination] = useState({ key: paginationKey, page: 1 });
  const page = pagination.key === paginationKey ? pagination.page : 1;
  const setPage = (next: number) => setPagination({ key: paginationKey, page: next });

  const a = Number(s.crawl);
  const b = s.vs === "none" ? null : Number(s.vs);
  const comparing = b != null;
  const coverage = lighthouseCoverage(site, a);
  const seg = (comparing ? s.seg : "all") as Seg;

  // This rule's hits, narrowed by page type (the element pattern is applied to the page list, not to "Elements")
  const { type, year, sub, pri, cat, markup, el } = s;
  const hits = useMemo(() => {
    const q = s.q.trim().toLowerCase();
    return hitsFor(site, a, b).filter((h) => inPageScope(h.p, { type, year, sub }) &&
      matchesIssueScope(h, { auditRule: ruleId, pri, cat, markup, el: "all" }) &&
      (!q || h.p.path.toLowerCase().includes(q) || h.p.title.toLowerCase().includes(q)));
  }, [site, a, b, ruleId, type, year, sub, pri, cat, markup, s.q]);
  const scopedHits = useMemo(() => el === "all" ? hits : hits.filter((h) => h.pattern === el), [hits, el]);
  const row = useMemo(() => byRule(scopedHits, seg)[0] ?? null, [scopedHits, seg]);
  const patterns = useMemo(() => byRule(hits, seg)[0]?.patterns ?? [], [hits, seg]);
  const counts = useMemo(() => {
    const pages = (g: Seg) => new Set(scopedHits.filter((h) => countOf(h, g) > 0).map((h) => h.p.i)).size;
    return { all: pages("all"), new: pages("new"), fixed: pages("fixed") };
  }, [scopedHits]);

  // One row per page: its elements of this rule (in the segment), and where they come from
  const pages = useMemo(() => {
    const by = new Map<number, { p: PageView; elements: number; added: number; fixed: number; pats: string[]; k: number }>();
    for (const h of scopedHits) {
      const c = countOf(h, seg);
      if (!c) continue;
      const k = elementOf(h, seg);
      const r = by.get(h.p.i) ?? { p: h.p, elements: 0, added: 0, fixed: 0, pats: [], k };
      r.elements += c; r.added += h.added; r.fixed += h.fixed; r.pats.push(h.pattern); r.k = Math.min(r.k, k);
      by.set(h.p.i, r);
    }
    return [...by.values()].sort((x, y) => y.elements - x.elements || x.p.path.localeCompare(y.p.path));
  }, [scopedHits, seg]);
  const pageRows = pages.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const multi = patterns.length > 1; // with one element pattern, a column would say nothing
  const tpl = multi ? "minmax(0, 1fr) minmax(0, 220px) 80px" : "minmax(0, 1fr) 80px";
  const markupLabel = !row ? "" : row.sharedPages === 0 ? "page-specific" : row.patterns.some((pattern) => pattern.specific) ? "partly shared markup" : "shared markup";
  const scope = { crawl: s.crawl, vs: s.vs, type, year, sub, pri, cat, markup, el, seg };
  const back = returnPath(s.from, site, `/${site}/issues${queryString(scope)}`);
  const from = `/${site}/issues/${ruleId}${queryString({ ...scope, q: s.q, from: s.from })}`;
  const pageHref = (r: (typeof pages)[number]) =>
    `/${site}/pages/${r.p.i}${queryString({ crawl: s.crawl, vs: s.vs, auditRule: ruleId, pri, cat, markup, el, seg, issue: r.k + 1, from })}`;
  const api = () => `curl -s "${window.location.origin}/api/issues?crawl=${s.crawl}&rule=${ruleId}${s.el !== "all" ? `&selector=${encodeURIComponent(s.el)}` : ""}${s.type !== "all" ? `&type=${s.type}` : ""}"`;
  const toCsv = () => ["url,title,elements,selectors" + (comparing ? ",new,fixed" : ""),
    ...pages.map((r) => [r.p.path, r.p.title, r.elements, r.pats.join("; "), ...(comparing ? [r.added, r.fixed] : [])]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

  return (
    <Box bg="bg" minH="100vh">
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="5" pb="5">
          <BackLink href={back}>Issues</BackLink>
          <Flex justify="space-between" align={{ base: "start", md: "end" }} direction={{ base: "column", md: "row" }} gap="4">
            <Stack gap="1" minW="0">
              <RuleTitle rule={rule} size="lg" />
              <RuleMeta rule={rule}>
                {row && <Text truncate>· {n(row.pages)} pages · {n(row.elements)} elements · {markupLabel}</Text>}
              </RuleMeta>
            </Stack>
            <CrawlScope crawl={s.crawl} vs={s.vs} onChange={(crawl, vs) => set({ crawl, vs, ...(vs === "none" ? { seg: "all" as Seg } : {}) })} />
          </Flex>
        </Container>
      </Box>

      <Container maxW="7xl" py="6">
        <Grid templateColumns={{ base: "1fr", lg: "minmax(0, 1fr) 300px" }} gap="8" alignItems="start">
          <Stack gap="6" minW="0">
            {/* Every page it fails on */}
            <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
              <DataToolbar<Seg>
                query={s.q} onQuery={(q) => set({ q })} placeholder="Search URL or title"
                segments={comparing ? [
                  { value: "all", label: `All in #${s.crawl} (${fmtNum(counts.all)})` },
                  { value: "new", label: `New (${fmtNum(counts.new)})` },
                  { value: "fixed", label: `Fixed (${fmtNum(counts.fixed)})` },
                ] : undefined}
                value={seg} onValue={(v) => set({ seg: v })}
                count={`${n(pages.length)} page${pages.length === 1 ? "" : "s"}`}
                copyLabel="Copy URLs" onCopy={() => navigator.clipboard.writeText(pages.map((r) => r.p.path).join("\n"))}
                downloadLabel="Download these pages (.csv)" onDownload={() => downloadText(toCsv(), `${ruleId}-${site}-${s.crawl}.csv`, "text/csv")}
              />
              <HStack gap="2" px="2" py="1.5" borderBottomWidth="1px" bg="bg.subtle" wrap="wrap">
                <FilterSelect value={s.type} onChange={(type) => set({ type, year: "all", sub: "" })} w="36" items={[
                  { value: "all", label: "All page types" }, ...PAGE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.prefix ?? "No match" })),
                ]} />
                {(multi || el !== "all") && (
                  <FilterSelect value={s.el} onChange={(el) => set({ el })} w="64" items={[
                    { value: "all", label: "All elements" },
                    ...patterns.map((x) => ({ value: x.pattern, label: x.pattern, mono: true, hint: `${n(x.pages)} pages · ${x.shared ? x.specific ? "partly shared markup" : "shared markup" : "page-specific"}` })),
                    ...(el !== "all" && !patterns.some((x) => x.pattern === el) ? [{ value: el, label: el, mono: true }] : []),
                  ]} />
                )}
                {(year !== "all" || sub) && <Button size="xs" variant="ghost" onClick={() => set({ year: "all", sub: "" })}>{folderLabel(sub) || (year === "none" ? "No year" : year)} ×</Button>}
                {markup !== "all" && <Button size="xs" variant="ghost" onClick={() => set({ markup: "all" })}>{markup === "shared" ? "Shared markup" : "Page-specific markup"} ×</Button>}
              </HStack>
              <Box overflowX="auto">
                <Box minW="560px">
                  <Grid templateColumns={tpl} gap="4" px="3" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
                    <Text>Page</Text>{multi && <Text>Element</Text>}<Text textAlign="right">{seg === "fixed" ? "Fixed" : seg === "new" ? "New" : "Elements"}</Text>
                  </Grid>
                  {pages.length === 0 ? <Text p="4" textStyle="sm" color="fg.muted">No pages match.</Text> : pageRows.map((r) => (
                    <Grid key={r.p.i} asChild templateColumns={tpl} gap="4" px="3" py="2" alignItems="center" textStyle="xs"
                      borderBottomWidth="1px" borderColor="border.muted" _hover={{ bg: "bg.subtle" }} fontVariantNumeric="tabular-nums">
                      <RouterLink to={pageHref(r)}>
                        <Stack gap="0" minW="0">
                          <HStack gap="2" minW="0">
                            <Text textStyle="sm" truncate title={r.p.title}>{r.p.title}</Text>
                            {seg === "all" && r.added > 0 && <Text color="red.fg" flexShrink={0}>New</Text>}
                          </HStack>
                          <Text fontFamily="mono" color="fg.muted" truncate>{r.p.path}</Text>
                        </Stack>
                        {multi && (
                          <Text color="fg.muted" fontFamily="mono" truncate title={r.pats.join(", ")}>
                            {r.pats[0]}{r.pats.length > 1 ? ` +${r.pats.length - 1}` : ""}
                          </Text>
                        )}
                        <Text textAlign="right" fontWeight="medium">{r.elements}</Text>
                      </RouterLink>
                    </Grid>
                  ))}
                </Box>
              </Box>
              {pages.length > 0 && <TablePagination count={pages.length} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />}
            </Flex>
            {rule.category === "performance" && coverage.audited < coverage.pages && (
              <Text textStyle="xs" color="fg.muted">This sample includes Lighthouse results for {coverage.audited} of {coverage.pages} pages in this crawl.</Text>
            )}
          </Stack>

          {/* About the rule, and handing it off */}
          <Stack gap="5" position={{ lg: "sticky" }} top={{ lg: "calc(var(--sticky-top, 3.5rem) + 1.5rem)" }}>
            <RuleGuide rule={rule} actions={
              <Stack gap="2">
                <CopyButton icon={<LuCopy />} label="Copy as prompt" text={() => row ? rulesPrompt(site, a, [row]) : ""} />
                <CopyButton icon={<LuTerminal />} label="Copy API request" text={api} />
              </Stack>
            } />
          </Stack>
        </Grid>
      </Container>
    </Box>
  );
}

function CopyButton({ icon, label, text }: { icon: React.ReactNode; label: string; text: () => string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="outline" justifyContent="flex-start" onClick={async () => {
      await navigator.clipboard.writeText(text()); setDone(true); setTimeout(() => setDone(false), 1200);
    }}>{done ? <LuCheck /> : icon}{done ? "Copied" : label}</Button>
  );
}

