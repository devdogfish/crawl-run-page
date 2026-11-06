// Page detail · /[site]/pages/[pageId]?crawl=811&vs=810
// For a developer fixing one page. Quiet by default: the list of what's wrong on this page, and the selected
// issue with how to fix it. Shared issues (header, footer, banners) are folded away: they're fixed in the template.
//   Issues  → list (this page first, shared folded) | selected issue: why, the element, how to fix, suggested fix
//   Preview → live render of the stored page with issue boxes (viewport + accessibility layers); no screenshots
//   Source  → the rendered HTML, issue lines marked
// "Fix with AI" / "Explain with AI" put a visible prompt into the global assistant (components/assistant.tsx).
// ?issue= and ?tab= select the element and the view, so the assistant's links land on the right thing.
//
// PROTOTYPE: data from src/lib/page-issues.ts.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { useLocation, useParams, useSearchParams } from "react-router";
import {
  Box, Button, Code, Collapsible, Container, EmptyState, Flex, Grid, HStack, Heading, Icon, IconButton, Input, InputGroup, Link, Menu, Portal,
  SegmentGroup, Span, Stack, Tabs, Text,
} from "@chakra-ui/react";
import { LuCode, LuCheck, LuChevronDown, LuChevronLeft, LuChevronRight, LuCopy, LuDownload, LuEllipsis, LuExternalLink, LuFileQuestion, LuFilter, LuLayers, LuLink, LuSearch, LuSparkles, LuTerminal } from "react-icons/lu";

import { useCopy } from "@/components/assistant/common";
import { NavAction } from "@/components/nav-action";
import { useAssistant } from "@/components/assistant";
import { BackLink, RuleGuide, RuleMeta, RuleTitle } from "@/components/rule-ui";
import { SourceView } from "@/components/source-view";
import { PagePreview, type Layer } from "@/components/page-preview";
import { useSite } from "@/components/site-context";
import { Tooltip } from "@/components/ui/tooltip";
import {
  RULE_CATALOG, SEVERITIES, apiRequest, batchPrompt, issuePrompt, issuesJson, localCheck, pageIssues, sevRank, type Instance,
} from "@/lib/page-issues";
import { PRIORITIES, PRIORITY, type Priority } from "@/lib/priority";
import { explainMessage, fixMessage, issueId, summarizeMessage } from "@/lib/refs";
import { downloadText } from "@/components/data-toolbar";
import { CATEGORIES, defaultCrawl, pageView, siteSize } from "@/lib/site-pages";
import { SITES, type SiteId } from "@/lib/sites";

type Seg = "all" | "new" | "fixed";
type PageV = NonNullable<ReturnType<typeof pageView>>;
const SEV = Object.fromEntries(SEVERITIES.map((s) => [s.id, s]));
const VIEWPORTS = [{ value: "1280", label: "Desktop" }, { value: "768", label: "Tablet" }, { value: "390", label: "Mobile" }];
const LAYERS: { id: Exclude<Layer, "issues">; label: string }[] = [
  { id: "tab", label: "Tab order" }, { id: "headings", label: "Headings" }, { id: "landmarks", label: "Landmarks" }, { id: "alt", label: "Alt text" },
];

export default function PageDetailRoute() {
  return <Suspense><PageDetail /></Suspense>;
}

function PageDetail() {
  const site = useSite();
  const { pageId } = useParams<{ pageId: string }>();
  const sp = useSearchParams()[0];
  const a = Number(sp.get("crawl") ?? defaultCrawl(site).id);
  const b = sp.get("vs") ? Number(sp.get("vs")) : null;
  const p = useMemo(() => pageView(site, Number(pageId), a, b), [site, pageId, a, b]);
  if (!p) {
    return (
      <Container maxW="7xl" pt="16">
        <EmptyState.Root><EmptyState.Content>
          <EmptyState.Indicator><LuFileQuestion /></EmptyState.Indicator>
          <EmptyState.Title>This page isn&apos;t in crawl #{a}</EmptyState.Title>
          <EmptyState.Description><Link asChild><RouterLink to={`/${site}/pages`}>Back to Pages</RouterLink></Link></EmptyState.Description>
        </EmptyState.Content></EmptyState.Root>
      </Container>
    );
  }
  return <Detail key={`${pageId}-${a}-${b}`} p={p} a={a} b={b} site={site} />;
}

function Detail({ p, a, b, site }: { p: PageV; a: number; b: number | null; site: SiteId }) {
  // Assets aren't stored: the preview streams them from the site that was crawled
  const origin = SITES[site].url;
  const { instances, html } = useMemo(() => pageIssues(p, a, b, siteSize(site)), [p, a, b, site]);
  // Shareable state lives in the URL: ?issue=18&tab=preview&pri=P1&cat=accessibility&q=…&seg=new
  const sp = useSearchParams()[0];
  const tabOf = (v: string | null) => (v === "preview" || v === "source" ? v : "issues");
  const [tab, setTab] = useState<"issues" | "preview" | "source">(tabOf(sp.get("tab")));
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split(",") : []);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [seg, setSeg] = useState<Seg>((sp.get("seg") as Seg) ?? "all");
  const [pri, setPri] = useState<Priority[]>(list("pri") as Priority[]);
  const [cats, setCats] = useState<string[]>(list("cat"));
  const [sharedOpen, setSharedOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(sp.get("issue") ? Number(sp.get("issue")) - 1 : null);
  const prio = (sev: string) => PRIORITY[sev as keyof typeof PRIORITY];
  const [highlightRule, setHighlightRule] = useState<string | null>(null);
  const [viewport, setViewport] = useState(1280);
  const [previewReveal, setPreviewReveal] = useState(0);
  const [layers, setLayers] = useState<Layer[]>(["issues"]);
  const comparing = b != null;

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return instances.filter((it) => {
      const r = RULE_CATALOG[it.rule];
      return (seg === "all" ? it.status !== "fixed" : it.status === seg) && (!pri.length || pri.includes(PRIORITY[r.severity])) && (!cats.length || cats.includes(r.category)) &&
        (!t || [it.rule, r.title, it.selector, it.snippet].some((x) => x.toLowerCase().includes(t)));
    });
  }, [instances, q, seg, pri, cats]);

  // One row per rule, worst first; split into "this page" and "shared"
  const byRule = (list: Instance[]) => {
    const m = new Map<string, Instance[]>();
    for (const it of list) m.set(it.rule, [...(m.get(it.rule) ?? []), it]);
    return [...m.entries()].map(([rule, items]) => ({ rule, items }))
      .sort((x, y) => sevRank(RULE_CATALOG[x.rule].severity) - sevRank(RULE_CATALOG[y.rule].severity) || y.items.length - x.items.length);
  };
  const local = useMemo(() => byRule(visible.filter((it) => it.shared == null)), [visible]);
  const shared = useMemo(() => byRule(visible.filter((it) => it.shared != null)), [visible]);

  // The selected issue, or the first one in the list when nothing visible is selected
  const current = visible.find((it) => it.k === selected) ?? (local[0] ?? shared[0])?.items[0];
  useEffect(() => { if (current?.shared != null) setSharedOpen(true); }, [current?.k]); // eslint-disable-line react-hooks/exhaustive-deps
  const siblings = current ? visible.filter((it) => it.rule === current.rule && (it.shared == null) === (current.shared == null)) : [];

  const now = instances.filter((it) => it.status !== "fixed");
  const counts = { all: now.length, new: instances.filter((it) => it.status === "new").length, fixed: instances.filter((it) => it.status === "fixed").length };
  const pagesHref = `/${site}/pages?crawl=${a}${b != null ? `&vs=${b}` : ""}`;

  // A link to this page (from the assistant) selects its element and view without reloading the page
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const k = sp.get("issue") ? Number(sp.get("issue")) - 1 : null;
    if (k != null) {
      setSelected(k);
      setSeg((x) => (instances.find((i) => i.k === k)?.status === "fixed" ? "fixed" : x === "fixed" ? "all" : x));
      setQ(""); setPri([]); setCats([]);
    }
    setTab(tabOf(sp.get("tab")));
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror the view into the URL (no navigation), so any issue or filtered list can be linked to
  useEffect(() => {
    const u = new URLSearchParams({ crawl: String(a), ...(b != null ? { vs: String(b) } : {}) });
    if (current) u.set("issue", String(current.k + 1));
    if (tab !== "issues") u.set("tab", tab);
    if (q) u.set("q", q);
    if (seg !== "all") u.set("seg", seg);
    if (pri.length) u.set("pri", pri.join(","));
    if (cats.length) u.set("cat", cats.join(","));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${u}`);
  }, [current?.k, tab, q, seg, pri, cats, a, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkTo = (it: Instance) => typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}?crawl=${a}${b != null ? `&vs=${b}` : ""}&issue=${it.k + 1}`;

  // Ask AI: the buttons write a short message with the issue or page as a reference; the model looks it up
  const { send } = useAssistant();
  const fixAi = (it: Instance) => send(fixMessage(issueId(site, p.i, it.k)));
  const explainAi = (it: Instance) => send(explainMessage(issueId(site, p.i, it.k)));

  return (
    <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as typeof tab)} variant="line" size="sm">
      <Box borderBottomWidth="1px">
        <Container maxW="7xl" pt="5" pb="0">
          <BackLink href={pagesHref}>Pages</BackLink>
          <Flex justify="space-between" align="start" gap="4">
            {/* The title is the link to the live page: icon on it, underline on hover, full URL in the tooltip */}
            <Tooltip content={`${SITES[site].url}${p.path}`} positioning={{ placement: "bottom-start" }} openDelay={300}>
              <Link href={`${SITES[site].url}${p.path}`} target="_blank" rel="noopener noreferrer" color="fg" minW="0" maxW="full" gap="2" _hover={{ textDecoration: "underline" }}>
                <Heading as="span" size="lg" fontWeight="semibold" truncate>{p.title}</Heading>
                <Icon as={LuExternalLink} boxSize="4" color="fg.muted" flexShrink={0} />
              </Link>
            </Tooltip>
          </Flex>
          <Tabs.List mt="3" borderBottomWidth="0">
            <Tabs.Trigger value="issues">Issues <Span color="fg.muted" fontVariantNumeric="tabular-nums">{now.length}</Span></Tabs.Trigger>
            <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
            <Tabs.Trigger value="source">Source</Tabs.Trigger>
          </Tabs.List>
        </Container>
      </Box>

      <Container maxW="7xl" pb="10">
          {/* ───────── Issues ───────── */}
          <Tabs.Content value="issues" pt="5">
            <Grid templateColumns={{ base: "1fr", md: "300px 1fr" }} gap={{ base: "6", md: "8" }} alignItems="start">
              <Stack gap="4" position={{ md: "sticky" }} top={{ md: "calc(var(--sticky-top, 4rem) + 1rem)" }}>
                <Stack gap="2">
                  <HStack gap="1.5">
                    <InputGroup startElement={<LuSearch />} flex="1" minW="0">
                      <Input size="sm" h="9" colorPalette="gray" bg="bg" borderColor="border" rounded="l2" _focusVisible={{ borderColor: "border.emphasized", outline: "2px solid", outlineColor: "border.emphasized", outlineOffset: "1px" }} placeholder="Search issues" value={q} onChange={(e) => setQ(e.target.value)} />
                    </InputGroup>
                    <FilterMenu pri={pri} setPri={setPri} cats={cats} setCats={setCats} />
                    <ExportMenu count={visible.filter((it) => it.status !== "fixed").length}
                      onAsk={() => send(summarizeMessage(p.i, { status: seg, priorities: pri, categories: cats, query: q }))}
                      onPrompt={() => navigator.clipboard.writeText(batchPrompt(p, visible.filter((it) => it.status !== "fixed"), prio))}
                      onJson={() => downloadText(issuesJson(p, a, visible, prio), `issues-${p.i}-${a}.json`, "application/json")}
                      onApi={() => navigator.clipboard.writeText(apiRequest(p.i, a, { priority: pri, category: cats, ...(seg !== "all" ? { status: [seg] } : {}) }))}
                      onLink={() => navigator.clipboard.writeText(window.location.href)} />
                  </HStack>
                  {comparing && (
                    <SegmentGroup.Root size="xs" value={seg} onValueChange={(e) => setSeg(e.value as Seg)} w="full">
                      <SegmentGroup.Indicator />
                      <SegmentGroup.Items flex="1" items={[{ value: "all", label: `All (${counts.all})` }, { value: "new", label: `New (${counts.new})` }, { value: "fixed", label: `Fixed (${counts.fixed})` }]} />
                    </SegmentGroup.Root>
                  )}
                </Stack>

                <Box display={{ base: "block", md: "none" }}>
                  <Menu.Root positioning={{ placement: "bottom-start" }}>
                    <Menu.Trigger asChild>
                      <NavAction w="full" h="auto" minH="10" py="2" justifyContent="space-between" aria-label="Choose issue">
                        <Text textStyle="sm" textAlign="start" whiteSpace="normal">{current ? RULE_CATALOG[current.rule].title : "Choose issue"}</Text><LuChevronDown />
                      </NavAction>
                    </Menu.Trigger>
                    <Portal><Menu.Positioner><Menu.Content w="min(360px, calc(100vw - 32px))" maxH="60dvh" overflowY="auto" colorPalette="gray">
                      {[{ title: "On this page", groups: local }, { title: "Shared across the site", groups: shared }].filter((group) => group.groups.length).map((group) => (
                        <Menu.ItemGroup key={group.title}>
                          <Menu.ItemGroupLabel textStyle="xs" color="fg.muted">{group.title}</Menu.ItemGroupLabel>
                          {group.groups.map(({ rule, items }) => <Menu.Item key={rule} value={rule} onClick={() => setSelected(items[0].k)}>
                            <Text textStyle="xs" flexShrink={0}>{prio(RULE_CATALOG[rule].severity)}</Text>
                            <Text flex="1">{RULE_CATALOG[rule].title}</Text>
                            <Text color="fg.muted" textStyle="xs">{items.length}</Text>
                          </Menu.Item>)}
                        </Menu.ItemGroup>
                      ))}
                      {!local.length && !shared.length && <Text p="2" textStyle="sm" color="fg.muted">No issues match.</Text>}
                    </Menu.Content></Menu.Positioner></Portal>
                  </Menu.Root>
                </Box>
                <Stack gap="4" display={{ base: "none", md: "flex" }}>
                <RuleList title="On this page" groups={local} selected={current} onSelect={setSelected} prio={prio} empty="Nothing on this page." />

                {shared.length > 0 && (
                  <Collapsible.Root open={sharedOpen} onOpenChange={(e) => setSharedOpen(e.open)}>
                    <Collapsible.Trigger asChild>
                      <HStack as="button" w="full" gap="1.5" textStyle="xs" color="fg.muted" _hover={{ color: "fg" }}>
                        <Box transition="transform 0.15s" transform={sharedOpen ? undefined : "rotate(-90deg)"}><LuChevronDown /></Box>
                        <Text fontWeight="medium">Shared across the site</Text>
                        <Text ms="auto" fontVariantNumeric="tabular-nums">{shared.reduce((n, g) => n + g.items.length, 0)}</Text>
                      </HStack>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <Box mt="2"><RuleList groups={shared} selected={current} onSelect={setSelected} prio={prio} /></Box>
                    </Collapsible.Content>
                  </Collapsible.Root>
                )}
                </Stack>
              </Stack>

              <Box minW="0" borderStartWidth={{ md: "1px" }} ps={{ md: "8" }}>
                {current
                  ? <IssueView it={current} siblings={siblings} html={html} origin={origin} page={p} link={linkTo(current)} onSelect={setSelected}
                      onShow={() => {
                        setSelected(current.k);
                        setLayers((value) => value.includes("issues") ? value : [...value, "issues"]);
                        setPreviewReveal((value) => value + 1);
                        setTab("preview"); setHighlightRule(current.rule);
                      }} onFix={() => fixAi(current)} onExplain={() => explainAi(current)} />
                  : <Text textStyle="sm" color="fg.muted">No issues match.</Text>}
              </Box>
            </Grid>
          </Tabs.Content>

          {/* ───────── Preview ───────── */}
          <Tabs.Content value="preview" pt="4">
            <HStack gap="2" mb="3" wrap="wrap">
              <Menu.Root closeOnSelect={false}>
                <Menu.Trigger asChild>
                  <Button size="xs" variant="outline" colorPalette="gray" color="fg.muted" borderColor="border"><LuLayers />Layers{layers.length > 1 ? ` · ${layers.length - 1}` : ""}</Button>
                </Menu.Trigger>
                <Portal><Menu.Positioner><Menu.Content minW="44">
                  {LAYERS.map((l) => (
                    <Menu.CheckboxItem key={l.id} value={l.id} checked={layers.includes(l.id)}
                      onCheckedChange={(c) => setLayers((x) => (c ? [...x, l.id] : x.filter((y) => y !== l.id)))}>
                      {l.label}<Menu.ItemIndicator />
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Content></Menu.Positioner></Portal>
              </Menu.Root>
              <SegmentGroup.Root size="xs" value={String(viewport)} onValueChange={(e) => setViewport(Number(e.value))}>
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={VIEWPORTS} />
              </SegmentGroup.Root>
            </HStack>
            <Box maxW={viewport < 1280 ? `${viewport + 2}px` : "full"} mx="auto">
              <PagePreview html={html} origin={origin} instances={visible.filter((it) => it.onPage)} selected={current?.k ?? null} highlightRule={highlightRule}
                onSelect={setSelected} viewport={viewport} layers={layers} revealRequest={previewReveal}
                card={current && (
                  <ElementCard it={current} siblings={siblings} page={p} onSelect={setSelected} prio={prio} link={linkTo(current)}
                    onFix={() => fixAi(current)} onExplain={() => explainAi(current)} onDetails={() => setTab("issues")}
                    onShowCode={() => { setSelected(current.k); setTab("source"); }} />
                )} />
            </Box>
          </Tabs.Content>

          {/* ───────── Source ───────── */}
          <Tabs.Content value="source" pt="4">
            <SourceView html={html} instances={visible} selected={current?.k ?? null} onSelect={setSelected} active={tab === "source"}
              card={current && <ElementCard it={current} siblings={siblings} page={p} onSelect={setSelected} prio={prio} link={linkTo(current)} showExplanation
                onFix={() => fixAi(current)} onExplain={() => explainAi(current)} onDetails={() => setTab("issues")} />} />
          </Tabs.Content>
      </Container>
    </Tabs.Root>
  );
}

// ───────── List ─────────
function RuleList({ title, groups, selected, onSelect, prio, empty }: {
  title?: string; groups: { rule: string; items: Instance[] }[]; selected?: Instance; onSelect: (k: number) => void; prio: (s: string) => string; empty?: string;
}) {
  return (
    <Stack gap="1">
      {title && (
        <HStack textStyle="xs" color="fg.muted" fontWeight="medium" mb="1">
          <Text>{title}</Text><Text ms="auto" fontVariantNumeric="tabular-nums">{groups.reduce((n, g) => n + g.items.length, 0)}</Text>
        </HStack>
      )}
      {groups.length === 0 && empty && <Text textStyle="sm" color="fg.subtle">{empty}</Text>}
      {groups.map(({ rule, items }) => {
        const r = RULE_CATALOG[rule];
        const on = selected?.rule === rule && items.some((it) => it.k === selected.k);
        return (
          <HStack key={rule} as="button" gap="2.5" px="2.5" py="2" mx="-2.5" rounded="l2" textAlign="start"
            bg={on ? "bg.muted" : undefined} _hover={{ bg: "bg.muted" }} onClick={() => onSelect(items[0].k)} aria-current={on || undefined}
            aria-label={`${prio(r.severity)}, ${SEV[r.severity].label}: ${r.title}, ${items.length} element${items.length > 1 ? "s" : ""}${items[0].status === "new" ? ", new" : ""}`}>
            <Text textStyle="xs" fontWeight="medium" color={r.severity === "critical" ? "red.fg" : r.severity === "serious" ? "orange.fg" : "fg.muted"} w="5" flexShrink={0} fontVariantNumeric="tabular-nums">{prio(r.severity)}</Text>
            <Text textStyle="sm" flex="1" truncate fontWeight={on ? "medium" : undefined}>{r.title}</Text>
            {items[0].status === "new" && <Text textStyle="xs" color="green.fg">New</Text>}
            <Text textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums">{items.length}</Text>
          </HStack>
        );
      })}
    </Stack>
  );
}

// ───────── Selected issue ─────────
function IssueView({ it, siblings, html, origin, page, onSelect, onShow, onFix, onExplain, link }: {
  it: Instance; siblings: Instance[]; html: string; origin: string; page: PageV;
  onSelect: (k: number) => void; onShow: () => void; onFix: () => void; onExplain: () => void; link: string;
}) {
  const r = RULE_CATALOG[it.rule];
  const idx = siblings.findIndex((x) => x.k === it.k);
  return (
    <Stack gap="5" maxW="3xl" minW="0" css={{ containerType: "inline-size", containerName: "issue-detail" }}>
      <HStack gap="3" align="center" wrap="wrap" justify="space-between" css={{
        "@container issue-detail (max-width: 560px)": { flexDirection: "column", alignItems: "stretch", "& > .issue-actions": { marginInlineStart: "0" } },
      }}>
        <Stack gap="1.5" flex="1" minW="min(100%, 18rem)">
          <RuleTitle rule={r} size="md" />
          <RuleMeta rule={r}>
            {it.status === "new" && <Text color="green.fg">· New in this crawl</Text>}
            {it.status === "fixed" && <Text>· Fixed in this crawl</Text>}
          </RuleMeta>
        </Stack>
        {it.status !== "fixed" && <Box className="issue-actions" flexShrink={0} ms="auto" w="fit-content">
          <IssueActions it={it} page={page} onFix={onFix} onExplain={onExplain} link={link} size="xs" />
        </Box>}
      </HStack>

      {/* Evidence: a labelled crop of the actual element, with inspectable markup. */}
      <Stack gap="2">
        <Box borderWidth="1px" rounded="l2" overflow="hidden">
          <HStack px="3" py="2" gap="2" wrap="wrap" bg="bg.subtle" borderBottomWidth="1px" colorPalette="gray" css={{
            "@container issue-detail (max-width: 420px)": { "& > .preview-label": { flexBasis: "100%" } },
          }}>
            <Stack className="preview-label" gap="0" flex="1" minW="24">
              <Text textStyle="sm" fontWeight="medium">{it.onPage ? "Element preview" : "Element HTML"}</Text>
            </Stack>
            {siblings.length > 1 && (
              <HStack gap="0" flexShrink={0} color="fg.muted">
                <IconButton size="2xs" variant="ghost" aria-label="Previous element" disabled={idx <= 0} onClick={() => onSelect(siblings[idx - 1].k)}><LuChevronLeft /></IconButton>
                <Text textStyle="xs" fontVariantNumeric="tabular-nums" px="1">{idx + 1} of {siblings.length}</Text>
                <IconButton size="2xs" variant="ghost" aria-label="Next element" disabled={idx >= siblings.length - 1} onClick={() => onSelect(siblings[idx + 1].k)}><LuChevronRight /></IconButton>
              </HStack>
            )}
            {it.onPage && <Button size="xs" variant="outline" color="fg.muted" onClick={onShow} flexShrink={0}>Show on page</Button>}
          </HStack>
          {it.onPage && <PagePreview html={html} origin={origin} instances={[it]} selected={it.k} crop={it.k} height={180} />}
          <Collapsible.Root defaultOpen={!it.onPage}>
            <Collapsible.Trigger asChild>
              <HStack as="button" w="full" px="3" py="2.5" gap="2" textAlign="start" borderTopWidth={it.onPage ? "1px" : "0"} bg="bg.subtle" color="fg.muted" _hover={{ color: "fg" }}>
                <Text textStyle="xs" fontWeight="medium" flexShrink={0}>HTML</Text>
                <Text textStyle="xs" fontFamily="mono" truncate flex="1" title={it.selector}>{it.selector}</Text>
                <Collapsible.Indicator _open={{ transform: "rotate(180deg)" }}><LuChevronDown size={14} /></Collapsible.Indicator>
              </HStack>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <CopySnippet key={it.k} text={it.snippet} />
            </Collapsible.Content>
          </Collapsible.Root>
        </Box>
        {it.shared != null && <Text textStyle="xs" color="fg.muted">
          Shared across {it.shared.toLocaleString("en-US")} pages · fix in the template
        </Text>}
      </Stack>

      <RuleGuide rule={r} />
    </Stack>
  );
}

function CopySnippet({ text }: { text: string }) {
  const [copied, copy] = useCopy(text);
  return <HStack asChild w="full" align="start" gap="3" px="3" py="3" borderTopWidth="1px" bg="bg" color="fg" textAlign="start" cursor="pointer"
    _hover={{ bg: "bg.muted" }} _focusVisible={{ outline: "2px solid", outlineColor: "border.emphasized", outlineOffset: "-2px" }}>
    <button type="button" onClick={copy} aria-label={copied ? "HTML copied" : "Copy HTML"}>
      <Code flex="1" minW="0" whiteSpace="pre-wrap" wordBreak="break-all" textStyle="xs" bg="transparent" color="inherit" p="0">{text}</Code>
      <Box color="fg.muted" flexShrink={0} mt="0.5">{copied ? <LuCheck size={14} /> : <LuCopy size={14} />}</Box>
    </button>
  </HStack>;
}

// Filter: priority and category, as checkboxes in one menu (empty = everything)
function FilterMenu({ pri, setPri, cats, setCats }: { pri: Priority[]; setPri: (v: Priority[]) => void; cats: string[]; setCats: (v: string[]) => void }) {
  const n = pri.length + cats.length;
  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Menu.Root closeOnSelect={false} positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <NavAction w="9" minW="9" px="0" position="relative" bg={n ? "bg.muted" : "transparent"} aria-label={`Filter${n ? `, ${n} active` : ""}`}>
          <LuFilter />
          {n > 0 && <Box as="span" position="absolute" top="-1" right="-1" minW="4" h="4" px="1" rounded="full" bg="fg" color="bg" fontSize="10px" lineHeight="4">{n}</Box>}
        </NavAction>
      </Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content minW="52" colorPalette="gray" p="1" shadow="md">
        <Menu.ItemGroup>
          <Menu.ItemGroupLabel textStyle="xs" fontWeight="medium" color="fg.muted">Priority</Menu.ItemGroupLabel>
          {PRIORITIES.map((p) => (
            <Menu.CheckboxItem key={p} value={p} checked={pri.includes(p)} onCheckedChange={() => toggle(pri, p, setPri)}>{p}<Menu.ItemIndicator /></Menu.CheckboxItem>
          ))}
        </Menu.ItemGroup>
        <Menu.Separator />
        <Menu.ItemGroup>
          <Menu.ItemGroupLabel textStyle="xs" fontWeight="medium" color="fg.muted">Category</Menu.ItemGroupLabel>
          {CATEGORIES.map((c) => (
            <Menu.CheckboxItem key={c.id} value={c.id} checked={cats.includes(c.id)} onCheckedChange={() => toggle(cats, c.id, setCats)}>{c.label}<Menu.ItemIndicator /></Menu.CheckboxItem>
          ))}
        </Menu.ItemGroup>
        {n > 0 && <><Menu.Separator /><Menu.Item value="clear" onClick={() => { setPri([]); setCats([]); }}>Clear filters</Menu.Item></>}
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
  );
}

// Export: the issues currently in the list, for handing off to a person, an AI tool or a script
function ExportMenu({ count, onAsk, onPrompt, onJson, onApi, onLink }: { count: number; onAsk: () => void; onPrompt: () => void; onJson: () => void; onApi: () => void; onLink: () => void }) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild><NavAction w="9" minW="9" px="0" aria-label="Export these issues"><LuDownload /></NavAction></Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content minW="52" colorPalette="gray" p="1" shadow="md">
        <Menu.ItemGroup>
          <Menu.ItemGroupLabel textStyle="xs" fontWeight="medium" color="fg.muted">{count} issue{count === 1 ? "" : "s"}</Menu.ItemGroupLabel>
          <Menu.Item value="ask" onClick={onAsk} disabled={!count}><LuSparkles />Summarize with AI</Menu.Item>
          <Menu.Item value="prompt" onClick={onPrompt}><LuCopy />Copy prompt</Menu.Item>
          <Menu.Item value="json" onClick={onJson}><LuDownload />Download JSON</Menu.Item>
          <Menu.Item value="api" onClick={onApi}><LuTerminal />Copy API request</Menu.Item>
          <Menu.Item value="link" onClick={onLink}><LuLink />Copy view link</Menu.Item>
        </Menu.ItemGroup>
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
  );
}

// The actions on an issue, the same in the Issues tab and on the element in Preview
function IssueActions({ it, page, onFix, onExplain, onShowCode, link, size, children }: {
  it: Instance; page: PageV; onFix: () => void; onExplain: () => void; onShowCode?: () => void; link: string; size: "xs" | "sm"; children?: React.ReactNode;
}) {
  return (
    <HStack gap="1" wrap="wrap" colorPalette="gray">
      <Button size={size} variant="subtle" color="fg" onClick={onFix}>Fix with AI</Button>
      <Button size={size} variant="ghost" color="fg.muted" aria-label="Explain with AI" onClick={onExplain}>Explain</Button>
      {children}
      <Menu.Root positioning={{ placement: "bottom-end", gutter: 4 }}>
        <Menu.Trigger asChild><IconButton size={size} variant="ghost" color="fg.muted" ms="auto" aria-label="More actions"><LuEllipsis /></IconButton></Menu.Trigger>
        <Portal><Menu.Positioner><Menu.Content minW="48" p="1" colorPalette="gray" textStyle="xs" shadow="md">
          {onShowCode && <><Menu.Item value="source" onClick={onShowCode}><LuCode />Show in code</Menu.Item><Menu.Separator /></>}
          <Menu.Item value="link" onClick={() => navigator.clipboard.writeText(link)}><LuLink />Copy issue link</Menu.Item>
          <Menu.Item value="copy" onClick={() => navigator.clipboard.writeText(issuePrompt(page, it))}><LuCopy />Copy prompt</Menu.Item>
          <Menu.Item value="check" onClick={() => navigator.clipboard.writeText(localCheck(page, it))}><LuTerminal />Copy check command</Menu.Item>
        </Menu.Content></Menu.Positioner></Portal>
      </Menu.Root>
    </HStack>
  );
}

// Card attached to the selected element in Preview (like a design tool's selection toolbar)
function ElementCard({ it, siblings, page, onSelect, onFix, onExplain, onDetails, onShowCode, prio, link, showExplanation = false }: {
  it: Instance; siblings: Instance[]; page: PageV; onSelect: (k: number) => void; onFix: () => void; onExplain: () => void; onDetails: () => void; onShowCode?: () => void;
  prio: (s: string) => string; link: string; showExplanation?: boolean;
}) {
  const r = RULE_CATALOG[it.rule];
  const idx = siblings.findIndex((x) => x.k === it.k);
  return (
    <Stack gap="0" w="380px" maxW="calc(100vw - 24px)" maxH="calc(100dvh - 24px)" overflowY="auto" bg="bg" color="fg" colorPalette="gray" borderWidth="1px" rounded="l2" shadow="md" textAlign="start">
      <HStack gap="2" align="center" px="3" py="2.5">
        <HStack gap="1.5" flexShrink={0} title={`${prio(r.severity)} · ${SEV[r.severity].label}`}>
          <Box boxSize="2" rounded="full" bg={`${SEV[r.severity].color}.solid`} />
          <Text textStyle="xs" fontWeight="semibold" color={`${SEV[r.severity].color}.fg`}>{prio(r.severity)}</Text>
        </HStack>
        <Text textStyle="sm" fontWeight="medium" lineClamp={2} flex="1" minW="0">{r.title}</Text>
        {siblings.length > 1 && (
          <HStack gap="0" flexShrink={0} textStyle="xs" color="fg.muted">
            <IconButton size="2xs" variant="ghost" aria-label="Previous element" disabled={idx <= 0} onClick={() => onSelect(siblings[idx - 1].k)}><LuChevronLeft /></IconButton>
            <Text fontVariantNumeric="tabular-nums">{idx + 1}/{siblings.length}</Text>
            <IconButton size="2xs" variant="ghost" aria-label="Next element" disabled={idx >= siblings.length - 1} onClick={() => onSelect(siblings[idx + 1].k)}><LuChevronRight /></IconButton>
          </HStack>
        )}
      </HStack>
      {showExplanation && <Text px="3" pb="3" textStyle="sm" color="fg.muted">{r.why}</Text>}
      <Box px="2" py="1.5" borderTopWidth="1px">
        <IssueActions it={it} page={page} onFix={onFix} onExplain={onExplain} onShowCode={onShowCode} link={link} size="xs">
          <Button size="xs" variant="ghost" color="fg.muted" onClick={onDetails}>Details</Button>
        </IssueActions>
      </Box>
    </Stack>
  );
}
