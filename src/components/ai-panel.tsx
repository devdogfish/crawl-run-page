"use client";

// AI assistant docked on the right. It isn't only a chat: each answer can carry UI actions
// (filter the list, select an issue, open the preview with a layer on, generate a fix), which run
// immediately and are listed under the answer so the user sees what changed.
// PROTOTYPE: answers come from `onAsk` in the page (scripted from the page's own data), not a model.
import { useEffect, useRef, useState } from "react";
import { Box, Button, CloseButton, Flex, HStack, IconButton, Input, Stack, Text } from "@chakra-ui/react";
import { LuArrowUp, LuCheck, LuSparkles } from "react-icons/lu";

export type AiReply = { text: string; actions: string[] };
type Msg = { role: "user" | "ai"; text: string; actions?: string[] };

export function AiPanel({ open, onClose, context, suggestions, onAsk, ask }: {
  open: boolean;
  onClose: () => void;
  context: string[]; // what the assistant knows right now, shown as chips
  suggestions: string[];
  onAsk: (q: string) => AiReply;
  ask?: { q: string; n: number } | null; // a question sent from elsewhere on the page ("Ask AI" on an issue)
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const send = (q: string) => {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setDraft("");
    setBusy(true);
    setTimeout(() => {
      const r = onAsk(q);
      setMsgs((m) => [...m, { role: "ai", text: r.text, actions: r.actions }]);
      setBusy(false);
    }, 650);
  };
  useEffect(() => { if (ask) send(ask.q); }, [ask?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  if (!open) return null;
  return (
    <Flex direction="column" position="fixed" right="0" top="var(--sticky-top, 3.5rem)" bottom="0" w={{ base: "100%", md: "380px" }}
      bg="bg" borderStartWidth="1px" zIndex="docked" shadow={{ base: "lg", lg: "none" }}>
      <HStack px="4" h="12" borderBottomWidth="1px" justify="space-between" flexShrink={0}>
        <HStack gap="2"><LuSparkles /><Text textStyle="sm" fontWeight="medium">Ask AI</Text></HStack>
        <CloseButton size="xs" onClick={onClose} aria-label="Close assistant" />
      </HStack>

      <Text px="4" py="2" borderBottomWidth="1px" textStyle="xs" color="fg.muted" truncate>Context: {context.join(" · ")}</Text>

      <Stack flex="1" overflowY="auto" px="4" py="4" gap="4">
        {msgs.length === 0 && (
          <Stack gap="2">
            <Text textStyle="sm" color="fg.muted">Ask about this page. I can also filter, select and highlight issues for you.</Text>
            {suggestions.map((q) => (
              <Button key={q} size="sm" variant="outline" justifyContent="flex-start" fontWeight="normal" onClick={() => send(q)}>{q}</Button>
            ))}
          </Stack>
        )}
        {msgs.map((m, n) => m.role === "user" ? (
          <Box key={n} alignSelf="flex-end" maxW="85%" bg="bg.emphasized" px="3" py="2" rounded="l3" textStyle="sm">{m.text}</Box>
        ) : (
          <Stack key={n} gap="2">
            <Text textStyle="sm" whiteSpace="pre-wrap">{m.text}</Text>
            {!!m.actions?.length && (
              <Stack gap="1">
                {m.actions.map((a) => (
                  <HStack key={a} gap="1.5" textStyle="xs" color="fg.muted"><Box color="green.fg"><LuCheck /></Box>{a}</HStack>
                ))}
              </Stack>
            )}
          </Stack>
        ))}
        {busy && <Text textStyle="sm" color="fg.muted">Thinking…</Text>}
        {msgs.length > 0 && !busy && (
          <Flex gap="1.5" wrap="wrap">
            {suggestions.slice(0, 3).map((q) => <Button key={q} size="2xs" variant="subtle" fontWeight="normal" onClick={() => send(q)}>{q}</Button>)}
          </Flex>
        )}
        <div ref={end} />
      </Stack>

      <HStack as="form" p="3" borderTopWidth="1px" gap="2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <Input size="sm" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask, or tell me what to show" />
        <IconButton type="submit" size="sm" aria-label="Send" disabled={!draft.trim() || busy}><LuArrowUp /></IconButton>
      </HStack>
    </Flex>
  );
}
