// One rule across the site · /[site]/issues/[ruleId]
//   Header: the rule, and a one-line summary (element, pages, instances, shared or page-specific markup).
//   Pages: every page this rule fails on, linking to the page detail with the issue selected.
//   Side: why it matters, how to fix, references, and handoff (prompt, API request).
// State in the URL: ?crawl=&vs=&el=&type=&seg=&q=
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import { useParams, useSearchParams } from "react-router";
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
import { byRule, countOf, hitsFor, rulesPrompt, type Seg } from "@/lib/site-issues";
import { defaultScope, LH_SAMPLE, PAGE_TYPES, fullLighthouse, type PageView } from "@/lib/site-pages";
import { fmtNum } from "@/lib/types";

type State = { crawl: string; vs: string; q: string; el: string; type: string; seg: Seg };
const PAGE_SIZE = 50;
const n = (x: number) => x.toLocaleString("en-US");

export default function RulePage() {
  const { ruleId = "" } = useParams();
  if (!RULE_CATALOG[ruleId]) return <NotFound />;
  return <Suspense><RuleView key={ruleId} /></Suspense>;
}

function RuleView() {
  const site = useSite();
  const { ruleId = "" } = useParams();
  const rule = RULE_CATALOG[ruleId]; // RulePage only renders this for a known rule
  const sp = useSearchParams()[0];

  const defaults: State = { ...defaultScope(site), q: "", el: "all", type: "all", seg: "all" };
  const [s, setS] = useState<State>(() => {
    const init = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof State)[]) { const v = sp.get(k); if (v != null) (init as Record<string, string>)[k] = v; }
    return init;
  });
  const [page, setPage] = useState(1);
  const set = (patch: Partial<State>) => { setS((x) => ({ ...x, ...patch })); setPage(1); };
  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of Object.keys(s) as (keyof State)[]) if (s[k] !== defaults[k]) p.set(k, s[k]);
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = Number(s.crawl);
  const b = s.vs === "none" ? null : Number(s.vs);
  const comparing = b != null;
  const seg: Seg = comparing ? s.seg : "all";

  // This rule's hits, narrowed by page type (the element pattern is applied to the page list, not to "Elements")
  const hits = useMemo(() => hitsFor(site, a, b).filter((h) => h.rule === ruleId && (s.type === "all" || h.p.type === s.type)), [site, a, b, ruleId, s.type]);
  const row = useMemo(() => byRule(hits, seg)[0] ?? null, [hits, seg]);
  const counts = useMemo(() => {
    const pages = (g: Seg) => new Set(hits.filter((h) => countOf(h, g) > 0 && (s.el === "all" || h.pattern === s.el)).map((h) => h.p.i)).size;
    return { all: pages("all"), new: pages("new"), fixed: pages("fixed") };
  }, [hits, s.el]);

  // One row per page: its elements of this rule (in the segment), and where they come from
  const pages = useMemo(() => {
    const q = s.q.trim().toLowerCase();
    const by = new Map<number, { p: PageView; elements: number; added: number; fixed: number; pats: string[]; k: number }>();
    for (const h of hits) {
      const c = countOf(h, seg);
      if (!c || (s.el !== "all" && h.pattern !== s.el)) continue;
      if (q && !h.p.path.toLowerCase().includes(q) && !h.p.title.toLowerCase().includes(q)) continue;
      const r = by.get(h.p.i) ?? { p: h.p, elements: 0, added: 0, fixed: 0, pats: [], k: h.k };
      r.elements += c; r.added += h.added; r.fixed += h.fixed; r.pats.push(h.pattern); r.k = Math.min(r.k, h.k);
      by.set(h.p.i, r);
    }
    return [...by.values()].sort((x, y) => y.elements - x.elements || x.p.path.localeCompare(y.p.path));
  }, [hits, seg, s.el, s.q]);
  const pageRows = pages.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const multi = (row?.patterns.length ?? 0) > 1; // with one element pattern, a filter and a column would say nothing
  const tpl = multi ? "minmax(0, 1fr) minmax(0, 220px) 80px" : "minmax(0, 1fr) 80px";
  const markup = !row ? "" : row.sharedPages === row.pages ? "shared markup" : row.sharedPages === 0 ? "page-specific" : "partly shared markup";
  const backQs = ["crawl", "vs", "type", "seg"].map((k) => s[k as keyof State] !== defaults[k as keyof State] ? `${k}=${s[k as keyof State]}` : "").filter(Boolean).join("&");
  const pageHref = (r: (typeof pages)[number]) =>
    `/${site}/pages/${r.p.i}?crawl=${s.crawl}${comparing ? `&vs=${s.vs}` : ""}&issue=${r.k + 1}${seg === "fixed" ? "&seg=fixed" : ""}`;
  const api = () => `curl -s "${window.location.origin}/api/issues?crawl=${s.crawl}&rule=${ruleId}${s.el !== "all" ? `&selector=${encodeURIComponent(s.el)}` : ""}${s.type !== "all" ? `&type=${s.type}` : ""}"`;
  const toCsv = () => ["url,title,elements,selectors" + (comparing ? ",new,fixed" : ""),
    ...pages.map((r) => [r.p.path, r.p.title, r.elements, r.pats.join("; "), ...(comparing ? [r.added, r.fixed] : [])]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

  return (
    <Box bg="bg" minH="100vh">
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="5" pb="5">
          <BackLink href={`/${site}/issues${backQs ? `?${backQs}` : ""}`}>Issues</BackLink>
          <Flex justify="space-between" align={{ base: "start", md: "end" }} direction={{ base: "column", md: "row" }} gap="4">
            <Stack gap="1" minW="0">
              <RuleTitle rule={rule} size="lg" />
              <RuleMeta rule={rule}>
                {row && <Text truncate>· {n(row.pages)} pages · {n(row.elements)} elements · {markup}</Text>}
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
                <FilterSelect value={s.type} onChange={(type) => set({ type })} w="36" items={[
                  { value: "all", label: "All page types" }, ...PAGE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.prefix ?? "No match" })),
                ]} />
                {multi && row && (
                  <FilterSelect value={s.el} onChange={(el) => set({ el })} w="64" items={[
                    { value: "all", label: "All elements" },
                    ...row.patterns.map((x) => ({ value: x.pattern, label: x.pattern, mono: true, hint: `${n(x.pages)} pages · ${x.shared ? "shared markup" : "page-specific"}` })),
                  ]} />
                )}
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
            {rule.category === "performance" && !fullLighthouse(a) && (
              <Text textStyle="xs" color="fg.muted">Lighthouse audited a sample of {LH_SAMPLE} pages in this crawl. Every 10th crawl audits the whole site.</Text>
            )}
          </Stack>

          {/* About the rule, and handing it off */}
          <Stack gap="5" position={{ lg: "sticky" }} top={{ lg: "calc(var(--sticky-top, 3.5rem) + 1.5rem)" }}>
            <RuleGuide rule={rule} actions={
              <Stack gap="2">
                <CopyButton icon={<LuCopy />} label="Copy as prompt" text={() => row ? rulesPrompt(site, a, [s.el === "all" ? row : { ...row, patterns: row.patterns.filter((x) => x.pattern === s.el) }]) : ""} />
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

