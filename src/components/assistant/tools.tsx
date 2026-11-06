// The lookups the model makes, shown as one line each: status, what it did, a short result. A row unfolds to its arguments.
// Once the answer has started and nothing is still running, the rows fold into one line ("Looked at 3 things").
import { useState } from "react";
import { Box, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import { LuCheck, LuChevronRight, LuX } from "react-icons/lu";

import type { ToolEvent } from "@/lib/ai";

// Plain-language names for the lookups the model makes (the backend's tool names)
const TOOL_LABEL: Record<string, string> = {
  list_sites: "Listing the sites", find_crawls: "Looking up crawls", get_crawl: "Reading the crawl",
  find_pages: "Searching pages", get_page: "Reading the page", find_issues: "Looking up issues",
  find_issues_by_rule: "Looking up issues by rule", get_issue: "Reading the issue", list_rules: "Listing the rules", get_rule: "Reading the rule",
  fix_issue: "Preparing the fix",
};
export const toolLabel = (name: string) => TOOL_LABEL[name] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const argEntries = (args: unknown): [string, string][] =>
  args && typeof args === "object" && !Array.isArray(args)
    ? Object.entries(args as Record<string, unknown>).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
    : [];

const Status = ({ status }: { status: ToolEvent["status"] }) => (
  <Box w="4" display="flex" justifyContent="center" flexShrink={0} aria-hidden>
    {status === "running" ? <Spinner size="xs" borderWidth="1.5px" /> : status === "done" ? <LuCheck /> : <Box color="red.fg" display="flex"><LuX /></Box>}
  </Box>
);

const Chevron = ({ open }: { open: boolean }) => (
  <Box display="flex" flexShrink={0} transition="transform 0.15s" transform={open ? "rotate(90deg)" : undefined} aria-hidden><LuChevronRight /></Box>
);

function ToolRow({ t }: { t: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const args = argEntries(t.args);
  const line = (
    <>
      <Status status={t.status} />
      <Text truncate>{toolLabel(t.name)}{t.summary && <Text as="span" color="fg.subtle"> · {t.summary}</Text>}</Text>
      {args.length > 0 && <Chevron open={open} />}
    </>
  );
  return (
    <Box>
      {args.length > 0 ? (
        <HStack asChild gap="1.5" textStyle="xs" color="fg.muted" maxW="full" textAlign="start" _hover={{ color: "fg" }}>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{line}</button>
        </HStack>
      ) : (
        <HStack gap="1.5" textStyle="xs" color="fg.muted">{line}</HStack>
      )}
      {open && (
        <Stack gap="0.5" ms="5" mt="1" ps="2.5" borderStartWidth="1px" fontFamily="mono" textStyle="xs" color="fg.muted">
          {args.map(([k, v]) => <Text key={k} wordBreak="break-all"><Text as="span" color="fg.subtle">{k}</Text>  {v}</Text>)}
        </Stack>
      )}
    </Box>
  );
}

export function ToolGroup({ tools, answerStarted }: { tools: ToolEvent[]; answerStarted: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const folded = answerStarted && !tools.some((t) => t.status === "running");
  if (!folded) return <Stack gap="1.5">{tools.map((t) => <ToolRow key={t.id} t={t} />)}</Stack>;
  return (
    <Stack gap="1.5">
      <HStack asChild gap="1.5" textStyle="xs" color="fg.muted" w="fit-content" _hover={{ color: "fg" }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Chevron open={open} />
          <Text>Looked at {tools.length} {tools.length === 1 ? "thing" : "things"}</Text>
        </button>
      </HStack>
      {open && <Stack gap="1.5" ms="1.5">{tools.map((t) => <ToolRow key={t.id} t={t} />)}</Stack>}
    </Stack>
  );
}
