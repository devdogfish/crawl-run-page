// Ask AI: one assistant for the whole app, docked on the right, opened from the navbar.
//
// Nothing is hidden: buttons around the app ("Fix with AI", "Explain with AI", …) put a prompt into the
// conversation, a short instruction plus the context it's about, and the user sees both. The model answers in
// plain text; the app turns two things in that text into components:
//   @issue:ID / @rule:RULE_ID      → inline chips linking to the issue or rule
//   ```ui {"type": "…", …}```      → a component block: one JSON shape, `type` picks the component (COMPONENTS below)
//                                    today: {"type": "fix", "issue": ID, "html": "…"} → diff against the original element
// Everything a chip or component shows comes from the id (src/lib/refs.ts), not from the model.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Box, Button, CloseButton, Code, Collapsible, Flex, HStack, IconButton, Stack, Text, Textarea } from "@chakra-ui/react";
import { LuArrowUp, LuChevronDown, LuCopy, LuSparkles, LuSquarePen } from "react-icons/lu";

import { Tooltip } from "@/components/ui/tooltip";
import { SEVERITIES } from "@/lib/page-issues";
import { streamAnswer, type ChatMessage } from "@/lib/mock-ai";
import { SYSTEM_PROMPT, resolveIssue, resolveRule, type Seed } from "@/lib/refs";
import { PRIORITY_COLOR } from "@/lib/priority";
import { useSite } from "@/components/site-context";

type Msg = { role: "user"; text: string; context?: string } | { role: "assistant"; text: string; error?: string };
type Assistant = { open: boolean; setOpen: (v: boolean) => void; send: (q: string | Seed) => void };
const Ctx = createContext<Assistant>({ open: false, setOpen: () => {}, send: () => {} });
export const useAssistant = () => useContext(Ctx);
export const PANEL_W = "400px";

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const send = async (q: string | Seed) => {
    if (busy) return;
    const user: Msg = typeof q === "string" ? { role: "user", text: q } : { role: "user", text: q.instruction, context: q.context };
    if (!user.text.trim()) return;
    const history = [...msgs, user];
    setMsgs([...history, { role: "assistant", text: "" }]);
    setOpen(true);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const update = (f: (m: Extract<Msg, { role: "assistant" }>) => Msg) =>
      setMsgs((m) => [...m.slice(0, -1), f(m[m.length - 1] as Extract<Msg, { role: "assistant" }>)]);
    try {
      // What the real call sends: the system prompt, then the conversation with each button's context
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.role === "user" && m.context ? `${m.text}\n\nContext:\n${m.context}` : m.text })),
      ];
      // PROTOTYPE: scripted answers. The corporate AI gateway replaces this one call (streamed chat completion).
      for await (const delta of streamAnswer(messages, ctl.signal)) update((m) => ({ ...m, text: m.text + delta }));
    } catch (e) {
      if (!ctl.signal.aborted) update((m) => ({ ...m, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (abort.current === ctl) { setBusy(false); abort.current = null; }
    }
  };
  const reset = () => { abort.current?.abort(); abort.current = null; setBusy(false); setMsgs([]); };

  return (
    <Ctx.Provider value={{ open, setOpen, send }}>
      {children}
      {open && <Panel msgs={msgs} busy={busy} onSend={send} onReset={reset} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

// The navbar button
export function AskAiButton() {
  const { open, setOpen } = useAssistant();
  return <Button size="sm" variant={open ? "subtle" : "ghost"} onClick={() => setOpen(!open)}><LuSparkles />Ask AI</Button>;
}

function Panel({ msgs, busy, onSend, onReset, onClose }: { msgs: Msg[]; busy: boolean; onSend: (q: string) => void; onReset: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);
  const submit = () => { if (draft.trim() && !busy) { onSend(draft); setDraft(""); } };

  return (
    <Flex direction="column" position="fixed" right="0" top="var(--sticky-top, 3.5rem)" bottom="0" w={{ base: "100%", md: PANEL_W }}
      bg="bg" borderStartWidth="1px" zIndex="docked" shadow={{ base: "lg", lg: "none" }}>
      <HStack px="4" h="12" borderBottomWidth="1px" flexShrink={0} gap="1">
        <Text textStyle="sm" fontWeight="medium" flex="1">Ask AI</Text>
        {msgs.length > 0 && (
          <Tooltip content="New conversation">
            <IconButton size="xs" variant="ghost" aria-label="New conversation" onClick={onReset}><LuSquarePen /></IconButton>
          </Tooltip>
        )}
        <CloseButton size="xs" onClick={onClose} aria-label="Close" />
      </HStack>

      <Stack flex="1" overflowY="auto" px="4" py="4" gap="5">
        {msgs.length === 0 && (
          <Stack gap="3" textStyle="sm" color="fg.muted">
            <Text>Ask anything about the sites, their pages and issues.</Text>
            <Text>On an issue, <b>Fix with AI</b> and <b>Explain with AI</b> write the prompt here for you, with the issue&apos;s details under it, so you can see exactly what&apos;s sent.</Text>
            <Folded label="What the AI is told before every conversation"><Code display="block" whiteSpace="pre-wrap" textStyle="xs" p="2.5">{SYSTEM_PROMPT}</Code></Folded>
          </Stack>
        )}
        {msgs.map((m, n) => m.role === "user" ? (
          <Stack key={n} gap="1.5" align="flex-end">
            <Box maxW="90%" bg="bg.muted" px="3" py="2" rounded="l3" textStyle="sm" whiteSpace="pre-wrap">{m.text}</Box>
            {m.context && (
              <Box maxW="90%" w="full"><Folded label="Context sent with this message"><Box borderWidth="1px" rounded="l2" p="2.5" textStyle="xs"><RichText text={m.context} /></Box></Folded></Box>
            )}
          </Stack>
        ) : (
          <Stack key={n} gap="2">
            {m.text ? <RichText text={m.text} streaming={busy && n === msgs.length - 1} /> : !m.error && <Text textStyle="sm" color="fg.muted">Thinking…</Text>}
            {m.error && <Text textStyle="sm" color="red.fg" whiteSpace="pre-wrap">{m.error}</Text>}
          </Stack>
        ))}
        <div ref={end} />
      </Stack>

      <HStack as="form" p="3" borderTopWidth="1px" gap="2" align="end" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Textarea size="sm" rows={1} autoresize maxH="40" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask anything"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <IconButton type="submit" size="sm" aria-label="Send" disabled={!draft.trim() || busy}><LuArrowUp /></IconButton>
      </HStack>
    </Flex>
  );
}

function Folded({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <HStack as="button" gap="1" textStyle="xs" color="fg.muted" _hover={{ color: "fg" }} ms="auto">
          <Box transition="transform 0.15s" transform={open ? undefined : "rotate(-90deg)"}><LuChevronDown /></Box>{label}
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content><Box mt="1.5">{children}</Box></Collapsible.Content>
    </Collapsible.Root>
  );
}

// ───────── Plain text → components ─────────
// Light Markdown (paragraphs, lists, headings, code blocks, `code`, **bold**) plus the references above.
type Block = { t: "p"; text: string } | { t: "h"; text: string } | { t: "ul"; items: string[] } | { t: "ol"; items: string[] } | { t: "code"; lang: string; body: string; open: boolean };
function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*```\s*([\w-]*)/);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++]);
      out.push({ t: "code", lang: fence[1], body: body.join("\n"), open: j >= lines.length });
      i = j;
    } else if (/^\s*[-*] /.test(l) || /^\s*\d+\. /.test(l)) {
      const ordered = /^\s*\d+\. /.test(l);
      const last = out[out.length - 1];
      const item = l.replace(/^\s*([-*]|\d+\.) /, "");
      if (last && last.t === (ordered ? "ol" : "ul")) (last as { items: string[] }).items.push(item);
      else out.push({ t: ordered ? "ol" : "ul", items: [item] });
    } else if (/^#{1,4} /.test(l)) {
      out.push({ t: "h", text: l.replace(/^#+ /, "") });
    } else if (l.trim()) {
      const last = out[out.length - 1];
      if (last?.t === "p" && lines[i - 1]?.trim()) last.text += "\n" + l;
      else out.push({ t: "p", text: l });
    }
  }
  return out;
}

export function RichText({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Stack gap="2.5" textStyle="sm">
      {blocks(text).map((b, n) => {
        if (b.t === "p") return <Text key={n} whiteSpace="pre-wrap"><Inline text={b.text} /></Text>;
        if (b.t === "h") return <Text key={n} fontWeight="semibold"><Inline text={b.text} /></Text>;
        if (b.t === "ul" || b.t === "ol") {
          return (
            <Box key={n} as={b.t} ps="5" listStyleType={b.t === "ul" ? "disc" : "decimal"}>
              {b.items.map((it, k) => <Box as="li" key={k} mb="1"><Inline text={it} /></Box>)}
            </Box>
          );
        }
        if (b.lang === "ui") {
          if (b.open && streaming) return <Box key={n} borderWidth="1px" rounded="l2" p="3" textStyle="xs" color="fg.muted">Preparing…</Box>;
          return <UiBlock key={n} body={b.body} />;
        }
        return <Code key={n} display="block" whiteSpace="pre-wrap" wordBreak="break-all" textStyle="xs" p="2.5">{b.body}</Code>;
      })}
    </Stack>
  );
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|@issue:\d+|@rule:[a-z0-9-]+)/g;
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((s, n) => {
        if (n % 2 === 0) return s;
        if (s.startsWith("`")) return <Code key={n} textStyle="xs">{s.slice(1, -1)}</Code>;
        if (s.startsWith("**")) return <b key={n}>{s.slice(2, -2)}</b>;
        if (s.startsWith("@issue:")) return <IssueChip key={n} id={s.slice(7)} />;
        return <RuleChip key={n} id={s.slice(6)} />;
      })}
    </>
  );
}

const chip = { display: "inline-flex", alignItems: "center", gap: "1.5", maxW: "full", px: "1.5", py: "0", rounded: "l1", borderWidth: "1px", textStyle: "xs", verticalAlign: "middle", color: "fg", textDecoration: "none", _hover: { bg: "bg.muted" } } as const;
const sevColor = (sev: string) => `${SEVERITIES.find((s) => s.id === sev)?.color ?? "gray"}.solid`;

function IssueChip({ id }: { id: string }) {
  const r = resolveIssue(id);
  if (!r) return <Code textStyle="xs" title="Unknown issue">@issue:{id}</Code>;
  return (
    <Tooltip content={`${r.page.path} · ${r.it.selector}`}>
      <Box asChild {...chip}>
        <RouterLink to={r.href()}>
          <Box as="span" display="inline-block" w="1.5" h="1.5" rounded="full" bg={sevColor(r.rule.severity)} flexShrink={0} />
          <Text as="span" color={PRIORITY_COLOR[r.priority]} fontWeight="medium">{r.priority}</Text>
          <Text as="span" truncate>{r.rule.title}</Text>
        </RouterLink>
      </Box>
    </Tooltip>
  );
}

function RuleChip({ id }: { id: string }) {
  const site = useSite();
  const r = resolveRule(id);
  if (!r) return <Code textStyle="xs">@rule:{id}</Code>;
  return (
    <Box asChild {...chip}>
      <RouterLink to={`/${site}/issues/${id}`}>
        <Box as="span" display="inline-block" w="1.5" h="1.5" rounded="full" bg={sevColor(r.severity)} flexShrink={0} />
        <Text as="span" truncate>{r.title}</Text>
      </RouterLink>
    </Box>
  );
}

// ───────── Component blocks ─────────
// One JSON shape for every component; `type` picks it. Adding a component is one entry here plus one line in the
// system prompt (src/lib/refs.ts). A renderer returns null when the data doesn't fit, and the block shows as code.
type UiData = { type?: unknown; [k: string]: unknown };
const COMPONENTS: Record<string, (d: UiData) => React.ReactNode | null> = {
  fix: (d) => {
    const r = d.issue != null ? resolveIssue(String(d.issue)) : null;
    return r && typeof d.html === "string" ? <FixCard r={r} after={d.html} /> : null;
  },
};

function UiBlock({ body }: { body: string }) {
  let data: UiData | null = null;
  try { data = JSON.parse(body); } catch { /* shown as code below */ }
  const render = data && typeof data.type === "string" ? COMPONENTS[data.type] : undefined;
  return render?.(data!) ?? <Code display="block" whiteSpace="pre-wrap" wordBreak="break-all" textStyle="xs" p="2.5">{body}</Code>;
}

// The fix: which issue (the title links to it), where it is, the diff, and the other views of the same element
function FixCard({ r, after }: { r: NonNullable<ReturnType<typeof resolveIssue>>; after: string }) {
  return (
    <Stack gap="2" borderWidth="1px" rounded="l2" p="3">
      <Stack gap="0.5">
        <HStack asChild gap="2" _hover={{ textDecoration: "underline" }} w="fit-content" maxW="full">
          <RouterLink to={r.href()}>
            <Box w="2" h="2" rounded="full" bg={sevColor(r.rule.severity)} flexShrink={0} />
            <Text textStyle="xs" fontWeight="semibold" color={PRIORITY_COLOR[r.priority]}>{r.priority}</Text>
            <Text textStyle="sm" fontWeight="medium" truncate>{r.rule.title}</Text>
          </RouterLink>
        </HStack>
        <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate title={`${r.it.selector} · ${r.page.path}`}>{r.it.selector} · {r.page.path}</Text>
        {r.it.shared != null && <Text textStyle="xs" color="orange.fg">Same markup on {r.it.shared.toLocaleString("en-US")} pages: change it in the template, not on this page.</Text>}
      </Stack>
      <Diff before={r.it.snippet} after={after} />
      <HStack gap="1">
        {r.it.onPage && <Button asChild size="2xs" variant="outline"><RouterLink to={r.href("preview")}>Preview</RouterLink></Button>}
        <Button asChild size="2xs" variant="outline"><RouterLink to={r.href("source")}>Source</RouterLink></Button>
        <Button size="2xs" variant="ghost" onClick={() => navigator.clipboard.writeText(after)}><LuCopy />Copy</Button>
      </HStack>
    </Stack>
  );
}

// Line diff of one element
export function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n"), b = after.split("\n");
  const rows = [...a.map((l) => ({ t: b.includes(l) ? " " : "-", l })), ...b.filter((l) => !a.includes(l)).map((l) => ({ t: "+", l }))];
  return (
    <Box borderWidth="1px" rounded="l2" overflow="hidden" fontFamily="mono" textStyle="xs">
      {rows.map((r, n) => (
        <HStack key={n} align="start" gap="0" bg={r.t === "-" ? "red.subtle" : r.t === "+" ? "green.subtle" : undefined}>
          <Text w="6" flexShrink={0} textAlign="center" color="fg.muted" py="1">{r.t}</Text>
          <Text whiteSpace="pre-wrap" wordBreak="break-all" py="1" pe="3">{r.l}</Text>
        </HStack>
      ))}
    </Box>
  );
}
