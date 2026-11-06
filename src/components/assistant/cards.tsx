// Components the model can ask for with a ```ui block: one JSON shape, `type` picks the component (COMPONENTS below).
//   fix   {issue, html}              a diff against the original element, with Preview / Source / Copy
//   paste {issue, label, value}      a value to paste into a Teamsite field
// Adding a component is one entry in COMPONENTS plus one line in the system prompt (src/lib/refs.ts). A renderer returns
// null when the data doesn't fit, and the block shows as code. Everything shown comes from the id, not from the model.
import { Link as RouterLink } from "react-router";
import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react";

import { resolveIssue } from "@/lib/refs";
import { PRIORITY_COLOR } from "@/lib/priority";
import { CodeBlock } from "./code-block";
import { CopyTextButton } from "./common";
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
const quiet = { size: "2xs", variant: "ghost", color: "fg.muted", _hover: { color: "fg" } } as const;

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
    <Stack {...card}>
      <Stack gap="0.5">
        <IssueHeader r={r} />
        <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate title={`${r.it.selector} · ${r.page.path}`}>{r.it.selector} · {r.page.path}</Text>
        {r.it.shared != null && <Text textStyle="xs" color="orange.fg">Same markup on {r.it.shared.toLocaleString("en-US")} pages: change it in the template, not on this page.</Text>}
      </Stack>
      <Diff before={r.it.snippet} after={after} />
      <HStack gap="0.5" ms="-1.5">
        {r.it.onPage && <Button asChild {...quiet}><RouterLink to={r.href("preview")}>Preview</RouterLink></Button>}
        <Button asChild {...quiet}><RouterLink to={r.href("source")}>Source</RouterLink></Button>
        <CopyTextButton text={after} />
      </HStack>
    </Stack>
  );
}

// Line diff of one element
export function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n"), b = after.split("\n");
  const rows = [...a.map((l) => ({ t: b.includes(l) ? " " : "-", l })), ...b.filter((l) => !a.includes(l)).map((l) => ({ t: "+", l }))];
  return (
    <Box borderWidth="1px" rounded="l2" overflow="hidden" fontFamily="mono" textStyle="xs" bg="bg.subtle">
      {rows.map((r, n) => (
        <HStack key={n} align="start" gap="0" bg={r.t === "-" ? "red.subtle" : r.t === "+" ? "green.subtle" : undefined}>
          <Text w="6" flexShrink={0} textAlign="center" color="fg.muted" py="1">{r.t}</Text>
          <Text whiteSpace="pre-wrap" wordBreak="break-all" py="1" pe="3">{r.l}</Text>
        </HStack>
      ))}
    </Box>
  );
}
