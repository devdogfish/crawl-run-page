// One turn of the conversation. The user's message is a small muted block on the right; the assistant's answer has no
// bubble: its lookups, then the text flowing on the panel, then what it opened, then the actions.
import { keyframes } from "@emotion/react";
import { Box, HStack, IconButton, Stack, Text } from "@chakra-ui/react";
import { useContext, useMemo } from "react";
import { LuCheck, LuCornerDownRight, LuRefreshCw } from "react-icons/lu";

import { Tooltip } from "@/components/ui/tooltip";
import { withRefs, TextLink } from "./chips";
import { CopyIconButton } from "./common";
import { UiActions, splitChoices } from "./cards";
import { Markdown } from "./markdown";
import { ToolGroup } from "./tools";
import { splitRefs } from "./tokens";
import { useLocation } from "react-router";
import { resolveIssue, resolveRule } from "@/lib/refs";
import { defaultCrawl, pageView } from "@/lib/site-pages";
import { DEFAULT_SITE, type SiteId } from "@/lib/sites";
import { siteIn } from "./route";
import type { AssistantMsg, UserMsg } from "./types";

export function UserMessage({ m }: { m: UserMsg }) {
  return (
    <Stack gap="1.5" align="flex-end">
      <Box maxW="90%" bg="bg.muted" px="3" py="2" rounded="l3" textStyle="sm" whiteSpace="pre-wrap" wordBreak="break-word"
        css={{ "--chip-bg": "var(--chakra-colors-bg-emphasized)", "--chip-bg-hover": "var(--chakra-colors-border-emphasized)" }}>{withRefs(m.text)}</Box>
    </Stack>
  );
}

const shimmer = keyframes`from { background-position: 100% 0 } to { background-position: -100% 0 }`;

function Thinking() {
  return (
    <Text role="status" textStyle="sm" color="transparent" w="fit-content" bgClip="text" bgSize="200% 100%"
      bgImage="linear-gradient(90deg, {colors.fg.muted} 35%, {colors.fg} 50%, {colors.fg.muted} 65%)"
      css={{ animation: `${shimmer} 1.8s linear infinite`, "@media (prefers-reduced-motion: reduce)": { animation: "none", backgroundImage: "none", color: "var(--chakra-colors-fg-muted)", WebkitTextFillColor: "currentColor" } }}>
      Thinking
    </Text>
  );
}

export function AssistantMessage({ m, last, live, onRegenerate }: { m: AssistantMsg; last: boolean; live: boolean; onRegenerate: () => void }) {
  const { send } = useContext(UiActions);
  // Suggested replies come out of the text; they're shown only under the newest finished answer, where they can be sent
  const { text, options } = useMemo(() => splitChoices(m.text), [m.text]);
  const followUps = last && !live && send ? options : [];
  const tools = (m.tools ?? []).filter((t) => t.name !== "navigate");
  const thinking = live && !m.text && !m.error && !tools.some((t) => t.status === "running");
  const showActions = !live && (m.text || last);
  return (
    <Stack gap="3" className="group">
      <ToolGroup tools={tools} answerStarted={!!m.text} />
      {thinking && <Thinking />}
      {text && <Markdown text={text} streaming={live} />}
      {m.opened?.map((o, k) => (
        <HStack key={k} gap="1.5" textStyle="xs" color="fg.muted">
          <LuCheck />
          <Text truncate>Opened <TextLink to={o.url}>{o.label}</TextLink></Text>
        </HStack>
      ))}
      {m.error && <Text textStyle="sm" color="red.fg" whiteSpace="pre-wrap">{m.error}</Text>}
      {m.stopped && !m.error && <Text textStyle="xs" color="fg.muted">Stopped</Text>}
      {showActions && (
        <HStack gap="0.5" ms="-1.5" mt="-1" opacity={last ? 1 : 0} transition="opacity 0.15s" _groupHover={{ opacity: 1 }} _focusWithin={{ opacity: 1 }}
          css={{ "@media (hover: none)": { opacity: 1 } }}>
          {text && <CopyIconButton text={text} />}
          {last && (
            <Tooltip content="Answer again">
              <IconButton size="2xs" variant="ghost" color="fg.muted" aria-label="Answer again" onClick={onRegenerate}><LuRefreshCw /></IconButton>
            </Tooltip>
          )}
        </HStack>
      )}
      {followUps.length > 0 && send && <FollowUps options={followUps} onPick={send} />}
    </Stack>
  );
}

// A button can't hold the reference chips (they're links), so it names what they point to; the message keeps the @tokens
const plainRefs = (text: string, site: SiteId) => splitRefs(text).map((p) => {
  switch (p.kind) {
    case "text": case "code": return p.text;
    case "issue": return resolveIssue(p.id)?.rule.title ?? `@issue:${p.id}`;
    case "rule": return resolveRule(p.id)?.title ?? `@rule:${p.id}`;
    case "page": return pageView(site, Number(p.id), Number(defaultCrawl(site).id), null)?.title ?? `page ${p.id}`;
    case "crawl": return `crawl #${p.id}`;
  }
}).join("");

// Replies the model suggests: one quiet row each, sent word for word
function FollowUps({ options, onPick }: { options: string[]; onPick: (q: string) => void }) {
  const site = siteIn(useLocation().pathname) || DEFAULT_SITE;
  return (
    <Stack gap="0" mt="-1" role="group" aria-label="Suggested replies">
      {options.map((o) => (
        <Box asChild key={o} display="flex" alignItems="center" gap="2" w="full" textAlign="start" py="1.5" px="1.5" ms="-1.5"
          rounded="l2" textStyle="sm" color="fg.muted" _hover={{ color: "fg", bg: "bg.subtle" }}
          _focusVisible={{ outline: "2px solid", outlineColor: "border.emphasized" }}>
          <button type="button" onClick={() => onPick(o)}>
            <Box as="span" flexShrink={0} aria-hidden><LuCornerDownRight size={14} /></Box>
            <Text as="span" lineClamp={2}>{plainRefs(o, site)}</Text>
          </button>
        </Box>
      ))}
    </Stack>
  );
}
