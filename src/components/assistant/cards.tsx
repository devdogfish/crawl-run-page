// Components the model can ask for with a ```ui block: one JSON shape, `type` picks the component (COMPONENTS below).
//   fix    {issue, html}              a diff against the original element, with Preview / Source / Copy
//   paste  {issue, label, value}      a value to paste into a Teamsite field
//   issue  {issue}                    one issue: where it is, the failing HTML, why it matters, Fix
//   issues {issues: [ID…], title?}    a table of issues in the model's order; hovering a row shows Fix
//   page   {page}                     one page of the current site: its open issues by priority and category
//   pages  {pages: [ID…], title?}     a table of pages with their open issues
// The tables copy and export (.csv) what they show. Quick replies ({"type": "choice"}) aren't cards: the message takes
// them out of the text and shows them under the newest answer (splitChoices).
// Adding a component is one entry in COMPONENTS plus one line in both system prompts (src/lib/refs.ts and
// backend/crawler_ai/prompts.py). A renderer returns null when the data doesn't fit, and the block shows as code.
// Everything shown comes from the id, not from the model.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Link as RouterLink, useLocation } from "react-router";
import { Box, Button, HStack, IconButton, Stack, Table, Text } from "@chakra-ui/react";
import { LuCheck, LuCopy, LuDownload, LuWandSparkles } from "react-icons/lu";

import { downloadText } from "@/components/data-toolbar";
import { Tooltip } from "@/components/ui/tooltip";
import { fixMessage, resolveIssue } from "@/lib/refs";
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_DOT } from "@/lib/priority";
import { issueSlots } from "@/lib/page-issues";
import { baselinesFor, currentIssueCounts, defaultCrawl, pageView, typeLabel } from "@/lib/site-pages";
import { DEFAULT_SITE, type SiteId } from "@/lib/sites";
import { siteIn } from "./route";
import { CodeBlock } from "./code-block";
import { CopyTextButton, useCopy } from "./common";
import { Dot, sevColor } from "./chips";

type UiData = { type?: unknown; [k: string]: unknown };
const ids = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" || typeof x === "number").map(String))].slice(0, MAX_IDS) : [];
const title = (d: UiData) => typeof d.title === "string" && d.title.trim() ? d.title : undefined;
const COMPONENTS: Record<string, (d: UiData) => React.ReactNode | null> = {
  fix: (d) => {
    const r = d.issue != null ? resolveIssue(String(d.issue)) : null;
    return r && typeof d.html === "string" ? <FixCard r={r} after={d.html} /> : null;
  },
  paste: (d) => {
    const r = d.issue != null ? resolveIssue(String(d.issue)) : null;
    return typeof d.value === "string" ? <PasteCard r={r} label={typeof d.label === "string" ? d.label : "Value"} value={d.value} /> : null;
  },
  issue: (d) => {
    const r = d.issue != null ? resolveIssue(String(d.issue)) : null;
    return r ? <IssueCard r={r} /> : null;
  },
  issues: (d) => {
    const list = ids(d.issues);
    return list.length ? <IssuesTable ids={list} title={title(d)} /> : null;
  },
  page: (d) => /^\d+$/.test(String(d.page ?? "")) ? <PageCard id={Number(d.page)} /> : null,
  pages: (d) => {
    const list = ids(d.pages).filter((id) => /^\d+$/.test(id));
    return list.length ? <PagesTable ids={list} title={title(d)} /> : null;
  },
};

// How cards talk back to the conversation: `send` puts a message in (absent where there's no conversation to add to,
// like the rule window), `busy` while an answer is being written.
export const UiActions = createContext<{ send?: (q: string) => void; busy?: boolean }>({});

export function UiBlock({ body }: { body: string }) {
  let data: UiData | null = null;
  try { data = JSON.parse(body); } catch { /* shown as code below */ }
  const render = data && typeof data.type === "string" ? COMPONENTS[data.type] : undefined;
  return render?.(data!) ?? <CodeBlock code={body} lang="ui" />;
}

// A block that is still being written: say what's coming once its type has streamed in
const PENDING: Record<string, string> = {
  fix: "Preparing the fix…", paste: "Preparing the value…", issue: "Looking up the issue…", issues: "Listing the issues…",
  page: "Looking at the page…", pages: "Listing the pages…", choice: "",
};
export function UiPending({ body = "" }: { body?: string }) {
  const type = /"type"\s*:\s*"(\w+)"/.exec(body)?.[1];
  // nothing until the type has streamed in, so a block that turns out to be quiet (choice) doesn't flash a label
  const label = type == null ? "" : PENDING[type] ?? "Preparing…";
  return label ? <Text textStyle="xs" color="fg.muted" py="1">{label}</Text> : null;
}

// Takes the finished {"type": "choice"} blocks out of an answer: the text without them, and their options (at most five)
const UI_FENCE = /\n?```ui[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/g;
export function splitChoices(text: string): { text: string; options: string[] } {
  const options: string[] = [];
  const rest = text.replace(UI_FENCE, (block, body: string) => {
    let d: UiData | null = null;
    try { d = JSON.parse(body); } catch { return block; }
    if (d?.type !== "choice" || !Array.isArray(d.options)) return block;
    for (const o of d.options) if (typeof o === "string" && o.trim() && !options.includes(o.trim())) options.push(o.trim());
    return "";
  });
  return { text: rest.trimEnd(), options: options.slice(0, 5) };
}

// The issue a card is about: severity, priority and title, the title linking to it
type Resolved = NonNullable<ReturnType<typeof resolveIssue>>;
function IssueHeader({ r }: { r: Resolved }) {
  return (
    <HStack gap="2" minW="0">
      <Dot color={sevColor(r.rule.severity)} />
      <Text textStyle="xs" fontWeight="semibold" flexShrink={0} color={PRIORITY_COLOR[r.priority]}>{r.priority}</Text>
      <Text textStyle="sm" fontWeight="medium" truncate>
        <Box asChild color="fg" textDecoration="none" _hover={{ textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1px" }}>
          <RouterLink to={r.href()}>{r.rule.title}</RouterLink>
        </Box>
      </Text>
    </HStack>
  );
}

const card = { borderWidth: "1px", rounded: "l3", p: "3", gap: "2.5", bg: "bg" } as const;

// A value to paste into a form field of the CMS (Teamsite): which issue, which field, the value, Copy
function PasteCard({ r, label, value }: { r: Resolved | null; label: string; value: string }) {
  return (
    <Stack {...card}>
      {r && <IssueHeader r={r} />}
      <Stack gap="1">
        <Text textStyle="xs" color="fg.muted" truncate>{label}{r ? ` · ${r.page.path}` : ""}</Text>
        <Box position="relative" borderWidth="1px" rounded="l2" bg="bg.subtle" ps="2.5" pe="14" py="2" textStyle="sm" whiteSpace="pre-wrap" wordBreak="break-word">
          {value}
          <Box position="absolute" top="1" right="1"><CopyTextButton text={value} /></Box>
        </Box>
      </Stack>
    </Stack>
  );
}

// The fix: which issue, where it is, the diff, and the other views of the same element
function FixCard({ r, after }: { r: Resolved; after: string }) {
  return (
    <Stack borderWidth="1px" rounded="l2" overflow="hidden" gap="0" bg="bg">
      <HStack px="3" py="2" gap="3" justify="space-between">
        <Text textStyle="xs" fontWeight="medium" truncate title={`${r.it.selector} · ${r.page.path}`}>{r.rule.title}</Text>
        <HStack gap="3" flexShrink={0} textStyle="xs" color="fg.muted">
          {r.it.onPage && <Box asChild _hover={{ color: "fg", textDecoration: "underline" }}>
            <RouterLink to={r.href("preview")}>Preview</RouterLink>
          </Box>}
          <Box asChild _hover={{ color: "fg", textDecoration: "underline" }}>
            <RouterLink to={r.href("source")}>Source</RouterLink>
          </Box>
        </HStack>
      </HStack>
      <Diff before={r.it.snippet} after={after} />
    </Stack>
  );
}

const rowLink = { color: "fg", textDecoration: "none", _hover: { textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1px" } } as const;
const quietLink = { _hover: { color: "fg", textDecoration: "underline" } } as const;

// The site the user is in (the prototype's default site on the home screen), like the @page chip
function useCurrentSite(): SiteId {
  const { pathname } = useLocation();
  return siteIn(pathname) || DEFAULT_SITE;
}

// Fix: "Fix @issue:ID" as the user's next message; the model looks the issue up
function FixButton({ r, ...rest }: { r: Resolved } & React.ComponentProps<typeof Button>) {
  const { send, busy } = useContext(UiActions);
  if (!send) return null;
  return (
    <Button size="2xs" variant="outline" colorPalette="gray" disabled={busy} onClick={() => send(fixMessage(r.id))} {...rest}>
      <LuWandSparkles />Fix
    </Button>
  );
}

// One issue: which, where, the failing HTML, why it matters, and Fix
function IssueCard({ r }: { r: Resolved }) {
  return (
    <Stack {...card}>
      <IssueHeader r={r} />
      <Text textStyle="xs" color="fg.muted" truncate title={`${r.page.path} · ${r.it.selector}`}>
        {r.page.path} · {r.it.selector}
        {r.it.shared ? ` · shared by ${r.it.shared.toLocaleString("en-US")} pages` : ""}
        {r.it.status === "new" ? " · new" : r.it.status === "fixed" ? " · fixed" : ""}
      </Text>
      <Box fontFamily="mono" textStyle="xs" bg="bg.subtle" borderWidth="1px" borderColor="border.muted" rounded="l2" px="2.5" py="1.5"
        whiteSpace="pre-wrap" overflowWrap="anywhere" maxH="32" overflowY="auto">{r.it.snippet}</Box>
      <Text textStyle="sm" color="fg.muted" lineClamp={3}>{r.rule.why}</Text>
      <HStack justify="space-between" gap="3">
        <HStack gap="3" textStyle="xs" color="fg.muted">
          <Box asChild {...quietLink}><RouterLink to={r.href()}>Issue</RouterLink></Box>
          {r.it.onPage && <Box asChild {...quietLink}><RouterLink to={r.href("preview")}>Preview</RouterLink></Box>}
          <Box asChild {...quietLink}><RouterLink to={r.href("source")}>Source</RouterLink></Box>
        </HStack>
        {r.it.status !== "fixed" && <FixButton r={r} />}
      </HStack>
    </Stack>
  );
}

// ───────── Tables ─────────
// For a quick look at a handful of things in the chat, not a replacement for the Issues and Pages screens. So:
//  · rows: the first FOLD_AT, then up to MAX_ROWS on "Show more"; past that, Export has the rest (and the footer says so)
//  · cost: only the rows on screen are resolved; Copy and Export resolve the whole list when clicked. So an id past the
//    shown rows that doesn't exist is only noticed then: counts can include it until it's clicked (rare: ids come from tools)
//  · width: the panel is often 320–400px. The tables are one text column plus narrow extras; under NARROW the extras
//    move under the text (a container query on the card, so it follows the panel, not the window)
const FOLD_AT = 8;
const MAX_ROWS = 25;
const MAX_IDS = 500; // more than any answer should list; keeps Export bounded
const NARROW = "420px";
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");
const toTsv = (rows: unknown[][]) => rows.map((r) => r.map((v) => String(v ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");

// The rows shown so far, and the control for more
function useRows(total: number) {
  const [open, setOpen] = useState(false);
  const shown = Math.min(total, open || total <= FOLD_AT + 1 ? MAX_ROWS : FOLD_AT);
  return { shown, more: open ? 0 : Math.min(total, MAX_ROWS) - shown, onMore: () => setOpen(true) };
}

function TableCard({ title, total, missing, rows, file, fold, children }: {
  title: string; total: number; missing: number; rows: () => unknown[][]; file: string; fold: ReturnType<typeof useRows>; children: React.ReactNode;
}) {
  const [copied, copy] = useCopy(() => toTsv(rows()));
  const hidden = total - fold.shown - fold.more;
  return (
    <Stack borderWidth="1px" rounded="l2" overflow="hidden" gap="0" bg="bg" css={{ containerType: "inline-size" }}>
      <HStack ps="3" pe="1" py="1" gap="2" borderBottomWidth="1px" borderColor="border.muted">
        <Text textStyle="xs" fontWeight="medium" truncate flex="1" title={title}>{title}</Text>
        <Text textStyle="xs" color="fg.muted" flexShrink={0}>{total.toLocaleString("en-US")}</Text>
        <HStack gap="0" flexShrink={0}>
          <Tooltip content={copied ? "Copied" : "Copy as a table"}>
            <IconButton size="2xs" variant="ghost" color={copied ? "green.fg" : "fg.muted"} aria-label={copied ? "Copied" : "Copy as a table"} onClick={copy}>
              {copied ? <LuCheck /> : <LuCopy />}
            </IconButton>
          </Tooltip>
          <Tooltip content="Export (.csv)">
            <IconButton size="2xs" variant="ghost" color="fg.muted" aria-label="Export (.csv)" onClick={() => downloadText(toCsv(rows()), file, "text/csv")}>
              <LuDownload />
            </IconButton>
          </Tooltip>
        </HStack>
      </HStack>
      <Table.Root size="sm" variant="line" showColumnBorder={false} css={{ tableLayout: "fixed", "& tr:last-of-type td": { borderBottomWidth: 0 } }}>
        <Table.Body>{children}</Table.Body>
      </Table.Root>
      {fold.more > 0 && (
        <Button size="xs" variant="ghost" colorPalette="gray" rounded="0" color="fg.muted" borderTopWidth="1px" borderColor="border.muted" onClick={fold.onMore}>
          Show {fold.more} more
        </Button>
      )}
      {(hidden > 0 || missing > 0) && (
        <Text textStyle="xs" color="fg.muted" px="3" py="1.5" borderTopWidth="1px" borderColor="border.muted">
          {[hidden > 0 && `${hidden.toLocaleString("en-US")} more aren't shown here. Export has them all.`,
            missing > 0 && `${missing} couldn't be found.`].filter(Boolean).join(" ")}
        </Text>
      )}
    </Stack>
  );
}

const cell = { px: "3", py: "1.5", textStyle: "xs", verticalAlign: "top", overflow: "hidden" } as const;
const narrowOnly = { display: "none", [`@container (max-width: ${NARROW})`]: { display: "flex" } } as const;
const wideOnly = { [`@container (max-width: ${NARROW})`]: { display: "none" } } as const;

// The rows on screen out of a list of ids, resolved only as far as needed; ids that don't resolve are skipped and counted
function useResolved<T>(ids: string[], shown: number, resolve: (id: string) => T | null) {
  return useMemo(() => {
    const out: T[] = [];
    let missing = 0, k = 0;
    for (; k < ids.length && out.length < shown; k++) {
      const v = resolve(ids[k]);
      if (v) out.push(v); else missing++;
    }
    return { rows: out, missing, exhausted: k >= ids.length };
  }, [ids, shown, resolve]);
}

// Fix sits over the end of the row while it's hovered or focused, so it takes no width from the text (the message
// around it is a `group` too, hence the row selector rather than _groupHover). On touch it's always there, under the text.
const fixOnRow = {
  // the row's hover colour behind it, fading the text out just before it
  position: "absolute", insetEnd: "2", top: "50%", transform: "translateY(-50%)", bg: "bg.subtle",
  boxShadow: "-16px 0 10px 2px var(--chakra-colors-bg-subtle)",
  opacity: 0, transition: "opacity 0.15s",
  "tr:hover &, tr:focus-within &": { opacity: 1 },
  "@media (hover: none)": { position: "static", transform: "none", opacity: 1, mt: "1.5", bg: "transparent", boxShadow: "none" },
} as const;

const issueRows = (list: Resolved[]) => [
  ["id", "priority", "rule", "issue", "page", "element", "shared_pages", "status"],
  ...list.map((r) => [r.id, r.priority, r.rule.id, r.rule.title, r.page.url, r.it.selector, r.it.shared ?? "", r.it.status]),
];

// Issues: priority, then the issue and where it is; Fix on the hovered row
function IssuesTable({ ids, title }: { ids: string[]; title?: string }) {
  const fold = useRows(ids.length);
  const { rows: list, missing } = useResolved(ids, fold.shown, resolveIssue);
  if (!list.length) return <CodeBlock code={JSON.stringify({ type: "issues", issues: ids.slice(0, 20) })} lang="ui" />;
  const all = () => issueRows(ids.map((id) => resolveIssue(id)).filter((r): r is Resolved => !!r));
  return (
    <TableCard title={title ?? "Issues"} total={ids.length - missing} missing={missing} rows={all} file={`issues-${list[0].site}.csv`} fold={fold}>
      {list.map((r) => (
        <Table.Row key={r.id} bg="transparent" _hover={{ bg: "bg.subtle" }}>
          <Table.Cell {...cell} w="14" pe="0" whiteSpace="nowrap">
            <HStack gap="1.5"><Dot color={sevColor(r.rule.severity)} /><Text as="span" fontWeight="semibold" color={PRIORITY_COLOR[r.priority]}>{r.priority}</Text></HStack>
          </Table.Cell>
          <Table.Cell {...cell} position="relative">
            <Text textStyle="sm" truncate title={r.rule.title}><Box asChild {...rowLink}><RouterLink to={r.href()}>{r.rule.title}</RouterLink></Box></Text>
            <Text color="fg.muted" truncate title={`${r.page.path} · ${r.it.selector}`}>
              {r.page.path}{r.it.shared ? ` · shared by ${r.it.shared.toLocaleString("en-US")} pages` : ""}
              {r.it.status === "new" ? " · new" : r.it.status === "fixed" ? " · fixed" : ""}
            </Text>
            {r.it.status !== "fixed" && <FixButton r={r} aria-label={`Fix: ${r.rule.title} (${r.it.selector})`} css={fixOnRow} />}
          </Table.Cell>
        </Table.Row>
      ))}
    </TableCard>
  );
}

// A page of the current site and its open issues, counted by priority and category. Building a page's issues is the
// expensive part, so it's done once per page and crawl.
type PageSummary = NonNullable<ReturnType<typeof computePageSummary>>;
const summaries = new Map<string, PageSummary | null>();
function pageSummary(site: SiteId, id: number): PageSummary | null {
  const key = `${site}:${id}:${defaultCrawl(site).id}`;
  if (!summaries.has(key)) summaries.set(key, computePageSummary(site, id));
  return summaries.get(key)!;
}
function computePageSummary(site: SiteId, id: number) {
  const a = Number(defaultCrawl(site).id);
  const b = Number(baselinesFor(site, String(a))[0]?.id ?? NaN);
  const base = Number.isNaN(b) ? null : b;
  const page = pageView(site, id, a, base);
  if (!page || page.change === "removed") return null;
  const counts = currentIssueCounts(page);
  const fresh = new Set(issueSlots(page, a, base).filter((element) => element.status === "new").map(({ rule }) => rule)).size;
  return { page, href: `/${site}/pages/${id}`, open: counts.total, fresh, byPri: counts.byPriority, byCat: counts.byCategory };
}

const CATEGORY_LABEL = { accessibility: "Accessibility", seo: "SEO", security: "Security", performance: "Performance" } as const;

function PriorityCounts({ s, ...rest }: { s: PageSummary } & React.ComponentProps<typeof HStack>) {
  return (
    <HStack gap="2.5" wrap="wrap" {...rest}>
      {PRIORITIES.filter((p) => s.byPri[p]).map((p) => (
        <HStack key={p} gap="1" flexShrink={0}>
          <Dot color={PRIORITY_DOT[p]} />
          <Text as="span" color={PRIORITY_COLOR[p]} fontWeight="semibold">{p}</Text>
          <Text as="span">{s.byPri[p]}</Text>
        </HStack>
      ))}
    </HStack>
  );
}

// One page: what it is, its open issues by priority and by category, and where to look
function PageCard({ id }: { id: number }) {
  const s = pageSummary(useCurrentSite(), id);
  if (!s) return <CodeBlock code={JSON.stringify({ type: "page", page: String(id) })} lang="ui" />;
  return (
    <Stack {...card}>
      <Stack gap="0.5" minW="0">
        <Text textStyle="sm" fontWeight="medium" truncate title={s.page.title}>
          <Box asChild {...rowLink}><RouterLink to={s.href}>{s.page.title}</RouterLink></Box>
        </Text>
        <Text textStyle="xs" color="fg.muted" truncate title={s.page.url}>{typeLabel(s.page.type)} · {s.page.path}</Text>
      </Stack>
      {s.open === 0 ? <Text textStyle="sm" color="fg.muted">No open issues.</Text> : <>
        <HStack gap="2" columnGap="4" textStyle="xs" wrap="wrap">
          <Text fontWeight="medium">{s.open} open{s.fresh ? <Text as="span" color="fg.muted" fontWeight="normal"> · {s.fresh} new</Text> : null}</Text>
          <PriorityCounts s={s} />
        </HStack>
        <Text textStyle="xs" color="fg.muted">
          {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).filter((c) => s.byCat[c]).map((c) => `${CATEGORY_LABEL[c]} ${s.byCat[c]}`).join(" · ")}
        </Text>
      </>}
      <HStack gap="3" textStyle="xs" color="fg.muted">
        <Box asChild {...quietLink}><RouterLink to={s.href}>Issues</RouterLink></Box>
        <Box asChild {...quietLink}><RouterLink to={`${s.href}?tab=preview`}>Preview</RouterLink></Box>
        <Box asChild {...quietLink}><RouterLink to={`${s.href}?tab=source`}>Source</RouterLink></Box>
      </HStack>
    </Stack>
  );
}

// Pages: the page (title, path) and its open issues; the priority breakdown goes under the path when narrow
function PagesTable({ ids, title }: { ids: string[]; title?: string }) {
  const site = useCurrentSite();
  const fold = useRows(ids.length);
  const resolve = useCallback((id: string) => pageSummary(site, Number(id)), [site]);
  const { rows: list, missing } = useResolved(ids, fold.shown, resolve);
  if (!list.length) return <CodeBlock code={JSON.stringify({ type: "pages", pages: ids.slice(0, 20) })} lang="ui" />;
  const all = () => [
    ["url", "title", "type", "open_issues", ...PRIORITIES.map((p) => p.toLowerCase()), "new"],
    ...ids.map(resolve).filter((s): s is PageSummary => !!s)
      .map((s) => [s.page.url, s.page.title, s.page.type, s.open, ...PRIORITIES.map((p) => s.byPri[p]), s.fresh]),
  ];
  return (
    <TableCard title={title ?? "Pages"} total={ids.length - missing} missing={missing} rows={all} file={`pages-${site}.csv`} fold={fold}>
      {list.map((s) => (
        <Table.Row key={s.page.i} bg="transparent" _hover={{ bg: "bg.subtle" }}>
          <Table.Cell {...cell}>
            <Text textStyle="sm" truncate title={s.page.title}><Box asChild {...rowLink}><RouterLink to={s.href}>{s.page.title}</RouterLink></Box></Text>
            <Text color="fg.muted" truncate title={s.page.url}>{s.page.path}</Text>
            {s.open > 0 && <PriorityCounts s={s} mt="0.5" css={narrowOnly} />}
          </Table.Cell>
          <Table.Cell {...cell} w="16" ps="0" textAlign="end" whiteSpace="nowrap" css={{ [`@container (min-width: ${NARROW})`]: { width: "13.5rem" } }}>
            <Text fontWeight="medium">{s.open} open</Text>
            {s.open > 0 && <PriorityCounts s={s} wrap="nowrap" justify="end" css={wideOnly} />}
          </Table.Cell>
        </Table.Row>
      ))}
    </TableCard>
  );
}

// Each section copies the complete original/replacement, never the decorative diff signs.
export function Diff({ before, after }: { before: string; after: string }) {
  return (
    <Stack gap="0" overflow="hidden">
      <DiffSection text={before} kind="before" />
      <DiffSection text={after} kind="after" />
    </Stack>
  );
}

function DiffSection({ text, kind }: { text: string; kind: "before" | "after" }) {
  const [done, copy] = useCopy(text);
  const original = kind === "before";
  const label = original ? "original code" : "replacement code";
  return (
    <Box asChild position="relative" className="group" w="full" textAlign="left" cursor="pointer"
      bg={original ? "red.subtle/60" : "green.subtle/60"} color="fg" px="3" py="1.5"
      borderTopWidth={original ? "0" : "1px"} borderColor="border.muted"
      _hover={{ bg: original ? "red.subtle" : "green.subtle" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "border.emphasized", outlineOffset: "-2px" }}>
      <button type="button" onClick={copy} aria-label={done ? `Copied ${label}` : `Copy ${label}`}>
        <HStack as="span" align="start" gap="2" pe="7" fontFamily="mono" textStyle="xs">
          <Text as="span" color={original ? "red.fg" : "green.fg"} flexShrink={0} aria-hidden>{original ? "−" : "+"}</Text>
          <Text as="span" whiteSpace="pre-wrap" overflowWrap="anywhere" minW="0">{text}</Text>
        </HStack>
        <Box as="span" position="absolute" top="1" right="2" p="1" rounded="l1" color={done ? "green.fg" : "fg.muted"}
          opacity={done ? 1 : 0} _groupHover={{ opacity: 1 }} _groupFocusVisible={{ opacity: 1 }}
          css={{ "@media (hover: none)": { opacity: 1 } }} aria-hidden>
          {done ? <LuCheck size={14} /> : <LuCopy size={14} />}
        </Box>
      </button>
    </Box>
  );
}
