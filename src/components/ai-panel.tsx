// Ask AI, docked on the right. One conversation per page that keeps going while you move around;
// every question is anchored to the issue it's about, shown as a link to that element, so you can
// always jump back to what a message referred to. Answers can reference other issues (also links),
// change the view (listed under the answer), and suggest follow-up questions.
// PROTOTYPE: answers come from `onAsk` in the page (scripted from the page's own data), not a model.
import { useEffect, useRef, useState } from "react";
import { Box, Button, CloseButton, Flex, HStack, IconButton, Input, Stack, Text } from "@chakra-ui/react";
import { LuArrowUp, LuCheck, LuSquarePen, LuX } from "react-icons/lu";
import { Tooltip } from "@/components/ui/tooltip";

export type IssueRef = { k: number; label: string; detail: string; color: string };
export type AiReply = { text: string; refs?: IssueRef[]; actions?: string[]; followUps?: string[] };
type Msg = { role: "user" | "ai"; text: string; about?: IssueRef | null; refs?: IssueRef[]; actions?: string[]; followUps?: string[] };

export function AiPanel({ open, onClose, about, onAsk, onRef, ask, starters }: {
  open: boolean;
  onClose: () => void;
  about: IssueRef | null; // the selected issue: what the next question is about
  onAsk: (q: string, about: IssueRef | null) => AiReply;
  onRef: (k: number) => void; // a link in the chat was clicked
  ask?: { q: string; about: IssueRef | null; n: number } | null; // a question sent from the page (an action button)
  starters: string[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [detached, setDetached] = useState(false); // the user removed the anchor: ask about the whole page
  const end = useRef<HTMLDivElement>(null);
  const anchor = detached ? null : about;
  useEffect(() => setDetached(false), [about?.k]);

  const send = (q: string, a: IssueRef | null = anchor) => {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q, about: a }]);
    setDraft("");
    setBusy(true);
    setTimeout(() => {
      const r = onAsk(q, a);
      setMsgs((m) => [...m, { role: "ai", ...r }]);
      setBusy(false);
    }, 600);
  };
  useEffect(() => { if (ask) send(ask.q, ask.about); }, [ask?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  if (!open) return null;
  const last = msgs[msgs.length - 1];
  let prevAbout: number | null | undefined; // show the anchor only when the topic changes
  return (
    <Flex direction="column" position="fixed" right="0" top="var(--sticky-top, 3.5rem)" bottom="0" w={{ base: "100%", md: "380px" }}
      bg="bg" borderStartWidth="1px" zIndex="docked" shadow={{ base: "lg", lg: "none" }}>
      <HStack px="4" h="12" borderBottomWidth="1px" flexShrink={0} gap="1">
        <Text textStyle="sm" fontWeight="medium" flex="1">Ask AI</Text>
        {msgs.length > 0 && (
          <Tooltip content="New conversation">
            <IconButton size="xs" variant="ghost" aria-label="New conversation" onClick={() => setMsgs([])}><LuSquarePen /></IconButton>
          </Tooltip>
        )}
        <CloseButton size="xs" onClick={onClose} aria-label="Close" />
      </HStack>

      <Stack flex="1" overflowY="auto" px="4" py="4" gap="5">
        {msgs.length === 0 && (
          <Stack gap="3">
            <Text textStyle="sm" color="fg.muted">Ask anything about this page. Questions are about the selected issue unless you remove it below.</Text>
            <Stack gap="1">
              {starters.map((q) => (
                <Button key={q} size="sm" variant="ghost" justifyContent="flex-start" fontWeight="normal" color="fg.muted" onClick={() => send(q)}>{q}</Button>
              ))}
            </Stack>
          </Stack>
        )}
        {msgs.map((m, n) => {
          if (m.role === "user") {
            const changed = (m.about?.k ?? null) !== prevAbout;
            prevAbout = m.about?.k ?? null;
            return (
              <Stack key={n} gap="1.5" align="flex-end">
                {changed && (m.about ? <RefLink r={m.about} onRef={onRef} /> : <Text textStyle="xs" color="fg.subtle">About the whole page</Text>)}
                <Box maxW="85%" bg="bg.muted" px="3" py="2" rounded="l3" textStyle="sm">{m.text}</Box>
              </Stack>
            );
          }
          return (
            <Stack key={n} gap="2">
              <Text textStyle="sm" whiteSpace="pre-wrap">{m.text}</Text>
              {!!m.refs?.length && <Stack gap="1">{m.refs.map((r) => <RefLink key={r.k} r={r} onRef={onRef} />)}</Stack>}
              {!!m.actions?.length && m.actions.map((a) => (
                <HStack key={a} gap="1.5" textStyle="xs" color="fg.muted"><LuCheck />{a}</HStack>
              ))}
            </Stack>
          );
        })}
        {busy && <Text textStyle="sm" color="fg.muted">Thinking…</Text>}
        {!busy && last?.role === "ai" && !!last.followUps?.length && (
          <Flex gap="1.5" wrap="wrap">
            {last.followUps.map((q) => <Button key={q} size="xs" variant="outline" fontWeight="normal" onClick={() => send(q)}>{q}</Button>)}
          </Flex>
        )}
        <div ref={end} />
      </Stack>

      <Stack p="3" borderTopWidth="1px" gap="2">
        {anchor && (
          <HStack gap="1" textStyle="xs" color="fg.muted">
            <Text flexShrink={0}>About</Text>
            <Box minW="0" flex="1"><RefLink r={anchor} onRef={onRef} /></Box>
            <IconButton size="2xs" variant="ghost" aria-label="Ask about the whole page instead" onClick={() => setDetached(true)}><LuX /></IconButton>
          </HStack>
        )}
        <HStack as="form" gap="2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <Input size="sm" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={anchor ? "Ask about this issue" : "Ask about this page"} />
          <IconButton type="submit" size="sm" aria-label="Send" disabled={!draft.trim() || busy}><LuArrowUp /></IconButton>
        </HStack>
      </Stack>
    </Flex>
  );
}

// A link to an issue's element: selects it on the page
function RefLink({ r, onRef }: { r: IssueRef; onRef: (k: number) => void }) {
  return (
    <HStack as="button" gap="1.5" px="2" py="1" rounded="l2" borderWidth="1px" textStyle="xs" maxW="full" minW="0" _hover={{ bg: "bg.muted" }}
      onClick={() => onRef(r.k)} title="Show this element">
      <Box w="1.5" h="1.5" rounded="full" bg={r.color} flexShrink={0} />
      <Text truncate>{r.label}</Text>
      <Text color="fg.muted" fontFamily="mono" truncate flexShrink={1}>{r.detail}</Text>
    </HStack>
  );
}
