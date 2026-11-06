// Components the model can ask for with a ```ui block: one JSON shape, `type` picks the component (COMPONENTS below).
//   fix   {issue, html}              a diff against the original element, with Preview / Source / Copy
//   paste {issue, label, value}      a value to paste into a Teamsite field
// Adding a component is one entry in COMPONENTS plus one line in the system prompt (src/lib/refs.ts). A renderer returns
// null when the data doesn't fit, and the block shows as code. Everything shown comes from the id, not from the model.
import { Link as RouterLink } from "react-router";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";

import { resolveIssue } from "@/lib/refs";
import { PRIORITY_COLOR } from "@/lib/priority";
import { CodeBlock } from "./code-block";
import { LuCheck, LuCopy } from "react-icons/lu";
import { CopyTextButton, useCopy } from "./common";
import { Dot, sevColor } from "./chips";

type UiData = { type?: unknown; [k: string]: unknown };
const COMPONENTS: Record<string, (d: UiData) => React.ReactNode | null> = {
  fix: (d) => {
    const r = d.issue != null ? resolveIssue(String(d.issue)) : null;
    return r && typeof d.html === "string" ? <FixCard r={r} after={d.html} /> : null;
  },
  paste: (d) => {
    const r = d.issue != null ? resolveIssue(String(d.issue)) : null;
    return typeof d.value === "string" ? <PasteCard r={r} label={typeof d.label === "string" ? d.label : "Value"} value={d.value} /> : null;
  },
};

export function UiBlock({ body }: { body: string }) {
  let data: UiData | null = null;
  try { data = JSON.parse(body); } catch { /* shown as code below */ }
  const render = data && typeof data.type === "string" ? COMPONENTS[data.type] : undefined;
  return render?.(data!) ?? <CodeBlock code={body} lang="ui" />;
}

// A block that is still being written
export function UiPending() {
  return <Text textStyle="xs" color="fg.muted" py="1">Preparing the fix…</Text>;
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
