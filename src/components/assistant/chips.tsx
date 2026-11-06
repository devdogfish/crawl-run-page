// Links and reference chips inside the assistant's text.
//   TextLink       an in-app link in running text: plain, underlined softly
//   @issue/@rule/@page/@crawl chips, resolved from the id (src/lib/refs.ts), never from the model's words
import { Children, Fragment, useEffect, useReducer } from "react";
import { Link as RouterLink, useLocation } from "react-router";
import { Box, Code, Text } from "@chakra-ui/react";

import { openRuleEditor } from "@/components/rule-dialog-host";
import { loadRules } from "@/lib/custom-rules";
import { Tooltip } from "@/components/ui/tooltip";
import { SEVERITIES } from "@/lib/page-issues";
import { PRIORITY, PRIORITY_COLOR } from "@/lib/priority";
import { resolveIssue, resolveRule } from "@/lib/refs";
import { CRAWLS, siteName, type CrawlListStatus } from "@/lib/crawls-list";
import { defaultCrawl, pageView } from "@/lib/site-pages";
import { DEFAULT_SITE } from "@/lib/sites";
import { siteIn } from "./route";
import { splitRefs } from "./tokens";

const linkStyle = {
  color: "blue.fg",
  textDecoration: "underline",
  textDecorationThickness: "1px",
  textUnderlineOffset: "3px",
  textDecorationColor: "color-mix(in srgb, currentColor 40%, transparent)",
  _hover: { textDecorationColor: "currentColor" },
} as const;

export function TextLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Box asChild {...linkStyle}><RouterLink to={to}>{children}</RouterLink></Box>;
}

// A chip scales with the text around it (em), so it lines up whether it sits in an answer, a user bubble or the composer.
// Its background and hover come from CSS variables so a surface of the same colour (the user bubble) can set a stronger one.
export const chipStyle = {
  display: "inline-flex", alignItems: "center", gap: "0.45em", maxW: "full", h: "1.65em", px: "0.55em", rounded: "l1",
  bg: "var(--chip-bg, var(--chakra-colors-bg-muted))", boxShadow: "inset 0 0 0 1px var(--chakra-colors-border-muted)",
  fontSize: "0.86em", lineHeight: "1", whiteSpace: "nowrap", verticalAlign: "middle", color: "fg", textDecoration: "none",
  _hover: { bg: "var(--chip-bg-hover, var(--chakra-colors-bg-emphasized))" },
} as const;
const chip = chipStyle;
export const sevColor = (sev: string) => `${SEVERITIES.find((s) => s.id === sev)?.color ?? "gray"}.solid`;
export const Dot = ({ color }: { color: string }) => <Box as="span" display="inline-block" w="0.5em" h="0.5em" rounded="full" bg={color} flexShrink={0} />;

function IssueChip({ id }: { id: string }) {
  const r = resolveIssue(id);
  if (!r) return <Code textStyle="xs" title="Unknown issue">@issue:{id}</Code>;
  return (
    <Tooltip content={`${r.page.path} · ${r.it.selector}`}>
      <Box asChild {...chip} maxW="280px">
        <RouterLink to={r.href()}>
          <Dot color={sevColor(r.rule.severity)} />
          <Text as="span" color={PRIORITY_COLOR[r.priority]} fontWeight="medium" flexShrink={0}>{r.priority}</Text>
          <Text as="span" truncate>{r.rule.title}</Text>
        </RouterLink>
      </Box>
    </Tooltip>
  );
}

function RuleChip({ id }: { id: string }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("crawler:rules-changed", refresh);
    return () => window.removeEventListener("crawler:rules-changed", refresh);
  }, []);
  const { pathname } = useLocation();
  const site = siteIn(pathname) || DEFAULT_SITE;
  const custom = loadRules(site).find((r) => r.id === id);
  if (custom) return <>
    <Box asChild {...chip} maxW="280px" title={custom.pattern}>
      <button type="button" data-assistant-background-action onClick={() => openRuleEditor(site, id)}><Text as="span" truncate>{custom.name}</Text></button>
    </Box>

  </>;
  const r = resolveRule(id);
  if (!r) return <Code textStyle="xs" title="Unknown rule">@rule:{id}</Code>;
  return (
    <Box asChild {...chip} maxW="280px">
      <RouterLink to={`/${siteIn(pathname) || DEFAULT_SITE}/issues/${id}`}>
        <Dot color={sevColor(r.severity)} />
        <Text as="span" color={PRIORITY_COLOR[PRIORITY[r.severity]]} fontWeight="medium" flexShrink={0}>{PRIORITY[r.severity]}</Text>
        <Text as="span" truncate>{r.title}</Text>
      </RouterLink>
    </Box>
  );
}

// @page:ID is a page of the site the user is in (the prototype's default site on the home screen)
function PageChip({ id }: { id: string }) {
  const { pathname } = useLocation();
  const site = siteIn(pathname) || DEFAULT_SITE;
  const page = pageView(site, Number(id), Number(defaultCrawl(site).id), null);
  if (!page) return <Code textStyle="xs" title="Unknown page">@page:{id}</Code>;
  return (
    <Tooltip content={page.path}>
      <Box asChild {...chip} maxW="220px">
        <RouterLink to={`/${site}/pages/${id}`}><Text as="span" truncate>{page.title}</Text></RouterLink>
      </Box>
    </Tooltip>
  );
}

const CRAWL_DOT: Record<CrawlListStatus, string> = { running: "blue", paused: "orange", success: "green", failed: "red", cancelled: "gray" };

// @crawl:ID: crawl ids belong to one site each; the current site's wins if they ever collide
function CrawlChip({ id }: { id: string }) {
  const { pathname } = useLocation();
  const c = CRAWLS.find((x) => x.id === id && x.site === siteIn(pathname)) ?? CRAWLS.find((x) => x.id === id);
  if (!c) return <Code textStyle="xs" title="Unknown crawl">@crawl:{id}</Code>;
  return (
    <Tooltip content={`${siteName(c.site)} · ${c.status}`}>
      <Box asChild {...chip}>
        <RouterLink to={`/${c.site}/crawls/${id}`}>
          <Dot color={`${CRAWL_DOT[c.status]}.solid`} />
          <Text as="span">#{id}</Text>
        </RouterLink>
      </Box>
    </Tooltip>
  );
}

// Replaces the references in the string children of a markdown element with chips; everything else passes through
export function withRefs(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child, n) => {
    if (typeof child !== "string") return child;
    const parts = splitRefs(child);
    if (parts.length === 1 && parts[0].kind === "text") return child;
    return (
      <Fragment key={n}>
        {parts.map((p, k) => {
          switch (p.kind) {
            case "text": case "code": return p.text;
            case "issue": return <IssueChip key={k} id={p.id} />;
            case "rule": return <RuleChip key={k} id={p.id} />;
            case "page": return <PageChip key={k} id={p.id} />;
            case "crawl": return <CrawlChip key={k} id={p.id} />;
          }
        })}
      </Fragment>
    );
  });
}
