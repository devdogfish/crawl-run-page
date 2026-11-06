// One turn of the conversation. The user's message is a small muted block on the right; the assistant's answer has no
// bubble: its lookups, then the text flowing on the panel, then what it opened, then the actions.
import { keyframes } from "@emotion/react";
import { Box, HStack, IconButton, Stack, Text } from "@chakra-ui/react";
import { LuCheck, LuRefreshCw } from "react-icons/lu";

import { Tooltip } from "@/components/ui/tooltip";
import { withRefs, TextLink } from "./chips";
import { CopyIconButton, Folded } from "./common";
import { Markdown } from "./markdown";
import { ToolGroup } from "./tools";
import type { AssistantMsg, UserMsg } from "./types";

export function UserMessage({ m }: { m: UserMsg }) {
  return (
    <Stack gap="1.5" align="flex-end">
      <Box maxW="90%" bg="bg.muted" px="3" py="2" rounded="l3" textStyle="sm" whiteSpace="pre-wrap" wordBreak="break-word"
        css={{ "--chip-bg": "var(--chakra-colors-bg-emphasized)", "--chip-bg-hover": "var(--chakra-colors-border-emphasized)" }}>{withRefs(m.text)}</Box>
      {m.context && (
        <Box maxW="90%" w="full">
          <Folded label="Context sent with this message" align="end">
            <Box borderWidth="1px" rounded="l3" p="3" textStyle="xs"><Markdown text={m.context} /></Box>
          </Folded>
        </Box>
      )}
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
  const tools = (m.tools ?? []).filter((t) => t.name !== "navigate");
  const thinking = live && !m.text && !m.error && !tools.some((t) => t.status === "running");
  const showActions = !live && (m.text || last);
  return (
    <Stack gap="3" className="group">
      <ToolGroup tools={tools} answerStarted={!!m.text} />
      {thinking && <Thinking />}
      {m.text && <Markdown text={m.text} streaming={live} />}
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
          {m.text && <CopyIconButton text={m.text} />}
          {last && (
            <Tooltip content="Answer again">
              <IconButton size="2xs" variant="ghost" color="fg.muted" aria-label="Answer again" onClick={onRegenerate}><LuRefreshCw /></IconButton>
            </Tooltip>
          )}
        </HStack>
      )}
    </Stack>
  );
}
