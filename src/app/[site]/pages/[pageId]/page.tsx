"use client";

// Page detail · /[site]/pages/[pageId]?crawl=811&vs=810
// For a developer fixing one page. Opens on the gist (one summary line) and the issue list; everything
// deeper is one click away.
//   Issues  → rules on the left (grouped by element pattern, shared vs only this page), the selected issue on
//             the right: evidence (cropped screenshot + HTML), why, how to fix, references, a fix as a small diff.
//   Preview → the page with issue boxes. Screenshot (what we store today) or Live render (stored HTML: any
//             viewport, hover inspect, tab order / headings / landmarks / alt text layers).
//   Source  → the rendered HTML, issue lines marked.
// The assistant on the right can drive all of this (filters, selection, preview layers, fixes).
//
// PROTOTYPE: data from src/lib/page-issues.ts; assistant answers are scripted from that data.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  Badge, Box, Breadcrumb, Button, Code, Container, EmptyState, Flex, Grid, HStack, Heading, IconButton, Link, SegmentGroup, Span, Stack, Switch, Tabs, Text,
} from "@chakra-ui/react";
import { LuChevronLeft, LuChevronRight, LuCopy, LuExternalLink, LuEye, LuFileQuestion, LuSparkles, LuWand } from "react-icons/lu";

import { AiPanel, type AiReply } from "@/components/ai-panel";
import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { FilterSelect } from "@/components/filter-select";
import { PagePreview, type Layer } from "@/components/page-preview";
import { useSite } from "@/components/site-context";
import { Tooltip } from "@/components/ui/tooltip";
import { RULE_CATALOG, SEVERITIES, issuePrompt, pageIssues, sevRank, sourceLines, type Instance } from "@/lib/page-issues";
import { CATEGORIES, crawlChoices, pageView, siteSize, typeLabel } from "@/lib/site-pages";
import { SITES, type SiteId } from "@/lib/sites";

type Seg = "all" | "new" | "fixed";
type Filters = { q: string; seg: Seg; cat: string; sev: string; onlyHere: boolean };
const NO_FILTERS: Filters = { q: "", seg: "all", cat: "all", sev: "all", onlyHere: false };
const SEV = Object.fromEntries(SEVERITIES.map((s) => [s.id, s]));
const VIEWPORTS = [{ value: "1280", label: "Desktop" }, { value: "768", label: "Tablet" }, { value: "390", label: "Mobile" }];
const LAYERS: { id: Layer; label: string }[] = [
  { id: "issues", label: "Issues" }, { id: "tab", label: "Tab order" }, { id: "headings", label: "Headings" }, { id: "landmarks", label: "Landmarks" }, { id: "alt", label: "Alt text" },
];

export default function PageDetailRoute() {
  return <Suspense><PageDetail /></Suspense>;
}

function PageDetail() {
  const site = useSite();
  const { pageId } = useParams<{ pageId: string }>();
  const sp = useSearchParams();
  const crawls = useMemo(() => crawlChoices(site), [site]);
  const a = Number(sp.get("crawl") ?? crawls[0].id);
  const b = sp.get("vs") ? Number(sp.get("vs")) : null;
  const p = useMemo(() => pageView(site, Number(pageId), a, b), [site, pageId, a, b]);

  if (!p) {
    return (
      <Container maxW="7xl" pt="16">
        <EmptyState.Root><EmptyState.Content>
          <EmptyState.Indicator><LuFileQuestion /></EmptyState.Indicator>
          <EmptyState.Title>This page isn&apos;t in crawl #{a}</EmptyState.Title>
          <EmptyState.Description><Link asChild><NextLink href={`/${site}/pages`}>Back to Pages</NextLink></Link></EmptyState.Description>
        </EmptyState.Content></EmptyState.Root>
      </Container>
    );
  }
  return <Detail key={`${pageId}-${a}-${b}`} p={p} a={a} b={b} site={site} />;
}

function Detail({ p, a, b, site }: { p: NonNullable<ReturnType<typeof pageView>>; a: number; b: number | null; site: SiteId }) {
  const { instances, html } = useMemo(() => pageIssues(p, a, b, siteSize(site)), [p, a, b, site]);
  const [tab, setTab] = useState<"issues" | "preview" | "source">("issues");
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<number | null>(null);
  const [highlightRule, setHighlightRule] = useState<string | null>(null);
  const [fixes, setFixes] = useState<Set<number>>(new Set());
  const [ai, setAi] = useState(false);
  const [ask, setAsk] = useState<{ q: string; n: number } | null>(null);
  const [mode, setMode] = useState<"screenshot" | "live">("screenshot");
  const [viewport, setViewport] = useState(1280);
  const [layers, setLayers] = useState<Layer[]>(["issues"]);
  const comparing = b != null;

  // Filtering, then grouping: rule → element pattern → instances
  const visible = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return instances.filter((it) => {
      const r = RULE_CATALOG[it.rule];
      return (f.seg === "all" ? it.status !== "fixed" : it.status === f.seg) &&
        (f.cat === "all" || r.category === f.cat) && (f.sev === "all" || r.severity === f.sev) && (!f.onlyHere || it.shared == null) &&
        (!q || [r.id, r.title, it.selector, it.snippet].some((x) => x.toLowerCase().includes(q)));
    });
  }, [instances, f]);
  const rules = useMemo(() => {
    const m = new Map<string, Map<string, Instance[]>>();
    for (const it of visible) {
      if (!m.has(it.rule)) m.set(it.rule, new Map());
      const g = m.get(it.rule)!;
      g.set(it.group, [...(g.get(it.group) ?? []), it]);
    }
    return [...m.entries()].map(([rule, groups]) => ({ rule, groups: [...groups.values()], n: [...groups.values()].flat().length }))
      .sort((x, y) => sevRank(RULE_CATALOG[x.rule].severity) - sevRank(RULE_CATALOG[y.rule].severity) || y.n - x.n);
  }, [visible]);

  // Keep a selection: the first issue in the list unless the selected one is still visible
  const current = instances.find((it) => it.k === selected);
  const first = rules[0]?.groups[0]?.[0];
  useEffect(() => { if (!visible.some((it) => it.k === selected)) setSelected(first?.k ?? null); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = current ? instances.filter((it) => it.group === current.group && it.rule === current.rule && it.status === current.status) : [];

  const now = instances.filter((it) => it.status !== "fixed");
  const here = now.filter((it) => it.shared == null).length;
  const crit = now.filter((it) => RULE_CATALOG[it.rule].severity === "critical").length;
  const counts = { all: now.length, new: instances.filter((it) => it.status === "new").length, fixed: instances.filter((it) => it.status === "fixed").length };
  const setFilter = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));
  const pagesHref = `/${site}/pages?crawl=${a}${b != null ? `&vs=${b}` : ""}`;
  const url = `${SITES[site].environments.production}${p.path}`;

  // ───────── Assistant: scripted answers that also drive the UI ─────────
  const askAi = (q: string) => { setAi(true); setAsk((x) => ({ q, n: (x?.n ?? 0) + 1 })); };
  const onAsk = (q: string): AiReply => {
    const t = q.toLowerCase();
    const sel = instances.find((it) => it.k === selected);
    if (/first|priorit|start|triage/.test(t)) {
      const mine = now.filter((it) => it.shared == null).sort((x, y) => sevRank(RULE_CATALOG[x.rule].severity) - sevRank(RULE_CATALOG[y.rule].severity));
      const top = [...new Set(mine.map((it) => it.rule))].slice(0, 3);
      if (mine[0]) { setF({ ...NO_FILTERS, onlyHere: true }); setSelected(mine[0].k); setTab("issues"); }
      return {
        text: mine.length
          ? `Of ${now.length} issues, ${now.length - here} come from shared markup (header, footer, cookie banner). They're fixed once in the template, not on this page.\n\nThe ${here} that are only here, worst first:\n${top.map((r, n) => `${n + 1}. ${RULE_CATALOG[r].title} (${mine.filter((x) => x.rule === r).length})`).join("\n")}\n\nI've selected the first one.`
          : `Every issue on this page comes from shared markup, so there's nothing to fix on the page itself. Hand the shared ones to whoever owns the template.`,
        actions: mine.length ? ["Filtered to issues only on this page", `Selected ${RULE_CATALOG[mine[0].rule].id}`] : [],
      };
    }
    if (/where|show|highlight|see/.test(t) && sel) {
      setTab("preview"); setHighlightRule(sel.rule); setLayers((l) => (l.includes("issues") ? l : [...l, "issues"]));
      return { text: `Here they are: every ${sel.rule} issue on the page is pulsing, and #${sel.k + 1} is selected. Click any box to switch to it.`, actions: ["Opened Preview", `Highlighted all ${instances.filter((x) => x.rule === sel.rule && x.onPage).length} ${sel.rule} issues`] };
    }
    if (/keyboard|tab order|focus/.test(t)) {
      setTab("preview"); setMode("live"); setLayers(["issues", "tab"]);
      const unnamed = now.filter((it) => ["link-name", "button-name", "label"].includes(it.rule)).length;
      return { text: `I switched to the live render with the tab order on. Each number is a Tab stop. Red ones have no accessible name${unnamed ? `: ${unnamed} on this page (icon links and the newsletter form)` : ""}. A screen reader user hears only "link" or "button" there.`, actions: ["Switched Preview to Live render", "Turned on the Tab order layer"] };
    }
    if (/new|since|chang/.test(t)) {
      if (!comparing) return { text: "Pick a baseline crawl on the Pages page to compare against, then I can show what's new and what was fixed.", actions: [] };
      setFilter({ seg: "new" }); setTab("issues");
      return { text: counts.new ? `${counts.new} issue${counts.new === 1 ? " is" : "s are"} new since #${b}, all in content that changed on this page. ${counts.fixed} were fixed.` : `Nothing new since #${b}. ${counts.fixed} issue${counts.fixed === 1 ? " was" : "s were"} fixed.`, actions: ["Showing New issues"] };
    }
    if (/fix|code|diff|patch/.test(t) && sel) {
      setFixes((s) => new Set(s).add(sel.k)); setTab("issues");
      const r = RULE_CATALOG[sel.rule];
      return { text: `Suggested fix for #${sel.k + 1} (${r.id}) is in the issue panel as a diff.\n\n${r.howToFix}${sel.shared ? `\n\nThis markup is on ${sel.shared.toLocaleString("en-US")} pages, so make the change in the shared template.` : group.length > 1 ? `\n\nThe same fix applies to all ${group.length} elements in this group.` : ""}`, actions: [`Generated a fix for #${sel.k + 1}`] };
    }
    if (/why|explain|what/.test(t) && sel) {
      const r = RULE_CATALOG[sel.rule];
      return { text: `${r.title}.\n\n${r.why}${r.criterion ? `\n\nIt fails WCAG ${r.criterion}.` : ""}`, actions: [] };
    }
    return { text: "In this prototype I can: suggest what to fix first, show issues on the page, check keyboard access, show what's new since the baseline, explain the selected issue, or write a fix for it.", actions: [] };
  };

  return (
    <Box pe={{ lg: ai ? "380px" : 0 }} transition="padding 0.15s">
      {/* Header */}
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="5" pb="5">
          <Breadcrumb.Root size="sm" mb="3">
            <Breadcrumb.List>
              <Breadcrumb.Item><Breadcrumb.Link asChild><NextLink href={pagesHref}>Pages</NextLink></Breadcrumb.Link></Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item><Breadcrumb.CurrentLink maxW="md" truncate>{p.title}</Breadcrumb.CurrentLink></Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>
          <Flex justify="space-between" gap="4" align="start" direction={{ base: "column", md: "row" }}>
            <Stack gap="1" minW="0">
              <Heading size="xl" fontWeight="semibold" lineClamp={2}>{p.title}</Heading>
              <HStack gap="2" textStyle="sm" color="fg.muted" wrap="wrap">
                <Link href={url} target="_blank" rel="noopener noreferrer" fontFamily="mono" textStyle="xs" color="fg.muted">{p.path} <LuExternalLink /></Link>
                {p.status !== 200 && <Badge size="xs" variant="subtle" colorPalette={p.status === 301 ? "blue" : "red"}>{p.status}</Badge>}
                <Text>· {typeLabel(p.type)} · crawl #{a}{comparing ? ` vs #${b}` : ""}</Text>
              </HStack>
            </Stack>
            <Button size="sm" variant={ai ? "subtle" : "outline"} onClick={() => setAi((x) => !x)} flexShrink={0}><LuSparkles />Assistant</Button>
          </Flex>

          {/* The gist, one line; each part is a shortcut to that filter */}
          <HStack mt="4" gap="1" textStyle="sm" wrap="wrap">
            <Summary onClick={() => { setF(NO_FILTERS); setTab("issues"); }}><b>{now.length}</b> issues</Summary>
            <Dot />
            <Summary onClick={() => { setF({ ...NO_FILTERS, onlyHere: true }); setTab("issues"); }}><b>{here}</b> only on this page</Summary>
            <Dot />
            <Summary muted><b>{now.length - here}</b> from shared header/footer</Summary>
            {crit > 0 && <><Dot /><Summary color="red.fg" onClick={() => { setF({ ...NO_FILTERS, sev: "critical" }); setTab("issues"); }}><b>{crit}</b> critical</Summary></>}
            {comparing && <><Dot /><Summary color="green.fg" onClick={() => { setF({ ...NO_FILTERS, seg: "new" }); setTab("issues"); }}><b>{counts.new}</b> new</Summary>
              <Summary muted>and</Summary>
              <Summary onClick={() => { setF({ ...NO_FILTERS, seg: "fixed" }); setTab("issues"); }}><b>{counts.fixed}</b> fixed since #{b}</Summary></>}
          </HStack>
        </Container>
      </Box>

      <Container maxW="7xl" py="5">
        <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as typeof tab)} variant="line" size="sm">
          <Tabs.List mb="4">
            <Tabs.Trigger value="issues">Issues <Badge size="xs" variant="subtle" colorPalette="gray">{now.length}</Badge></Tabs.Trigger>
            <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
            <Tabs.Trigger value="source">Source</Tabs.Trigger>
          </Tabs.List>

          {/* ───────── Issues ───────── */}
          <Tabs.Content value="issues" p="0">
            <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
              <DataToolbar<Seg>
                query={f.q} onQuery={(q) => setFilter({ q })} placeholder="Search rules, selectors, code"
                segments={comparing ? [{ value: "all", label: `All ${counts.all}` }, { value: "new", label: `New ${counts.new}` }, { value: "fixed", label: `Fixed ${counts.fixed}` }] : undefined}
                value={f.seg} onValue={(seg) => setFilter({ seg })}
                count={visible.length !== counts.all ? `${visible.length} shown` : ""}
                copyLabel="Copy prompt for the selected issue" onCopy={() => current && navigator.clipboard.writeText(issuePrompt(p, current))}
                downloadLabel="Download these issues (.csv)" onDownload={() => downloadText(["n,rule,severity,category,status,shared_pages,selector,snippet",
                  ...visible.map((it) => [it.k + 1, it.rule, RULE_CATALOG[it.rule].severity, RULE_CATALOG[it.rule].category, it.status, it.shared ?? "", it.selector, it.snippet]
                    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n"), `issues-${p.path.split("/").pop()}-${a}.csv`, "text/csv")}
              />
              <HStack gap="2" px="2" py="1.5" borderBottomWidth="1px" bg="bg.subtle" wrap="wrap">
                <FilterSelect value={f.cat} onChange={(cat) => setFilter({ cat })} w="44" items={[{ value: "all", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} />
                <FilterSelect value={f.sev} onChange={(sev) => setFilter({ sev })} w="36" items={[{ value: "all", label: "Any severity" }, ...SEVERITIES.map((s) => ({ value: s.id, label: s.label }))]} />
                <Switch.Root size="sm" checked={f.onlyHere} onCheckedChange={(e) => setFilter({ onlyHere: e.checked })} ms="2">
                  <Switch.HiddenInput /><Switch.Control /><Switch.Label textStyle="xs">Only this page <Span color="fg.muted">(hide shared header/footer)</Span></Switch.Label>
                </Switch.Root>
                {JSON.stringify(f) !== JSON.stringify(NO_FILTERS) && <Button size="xs" variant="ghost" ms="auto" onClick={() => setF(NO_FILTERS)}>Clear filters</Button>}
              </HStack>

              <Grid templateColumns={{ base: "1fr", md: "minmax(300px, 380px) 1fr" }} minH="520px">
                <Box borderEndWidth={{ md: "1px" }} borderBottomWidth={{ base: "1px", md: 0 }} overflowY="auto" maxH={{ md: "calc(100vh - 14rem)" }}>
                  {rules.length === 0 ? <Text p="4" textStyle="sm" color="fg.muted">No issues match.</Text> : rules.map(({ rule, groups, n }) => {
                    const r = RULE_CATALOG[rule];
                    return (
                      <Box key={rule} borderBottomWidth="1px" borderColor="border.muted">
                        <HStack px="3" pt="2.5" pb="1" gap="2">
                          <SevDot sev={r.severity} />
                          <Text textStyle="sm" fontWeight="medium" flex="1" lineClamp={1} title={r.title}>{r.title}</Text>
                          <Text textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums">{n}</Text>
                        </HStack>
                        <Stack gap="0" pb="1.5">
                          {groups.map((g) => {
                            const on = current && g.some((it) => it.k === current.k);
                            return (
                              <HStack key={g[0].group} as="button" textAlign="start" gap="2" ps="7" pe="3" py="1.5" textStyle="xs" w="full"
                                bg={on ? "brand.subtle" : undefined} _hover={{ bg: on ? "brand.subtle" : "bg.subtle" }} onClick={() => setSelected(g[0].k)}
                                borderStartWidth="2px" borderColor={on ? "brand.solid" : "transparent"}>
                                <Text fontFamily="mono" flex="1" truncate color={on ? "fg" : "fg.muted"}>{g[0].group}</Text>
                                {g[0].status === "new" && <Badge size="xs" variant="outline" colorPalette="green">New</Badge>}
                                {g[0].status === "fixed" && <Badge size="xs" variant="outline" colorPalette="gray">Fixed</Badge>}
                                {g[0].shared != null && <Badge size="xs" variant="subtle" colorPalette="gray">Shared</Badge>}
                                {g.length > 1 && <Text color="fg.muted" fontVariantNumeric="tabular-nums">×{g.length}</Text>}
                              </HStack>
                            );
                          })}
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
                <Box minW="0">
                  {current ? (
                    <IssuePanel it={current} group={group} html={html} page={p} fix={fixes.has(current.k)} onFix={() => setFixes((s) => new Set(s).add(current.k))}
                      onSelect={setSelected} onShow={() => { setTab("preview"); setHighlightRule(current.rule); }}
                      onAsk={() => askAi("Fix the selected issue")} />
                  ) : <Text p="4" textStyle="sm" color="fg.muted">Select an issue.</Text>}
                </Box>
              </Grid>
            </Flex>
          </Tabs.Content>

          {/* ───────── Preview ───────── */}
          <Tabs.Content value="preview" p="0">
            <HStack gap="3" mb="3" wrap="wrap">
              <SegmentGroup.Root size="xs" value={mode} onValueChange={(e) => { setMode(e.value as typeof mode); if (e.value === "screenshot") { setViewport(1280); setLayers(["issues"]); } }}>
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={[{ value: "screenshot", label: "Screenshot" }, { value: "live", label: "Live render" }]} />
              </SegmentGroup.Root>
              {mode === "live" ? (
                <>
                  <SegmentGroup.Root size="xs" value={String(viewport)} onValueChange={(e) => setViewport(Number(e.value))}>
                    <SegmentGroup.Indicator />
                    <SegmentGroup.Items items={VIEWPORTS} />
                  </SegmentGroup.Root>
                  <HStack gap="1">
                    {LAYERS.map((l) => {
                      const on = layers.includes(l.id);
                      return <Button key={l.id} size="xs" variant={on ? "subtle" : "ghost"} colorPalette={on ? "brand" : "gray"}
                        onClick={() => setLayers((x) => (on ? x.filter((y) => y !== l.id) : [...x, l.id]))}>{l.label}</Button>;
                    })}
                  </HStack>
                  <Text textStyle="xs" color="fg.muted">Hover to inspect any element.</Text>
                </>
              ) : (
                <Text textStyle="xs" color="fg.muted">Taken during crawl #{a} at 1280px. Click a box to see the issue.</Text>
              )}
              {highlightRule && <Button size="xs" variant="ghost" ms="auto" onClick={() => setHighlightRule(null)}>Stop highlighting {highlightRule}</Button>}
            </HStack>
            <Grid templateColumns={{ base: "1fr", lg: "1fr 320px" }} gap="4" alignItems="start">
              <Box maxW={mode === "live" && viewport < 1280 ? `${viewport + 2}px` : undefined} mx="auto" w="full">
                <PagePreview html={html} instances={visible.filter((it) => it.onPage)} selected={selected} highlightRule={highlightRule}
                  onSelect={setSelected} mode={mode} viewport={mode === "live" ? viewport : 1280} layers={layers} />
              </Box>
              <Box position={{ lg: "sticky" }} top={{ lg: "calc(var(--sticky-top, 4rem) + 1rem)" }} borderWidth="1px" rounded="l2" p="4">
                {current ? <IssueSummary it={current} onOpen={() => setTab("issues")} /> : <Text textStyle="sm" color="fg.muted">Click a box on the page.</Text>}
              </Box>
            </Grid>
          </Tabs.Content>

          {/* ───────── Source ───────── */}
          <Tabs.Content value="source" p="0">
            <SourceView html={html} instances={visible} selected={selected} onSelect={setSelected} />
          </Tabs.Content>
        </Tabs.Root>
      </Container>

      <AiPanel open={ai} onClose={() => setAi(false)} onAsk={onAsk} ask={ask}
        context={[`${p.path}`, `crawl #${a}${comparing ? ` vs #${b}` : ""}`, `${now.length} issues`, ...(current ? [`selected: ${current.rule} #${current.k + 1}`] : [])]}
        suggestions={["What should I fix first?", "Show me where this is on the page", "Fix the selected issue", "Check keyboard access", ...(comparing ? ["What's new since the last crawl?"] : []), "Explain this issue simply"]} />
    </Box>
  );
}

// ───────── Issue panel ─────────
function IssuePanel({ it, group, html, page, fix, onFix, onSelect, onShow, onAsk }: {
  it: Instance; group: Instance[]; html: string; page: NonNullable<ReturnType<typeof pageView>>; fix: boolean;
  onFix: () => void; onSelect: (k: number) => void; onShow: () => void; onAsk: () => void;
}) {
  const r = RULE_CATALOG[it.rule];
  const idx = group.findIndex((x) => x.k === it.k);
  const [copied, setCopied] = useState(false);
  return (
    <Stack gap="5" p="5">
      <Stack gap="2">
        <HStack gap="1.5" wrap="wrap">
          <Badge size="sm" variant="subtle" colorPalette={SEV[r.severity].color}>{SEV[r.severity].label}</Badge>
          <Badge size="sm" variant="outline" colorPalette="gray">{CATEGORIES.find((c) => c.id === r.category)!.label}</Badge>
          <Badge size="sm" variant="outline" colorPalette="gray">{r.source} · <Span fontFamily="mono">{r.id}</Span></Badge>
          {it.status === "new" && <Badge size="sm" variant="solid" colorPalette="green">New in this crawl</Badge>}
          {it.status === "fixed" && <Badge size="sm" variant="solid" colorPalette="gray">Fixed: gone in this crawl</Badge>}
        </HStack>
        <Heading size="md" fontWeight="semibold">{r.title}</Heading>
        <Text textStyle="xs" color="fg.muted">
          {r.criterion ? `WCAG ${r.criterion} · ` : ""}{it.status === "existing" ? `First seen in #${it.firstSeen} · ` : ""}
          {it.shared ? <>Shared markup: also on <b>{it.shared.toLocaleString("en-US")}</b> pages. Fix it in the template.</> : "Only on this page."}
        </Text>
      </Stack>

      {/* Evidence */}
      <Stack gap="2">
        <HStack justify="space-between">
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">Evidence{group.length > 1 ? ` · element ${idx + 1} of ${group.length}` : ""}</Text>
          <HStack gap="1">
            {group.length > 1 && (
              <>
                <IconButton size="2xs" variant="ghost" aria-label="Previous element" disabled={idx <= 0} onClick={() => onSelect(group[idx - 1].k)}><LuChevronLeft /></IconButton>
                <IconButton size="2xs" variant="ghost" aria-label="Next element" disabled={idx >= group.length - 1} onClick={() => onSelect(group[idx + 1].k)}><LuChevronRight /></IconButton>
              </>
            )}
            {it.onPage && <Button size="2xs" variant="ghost" onClick={onShow}><LuEye />Show on page</Button>}
          </HStack>
        </HStack>
        {it.onPage
          ? <PagePreview html={html} instances={[it]} selected={it.k} mode="screenshot" crop={it.k} height={170} />
          : <Text textStyle="xs" color="fg.muted">{it.status === "fixed" ? "This element is no longer on the page." : "In the document head; nothing visible to show."}</Text>}
        <CodeBlock code={it.snippet} label={it.selector} />
      </Stack>

      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="5">
        <Stack gap="1"><Text textStyle="xs" fontWeight="medium" color="fg.muted">Why it matters</Text><Text textStyle="sm">{r.why}</Text></Stack>
        <Stack gap="1"><Text textStyle="xs" fontWeight="medium" color="fg.muted">How to fix</Text><Text textStyle="sm">{r.howToFix}</Text></Stack>
      </Grid>

      {fix && it.status !== "fixed" && (
        <Stack gap="2">
          <HStack justify="space-between">
            <Text textStyle="xs" fontWeight="medium" color="fg.muted">Suggested fix</Text>
            {group.length > 1 && <Text textStyle="xs" color="fg.muted">Same change for all {group.length} elements in this group</Text>}
          </HStack>
          <Diff before={it.snippet} after={r.fix(it.snippet)} />
        </Stack>
      )}

      <HStack gap="2" wrap="wrap">
        {it.status !== "fixed" && !fix && <Button size="sm" onClick={onFix}><LuWand />Suggest a fix</Button>}
        <Button size="sm" variant="outline" onClick={onAsk}><LuSparkles />Ask the assistant</Button>
        <Tooltip content="Everything above as one prompt, for your own AI tool">
          <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(issuePrompt(page, it)); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            <LuCopy />{copied ? "Copied" : "Copy prompt"}
          </Button>
        </Tooltip>
      </HStack>

      <Stack gap="1">
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">References</Text>
        {r.refs.map((ref) => <Link key={ref.url} href={ref.url} target="_blank" rel="noopener noreferrer" textStyle="sm" color="brand.fg">{ref.label} <LuExternalLink /></Link>)}
      </Stack>
    </Stack>
  );
}

function IssueSummary({ it, onOpen }: { it: Instance; onOpen: () => void }) {
  const r = RULE_CATALOG[it.rule];
  return (
    <Stack gap="3">
      <HStack gap="1.5"><SevDot sev={r.severity} /><Text textStyle="xs" color="fg.muted">#{it.k + 1} · {SEV[r.severity].label} · {r.id}</Text></HStack>
      <Text textStyle="sm" fontWeight="semibold">{r.title}</Text>
      <CodeBlock code={it.snippet} label={it.selector} />
      <Text textStyle="sm" color="fg.muted">{r.howToFix}</Text>
      <Button size="xs" variant="outline" alignSelf="start" onClick={onOpen}>Open in Issues</Button>
    </Stack>
  );
}

// ───────── Small pieces ─────────
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <Box borderWidth="1px" rounded="l2" overflow="hidden">
      <HStack px="2.5" py="1" bg="bg.subtle" borderBottomWidth="1px" justify="space-between">
        <Text textStyle="xs" fontFamily="mono" color="fg.muted" truncate>{label}</Text>
        <IconButton size="2xs" variant="ghost" aria-label="Copy code" onClick={() => navigator.clipboard.writeText(code)}><LuCopy /></IconButton>
      </HStack>
      <Code display="block" whiteSpace="pre-wrap" wordBreak="break-all" p="2.5" textStyle="xs" bg="transparent">{code}</Code>
    </Box>
  );
}

// Line diff of one element: removed lines red, added green, unchanged plain
function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n"), b = after.split("\n");
  const rows: { t: " " | "-" | "+"; l: string }[] = [];
  const common = a.filter((l) => b.includes(l));
  for (const l of a) rows.push({ t: common.includes(l) ? " " : "-", l });
  for (const l of b) if (!common.includes(l)) rows.push({ t: "+", l });
  return (
    <Box borderWidth="1px" rounded="l2" overflow="hidden" fontFamily="mono" textStyle="xs">
      {rows.map((r, n) => (
        <HStack key={n} align="start" gap="0" bg={r.t === "-" ? "red.subtle" : r.t === "+" ? "green.subtle" : undefined}>
          <Text w="6" flexShrink={0} textAlign="center" color={r.t === "-" ? "red.fg" : r.t === "+" ? "green.fg" : "fg.subtle"} py="0.5">{r.t}</Text>
          <Text whiteSpace="pre-wrap" wordBreak="break-all" py="0.5" pe="2">{r.l}</Text>
        </HStack>
      ))}
    </Box>
  );
}

function SourceView({ html, instances, selected, onSelect }: { html: string; instances: Instance[]; selected: number | null; onSelect: (k: number) => void }) {
  const { lines, lineOf } = useMemo(() => sourceLines(html), [html]);
  const marks = new Map<number, Instance[]>();
  for (const it of instances) { const l = lineOf.get(it.k); if (l != null) marks.set(l, [...(marks.get(l) ?? []), it]); }
  const selLine = selected != null ? lineOf.get(selected) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "center" }); }, [selLine]);
  return (
    <Box borderWidth="1px" rounded="l2" overflow="auto" maxH="calc(100vh - 14rem)" fontFamily="mono" textStyle="xs" bg="bg.subtle">
      {lines.map((l, n) => {
        const m = marks.get(n);
        const on = n === selLine;
        return (
          <Flex key={n} ref={on ? ref : undefined} bg={on ? "brand.muted" : m ? "orange.subtle" : undefined} minW="max-content">
            <Text w="10" flexShrink={0} textAlign="right" pe="2" color="fg.subtle" userSelect="none">{n + 1}</Text>
            <Box w="5" flexShrink={0}>
              {m && <Tooltip content={m.map((it) => `#${it.k + 1} ${it.rule}`).join(", ")}>
                <Box as="button" w="2" h="2" mt="1.5" rounded="full" bg={on ? "brand.solid" : "orange.solid"} onClick={() => onSelect(m[0].k)} aria-label="Select issue" />
              </Tooltip>}
            </Box>
            <Text whiteSpace="pre" pe="4">{l}</Text>
          </Flex>
        );
      })}
    </Box>
  );
}

const SevDot = ({ sev }: { sev: string }) => <Box w="2" h="2" rounded="full" flexShrink={0} bg={`${SEV[sev].color}.solid`} />;
const Dot = () => <Text color="fg.subtle" px="1">·</Text>;
function Summary({ children, onClick, muted, color }: { children: React.ReactNode; onClick?: () => void; muted?: boolean; color?: string }) {
  return onClick
    ? <Button variant="plain" size="sm" h="auto" p="0" fontWeight="normal" color={color ?? "fg"} _hover={{ textDecoration: "underline" }} onClick={onClick}>{children}</Button>
    : <Text color={muted ? "fg.muted" : color}>{children}</Text>;
}
