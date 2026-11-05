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
import { LuChevronDown, LuChevronLeft, LuChevronRight, LuCopy, LuDownload, LuEllipsis, LuExternalLink, LuFileQuestion, LuFilter, LuLayers, LuLink, LuSearch, LuSparkles, LuTerminal } from "react-icons/lu";

import { useAssistant } from "@/components/assistant";
import { BackLink, RuleGuide, RuleMeta, RuleTitle } from "@/components/rule-ui";
import { PagePreview, type Layer } from "@/components/page-preview";
import { useSite } from "@/components/site-context";
import { Tooltip } from "@/components/ui/tooltip";
import {
  RULE_CATALOG, SEVERITIES, apiRequest, batchPrompt, issuePrompt, issuesJson, localCheck, pageIssues, sevRank, sourceLines, type Instance,
} from "@/lib/page-issues";
import { PRIORITIES, PRIORITY, type Priority } from "@/lib/priority";
import { explainSeed, fixSeed, summarizeSeed } from "@/lib/refs";
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

  // Ask AI: the buttons write the prompt into the global assistant, where the user sees all of it
  const { send } = useAssistant();
  const fixAi = (it: Instance) => send(fixSeed(site, p, it));
  const explainAi = (it: Instance) => send(explainSeed(site, p, it));

  return (
    <Box>
      <Box borderBottomWidth="1px">
        <Container maxW="7xl" pt="5" pb="4">
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
        </Container>
      </Box>

      <Container maxW="7xl" pt="2" pb="10">
        <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as typeof tab)} variant="line" size="sm">
          <Tabs.List>
            <Tabs.Trigger value="issues">Issues <Span color="fg.muted" fontVariantNumeric="tabular-nums">{now.length}</Span></Tabs.Trigger>
            <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
            <Tabs.Trigger value="source">Source</Tabs.Trigger>
          </Tabs.List>

          {/* ───────── Issues ───────── */}
          <Tabs.Content value="issues" pt="5">
            <Grid templateColumns={{ base: "1fr", md: "300px 1fr" }} gap={{ base: "6", md: "8" }} alignItems="start">
              <Stack gap="4" position={{ md: "sticky" }} top={{ md: "calc(var(--sticky-top, 4rem) + 1rem)" }}>
                <Stack gap="2">
                  <HStack gap="1.5">
                    <InputGroup startElement={<LuSearch />} flex="1">
                      <Input size="sm" placeholder="Search issues" value={q} onChange={(e) => setQ(e.target.value)} />
                    </InputGroup>
                    <FilterMenu pri={pri} setPri={setPri} cats={cats} setCats={setCats} />
                    <ExportMenu count={visible.filter((it) => it.status !== "fixed").length}
                      onAsk={() => send(summarizeSeed(site, p, visible.filter((it) => it.status !== "fixed")))}
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

              <Box minW="0" borderStartWidth={{ md: "1px" }} ps={{ md: "8" }}>
                {current
                  ? <IssueView it={current} siblings={siblings} html={html} origin={origin} page={p} link={linkTo(current)} onSelect={setSelected}
                      onShow={() => { setTab("preview"); setHighlightRule(current.rule); }} onFix={() => fixAi(current)} onExplain={() => explainAi(current)} />
                  : <Text textStyle="sm" color="fg.muted">No issues match.</Text>}
              </Box>
            </Grid>
          </Tabs.Content>

          {/* ───────── Preview ───────── */}
          <Tabs.Content value="preview" pt="4">
            <HStack gap="2" mb="3" wrap="wrap">
              <SegmentGroup.Root size="xs" value={String(viewport)} onValueChange={(e) => setViewport(Number(e.value))}>
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={VIEWPORTS} />
              </SegmentGroup.Root>
              <Menu.Root closeOnSelect={false}>
                <Menu.Trigger asChild>
                  <Button size="xs" variant="outline"><LuLayers />Layers{layers.length > 1 ? ` · ${layers.length - 1}` : ""}</Button>
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
            </HStack>
            <Box maxW={viewport < 1280 ? `${viewport + 2}px` : "5xl"} mx="auto">
              <PagePreview html={html} origin={origin} instances={visible.filter((it) => it.onPage)} selected={current?.k ?? null} highlightRule={highlightRule}
                onSelect={setSelected} viewport={viewport} layers={layers}
                card={current && (
                  <ElementCard it={current} siblings={siblings} page={p} onSelect={setSelected} prio={prio} link={linkTo(current)}
                    onFix={() => fixAi(current)} onExplain={() => explainAi(current)} onDetails={() => setTab("issues")} />
                )} />
            </Box>
          </Tabs.Content>

          {/* ───────── Source ───────── */}
          <Tabs.Content value="source" pt="4">
            <SourceView html={html} instances={visible} selected={current?.k ?? null} onSelect={setSelected} />
          </Tabs.Content>
        </Tabs.Root>
      </Container>

    </Box>
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
    <Stack gap="6" maxW="3xl">
      <Stack gap="1.5">
        <RuleTitle rule={r} size="md" />
        <RuleMeta rule={r}>
          {it.status === "new" && <Text color="green.fg">· New in this crawl</Text>}
          {it.status === "fixed" && <Text>· Fixed in this crawl</Text>}
        </RuleMeta>
      </Stack>

      {/* The element */}
      <Stack gap="2">
        <HStack textStyle="xs" color="fg.muted" gap="1">
          <Text fontFamily="mono" truncate flex="1" title={it.selector}>{it.selector}</Text>
          {siblings.length > 1 && (
            <HStack gap="0" flexShrink={0}>
              <IconButton size="2xs" variant="ghost" aria-label="Previous element" disabled={idx <= 0} onClick={() => onSelect(siblings[idx - 1].k)}><LuChevronLeft /></IconButton>
              <Text fontVariantNumeric="tabular-nums" px="1">{idx + 1} of {siblings.length}</Text>
              <IconButton size="2xs" variant="ghost" aria-label="Next element" disabled={idx >= siblings.length - 1} onClick={() => onSelect(siblings[idx + 1].k)}><LuChevronRight /></IconButton>
            </HStack>
          )}
          {it.onPage && <Button size="2xs" variant="ghost" onClick={onShow} flexShrink={0}>Show on page</Button>}
        </HStack>
        <Box borderWidth="1px" rounded="l2" overflow="hidden">
          {it.onPage && <Box borderBottomWidth="1px"><PagePreview html={html} origin={origin} instances={[it]} selected={it.k} crop={it.k} height={140} /></Box>}
          <Code display="block" whiteSpace="pre-wrap" wordBreak="break-all" px="3" py="2.5" textStyle="xs" bg="bg.subtle" rounded="0">{it.snippet}</Code>
        </Box>
        <HStack gap="1.5" textStyle="xs" color="fg.muted" wrap="wrap">
          {it.shared != null ? <Text>Same markup on {it.shared.toLocaleString("en-US")} pages: one fix covers all of them</Text> : <Text>Only on this page</Text>}
        </HStack>
      </Stack>

      <RuleGuide rule={r} actions={it.status !== "fixed" && <IssueActions it={it} page={page} onFix={onFix} onExplain={onExplain} link={link} size="sm" />} />
    </Stack>
  );
}

// Filter: priority and category, as checkboxes in one menu (empty = everything)
function FilterMenu({ pri, setPri, cats, setCats }: { pri: Priority[]; setPri: (v: Priority[]) => void; cats: string[]; setCats: (v: string[]) => void }) {
  const n = pri.length + cats.length;
  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Menu.Root closeOnSelect={false} positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button size="sm" variant={n ? "subtle" : "outline"} px="2.5" aria-label={`Filter${n ? `, ${n} active` : ""}`}><LuFilter />{n ? n : null}</Button>
      </Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content minW="52">
        <Menu.ItemGroup>
          <Menu.ItemGroupLabel>Priority</Menu.ItemGroupLabel>
          {PRIORITIES.map((p) => (
            <Menu.CheckboxItem key={p} value={p} checked={pri.includes(p)} onCheckedChange={() => toggle(pri, p, setPri)}>{p}<Menu.ItemIndicator /></Menu.CheckboxItem>
          ))}
        </Menu.ItemGroup>
        <Menu.Separator />
        <Menu.ItemGroup>
          <Menu.ItemGroupLabel>Category</Menu.ItemGroupLabel>
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
      <Menu.Trigger asChild><IconButton size="sm" variant="outline" aria-label="Export these issues"><LuDownload /></IconButton></Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content minW="60">
        <Menu.ItemGroup>
          <Menu.ItemGroupLabel>{count} issue{count === 1 ? "" : "s"} in this list</Menu.ItemGroupLabel>
          <Menu.Item value="ask" onClick={onAsk} disabled={!count}><LuSparkles />Summarize with AI</Menu.Item>
          <Menu.Item value="prompt" onClick={onPrompt}><LuCopy />Copy as one prompt</Menu.Item>
          <Menu.Item value="json" onClick={onJson}><LuDownload />Download JSON</Menu.Item>
          <Menu.Item value="api" onClick={onApi}><LuTerminal />Copy API request</Menu.Item>
          <Menu.Item value="link" onClick={onLink}><LuLink />Copy link to this view</Menu.Item>
        </Menu.ItemGroup>
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
  );
}

// The actions on an issue, the same in the Issues tab and on the element in Preview
function IssueActions({ it, page, onFix, onExplain, link, size, children }: {
  it: Instance; page: PageV; onFix: () => void; onExplain: () => void; link: string; size: "xs" | "sm"; children?: React.ReactNode;
}) {
  return (
    <HStack gap="1.5">
      <Button size={size} variant="outline" onClick={onFix}><LuSparkles />Fix with AI</Button>
      <Button size={size} variant="ghost" onClick={onExplain}>Explain with AI</Button>
      {children}
      <Menu.Root>
        <Menu.Trigger asChild><IconButton size={size} variant="ghost" aria-label="More actions"><LuEllipsis /></IconButton></Menu.Trigger>
        <Portal><Menu.Positioner><Menu.Content>
          <Menu.Item value="link" onClick={() => navigator.clipboard.writeText(link)}><LuLink />Copy link to this issue</Menu.Item>
          <Menu.Item value="copy" onClick={() => navigator.clipboard.writeText(issuePrompt(page, it))}><LuCopy />Copy as prompt</Menu.Item>
          <Menu.Item value="check" onClick={() => navigator.clipboard.writeText(localCheck(page, it))}><LuTerminal />Copy local check command</Menu.Item>
        </Menu.Content></Menu.Positioner></Portal>
      </Menu.Root>
    </HStack>
  );
}

// Card attached to the selected element in Preview (like a design tool's selection toolbar)
function ElementCard({ it, siblings, page, onSelect, onFix, onExplain, onDetails, prio, link }: {
  it: Instance; siblings: Instance[]; page: PageV; onSelect: (k: number) => void; onFix: () => void; onExplain: () => void; onDetails: () => void;
  prio: (s: string) => string; link: string;
}) {
  const r = RULE_CATALOG[it.rule];
  const idx = siblings.findIndex((x) => x.k === it.k);
  return (
    <Stack gap="2.5" w="380px" p="3" bg="bg" color="fg" borderWidth="1px" rounded="l2" shadow="lg" textAlign="start">
      <HStack gap="2" align="start">
        <Box mt="1.5"><SevDot sev={r.severity} /></Box>
        <Stack gap="0" flex="1" minW="0">
          <Text textStyle="sm" fontWeight="medium" lineClamp={2}>{r.title}</Text>
          <Text textStyle="xs" color="fg.muted">{prio(r.severity)} · {SEV[r.severity].label}</Text>
        </Stack>
        {siblings.length > 1 && (
          <HStack gap="0" flexShrink={0} textStyle="xs" color="fg.muted">
            <IconButton size="2xs" variant="ghost" aria-label="Previous element" disabled={idx <= 0} onClick={() => onSelect(siblings[idx - 1].k)}><LuChevronLeft /></IconButton>
            <Text fontVariantNumeric="tabular-nums">{idx + 1}/{siblings.length}</Text>
            <IconButton size="2xs" variant="ghost" aria-label="Next element" disabled={idx >= siblings.length - 1} onClick={() => onSelect(siblings[idx + 1].k)}><LuChevronRight /></IconButton>
          </HStack>
        )}
      </HStack>
      <IssueActions it={it} page={page} onFix={onFix} onExplain={onExplain} link={link} size="xs">
        <Button size="xs" variant="ghost" onClick={onDetails}>Details</Button>
      </IssueActions>
    </Stack>
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
    <Box borderWidth="1px" rounded="l2" overflow="auto" maxH="calc(100vh - 14rem)" fontFamily="mono" textStyle="xs">
      {lines.map((l, n) => {
        const m = marks.get(n);
        const on = n === selLine;
        return (
          <Flex key={n} ref={on ? ref : undefined} bg={on ? "bg.emphasized" : undefined} minW="max-content">
            <Text w="10" flexShrink={0} textAlign="right" pe="3" color="fg.subtle" userSelect="none">{n + 1}</Text>
            <Box w="4" flexShrink={0}>
              {m && <Tooltip content={m.map((it) => RULE_CATALOG[it.rule].title).join(", ")}>
                <Box as="button" w="1.5" h="1.5" mt="1.5" rounded="full" bg={`${SEV[RULE_CATALOG[m[0].rule].severity].color}.solid`} onClick={() => onSelect(m[0].k)} aria-label="Select issue" />
              </Tooltip>}
            </Box>
            <Text whiteSpace="pre" pe="4" color={m || on ? "fg" : "fg.muted"}>{l}</Text>
          </Flex>
        );
      })}
    </Box>
  );
}

const SevDot = ({ sev }: { sev: string }) => <Box w="2" h="2" rounded="full" flexShrink={0} bg={`${SEV[sev].color}.solid`} />;
