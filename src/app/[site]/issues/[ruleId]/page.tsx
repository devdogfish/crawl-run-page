"use client";

// One rule across the site · /[site]/issues/[ruleId]
//   Elements: each element pattern (selector) the rule fails on, with the share of pages it accounts for,
//     marked "Shared markup" when it's identical on every page it's on. Click one to narrow the pages below to it.
//   Pages: every page this rule fails on, linking to the page detail with the issue selected.
//   Side: why it matters, how to fix, references, and handoff (prompt, API request).
// State in the URL: ?crawl=&vs=&el=&type=&seg=&q=
import { Suspense, useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { Badge, Box, Breadcrumb, Button, Container, Flex, Grid, HStack, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { LuCheck, LuCopy, LuExternalLink, LuTerminal } from "react-icons/lu";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { FilterSelect } from "@/components/filter-select";
import { CrawlScope } from "@/components/scope-select";
import { useSite } from "@/components/site-context";
import { TablePagination } from "@/components/table-pagination";
import { RULE_CATALOG, SEVERITIES } from "@/lib/page-issues";
import { PRIORITY, PRIORITY_COLOR } from "@/lib/priority";
import { byRule, countOf, hitsFor, rulesPrompt, type Seg } from "@/lib/site-issues";
import { CATEGORIES, LH_SAMPLE, PAGE_TYPES, crawlChoices, fullLighthouse, type PageView } from "@/lib/site-pages";
import { fmtNum } from "@/lib/types";

type State = { crawl: string; vs: string; q: string; el: string; type: string; seg: Seg };
const PAGE_SIZE = 50;
const n = (x: number) => x.toLocaleString("en-US");

export default function RulePage() {
  return <Suspense><RuleView /></Suspense>;
}

function RuleView() {
  const site = useSite();
  const { ruleId } = useParams<{ ruleId: string }>();
  const rule = RULE_CATALOG[ruleId];
  if (!rule) notFound();
  const crawls = useMemo(() => crawlChoices(site), [site]);
  const sp = useSearchParams();

  const defaults: State = { crawl: crawls[0].id, vs: crawls[1]?.id ?? "none", q: "", el: "all", type: "all", seg: "all" };
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
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
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

  const prio = PRIORITY[rule.severity];
  const sev = SEVERITIES.find((x) => x.id === rule.severity)!.label;
  const cat = CATEGORIES.find((c) => c.id === rule.category)!.label;
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
          <Breadcrumb.Root size="sm" mb="2">
            <Breadcrumb.List>
              <Breadcrumb.Item><Breadcrumb.Link asChild><NextLink href={`/${site}/issues${backQs ? `?${backQs}` : ""}`}>Issues</NextLink></Breadcrumb.Link></Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item><Breadcrumb.CurrentLink fontFamily="mono">{rule.id}</Breadcrumb.CurrentLink></Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>
          <Flex justify="space-between" align={{ base: "start", md: "end" }} direction={{ base: "column", md: "row" }} gap="4">
            <Stack gap="1" minW="0">
              <Text textStyle="xs" color="fg.muted">
                <Text as="span" fontWeight="medium" color={PRIORITY_COLOR[prio]}>{prio}</Text> · {sev} · {cat}{rule.criterion ? ` · WCAG ${rule.criterion}` : ""} · {rule.source}
              </Text>
              <Heading size="lg" fontWeight="semibold">{rule.title}</Heading>
            </Stack>
            <CrawlScope crawl={s.crawl} vs={s.vs} onChange={(crawl, vs) => set({ crawl, vs, ...(vs === "none" ? { seg: "all" as Seg } : {}) })} />
          </Flex>
        </Container>
      </Box>

      <Container maxW="7xl" py="6">
        <Grid templateColumns={{ base: "1fr", lg: "minmax(0, 1fr) 300px" }} gap="8" alignItems="start">
          <Stack gap="6" minW="0">
            {/* Which elements it fails on, most pages first. Shared markup: one fix covers every page in the row. */}
            <Stack gap="2">
              <HStack>
                <Text textStyle="sm" fontWeight="medium">Elements</Text>
                {s.el !== "all" && <Button size="2xs" variant="ghost" ms="auto" onClick={() => set({ el: "all" })}>Show all elements</Button>}
              </HStack>
              <Box borderWidth="1px" rounded="l2" overflow="hidden">
                {!row ? (
                  <Text p="3" textStyle="sm" color="fg.muted">{seg === "new" ? `Nothing new since #${s.vs}.` : seg === "fixed" ? `Nothing fixed since #${s.vs}.` : "This rule doesn't fail on any page in this crawl."}</Text>
                ) : row.patterns.map((x) => {
                  const on = s.el === x.pattern;
                  const share = x.pages / row.pages;
                  return (
                    <Grid key={x.pattern} as="button" w="full" textAlign="start" templateColumns="minmax(0, 1fr) 160px 110px 110px" gap="4" px="3" py="2.5" whiteSpace="nowrap" alignItems="center"
                      textStyle="xs" fontVariantNumeric="tabular-nums" borderBottomWidth="1px" borderColor="border.muted" _last={{ borderBottomWidth: 0 }}
                      bg={on ? "bg.muted" : undefined} _hover={{ bg: on ? "bg.muted" : "bg.subtle" }} aria-pressed={on}
                      opacity={s.el !== "all" && !on ? 0.6 : 1} onClick={() => set({ el: on ? "all" : x.pattern })}>
                      <Stack gap="0" minW="0">
                        <Text textStyle="sm" fontFamily="mono" truncate title={x.pattern}>{x.pattern}</Text>
                        <Text color="fg.muted">{x.shared ? "Shared markup: identical on these pages" : "Page-specific: differs per page"}</Text>
                      </Stack>
                      <HStack gap="2">
                        <Box flex="1" h="1.5" rounded="full" bg="bg.emphasized" overflow="hidden"><Box h="full" w={`${Math.max(2, share * 100)}%`} bg="colorPalette.solid" /></Box>
                        <Text w="10" textAlign="right" color="fg.muted">{Math.round(share * 100)}%</Text>
                      </HStack>
                      <Text textAlign="right" fontWeight="medium">{n(x.pages)}<Text as="span" color="fg.muted" fontWeight="normal"> pages</Text></Text>
                      <Text textAlign="right" color="fg.muted">{n(x.elements)} elements</Text>
                    </Grid>
                  );
                })}
              </Box>
            </Stack>

            {/* Every page it fails on */}
            <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
              <DataToolbar<Seg>
                query={s.q} onQuery={(q) => set({ q })} placeholder="Search URL or title"
                segments={comparing ? [
                  { value: "all", label: `All in #${s.crawl} ${fmtNum(counts.all)}` },
                  { value: "new", label: `New ${fmtNum(counts.new)}` },
                  { value: "fixed", label: `Fixed ${fmtNum(counts.fixed)}` },
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
                {s.el !== "all" && (
                  <Badge size="sm" variant="outline" fontFamily="mono" cursor="pointer" onClick={() => set({ el: "all" })} title="Show all elements">
                    {s.el} ×
                  </Badge>
                )}
              </HStack>
              <Box overflowX="auto">
                <Box minW="560px">
                  <Grid templateColumns="minmax(0, 1fr) minmax(0, 220px) 80px" gap="4" px="3" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
                    <Text>Page</Text><Text>Element</Text><Text textAlign="right">{seg === "fixed" ? "Fixed" : seg === "new" ? "New" : "Elements"}</Text>
                  </Grid>
                  {pages.length === 0 ? <Text p="4" textStyle="sm" color="fg.muted">No pages match.</Text> : pageRows.map((r) => (
                    <Grid key={r.p.i} asChild templateColumns="minmax(0, 1fr) minmax(0, 220px) 80px" gap="4" px="3" py="2" alignItems="center" textStyle="xs"
                      borderBottomWidth="1px" borderColor="border.muted" _hover={{ bg: "bg.subtle" }} fontVariantNumeric="tabular-nums">
                      <NextLink href={pageHref(r)}>
                        <Stack gap="0" minW="0">
                          <HStack gap="2" minW="0">
                            <Text textStyle="sm" truncate title={r.p.title}>{r.p.title}</Text>
                            {seg === "all" && r.added > 0 && <Text color="red.fg" flexShrink={0}>New</Text>}
                          </HStack>
                          <Text fontFamily="mono" color="fg.muted" truncate>{r.p.path}</Text>
                        </Stack>
                        <Text color="fg.muted" fontFamily="mono" truncate title={r.pats.join(", ")}>
                          {r.pats[0]}{r.pats.length > 1 ? ` +${r.pats.length - 1}` : ""}
                        </Text>
                        <Text textAlign="right" fontWeight="medium">{r.elements}</Text>
                      </NextLink>
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
            <Stack gap="1"><Text textStyle="xs" fontWeight="medium" color="fg.muted">Why it matters</Text><Text textStyle="sm">{rule.why}</Text></Stack>
            <Stack gap="1"><Text textStyle="xs" fontWeight="medium" color="fg.muted">How to fix</Text><Text textStyle="sm">{rule.howToFix}</Text></Stack>
            <Stack gap="1">
              <Text textStyle="xs" fontWeight="medium" color="fg.muted">References</Text>
              {rule.refs.map((x) => (
                <Link key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" textStyle="sm" colorPalette="brand">{x.label} <LuExternalLink /></Link>
              ))}
            </Stack>
            <Stack gap="2" pt="1">
              <CopyButton icon={<LuCopy />} label="Copy as prompt" text={() => row ? rulesPrompt(site, a, [s.el === "all" ? row : { ...row, patterns: row.patterns.filter((x) => x.pattern === s.el) }]) : ""} />
              <CopyButton icon={<LuTerminal />} label="Copy API request" text={api} />
            </Stack>
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

