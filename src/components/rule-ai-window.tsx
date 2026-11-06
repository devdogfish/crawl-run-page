import { useEffect, useRef, useState, type RefObject } from "react";
import { useBrowserState, isBoolean, isPoint, isSize } from "@/lib/browser-state";
import { Box, Button, CloseButton, FloatingPanel, IconButton, Portal, Stack, Text } from "@chakra-ui/react";
import { LuGrip, LuSparkles, LuSquarePen } from "react-icons/lu";
import { Composer } from "./assistant/composer";
import { AssistantMessage, UserMessage } from "./assistant/messages";
import type { Msg } from "./assistant/types";
import { patternError, type Scope } from "@/lib/custom-rules";

export type RuleDraft = { name: string; pattern: string; scope: Scope; when: "found" | "missing"; regex: boolean; matchCase: boolean; description: string };
type Message = { role: "user" | "assistant"; content: string };
type Reply = { fields: Partial<RuleDraft>; message: string };

function parseReply(value: unknown): Reply {
  if (!value || typeof value !== "object") throw new Error("Invalid AI reply. Try again.");
  const { fields, message } = value as Record<string, unknown>;
  if (!fields || typeof fields !== "object" || typeof message !== "string" || !message.trim()) throw new Error("Invalid AI reply. Try again.");
  const patch: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val === null) continue;
    const valid = ["name", "pattern", "description"].includes(key) ? typeof val === "string"
      : ["regex", "matchCase"].includes(key) ? typeof val === "boolean"
      : key === "scope" ? ["content", "attributes", "source"].includes(String(val))
      : key === "when" && ["found", "missing"].includes(String(val));
    if (!valid) throw new Error("Invalid AI reply. Try again.");
    patch[key] = val;
  }
  return { fields: patch, message };
}

export function RuleAiWindow({ current, onApply, portalRef, storageKey }: { storageKey?: string; portalRef: RefObject<HTMLDivElement | null>; current: RuleDraft; onApply: (fields: Partial<RuleDraft>, original: RuleDraft) => void }) {
  const key = (part: string) => storageKey ? `${storageKey}.${part}` : undefined;
  const [open, setOpen] = useBrowserState(key("open"), false, isBoolean);
  const [messages, setMessages] = useBrowserState<Message[]>(key("messages"), [], (v): v is Message[] => Array.isArray(v) && v.every((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string"));
  const [display, setDisplay] = useState<Msg[]>(() => messages.map((m) => ({ role: m.role, text: m.content })));
  const [position, setPosition] = useBrowserState(key("position"), { x: Math.max(12, window.innerWidth - 452), y: 32 }, isPoint);
  const [size, setSize] = useBrowserState(key("size"), { width: 420, height: 560 }, isSize);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const fitSize = { width: Math.min(size.width, viewport.width - 24), height: Math.min(size.height, viewport.height - 24) };
  const bottom = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [display, busy, open]);
  const stop = () => {
    controller.current?.abort(); controller.current = null; setBusy(false);
    setDisplay((all) => all.map((m, i) => i === all.length - 1 && m.role === "assistant" ? { ...m, stopped: true } : m));
  };
  const send = async (prompt: string, history = messages) => {
    if (!prompt.trim() || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const original = { ...current };
    const conversation: Message[] = [...history, { role: "user", content: prompt.trim() }];
    setMessages(conversation);
    setBusy(true);
    setDisplay([...conversation.map((m) => ({ role: m.role, text: m.content })), { role: "assistant", text: "" }]);
    try {
      const res = await fetch("/api/rules/assist", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ messages: conversation, current: original }) });
      if (!res.headers.has("X-Crawler-AI")) throw new Error("AI service unavailable. Start the AI backend and try again.");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "AI request failed. Try again.");
      const reply = parseReply(body);
      const next = { ...original, ...reply.fields };
      if (reply.fields.pattern !== undefined || reply.fields.regex !== undefined) {
        const invalid = patternError(next.pattern, next.regex);
        if (invalid) throw new Error(`AI returned an invalid pattern: ${invalid}`);
      }
      if (abort.signal.aborted) return;
      onApply(reply.fields, original);
      setMessages([...conversation, { role: "assistant", content: reply.message }]);
      setDisplay([...conversation.map((m) => ({ role: m.role, text: m.content })), { role: "assistant", text: reply.message }]);
    } catch (e) {
      if (!abort.signal.aborted) setDisplay((all) => [...all.slice(0, -1), { role: "assistant", text: "", error: e instanceof Error ? e.message : "AI request failed. Try again." }]);
    } finally {
      if (controller.current === abort) controller.current = null;
      if (!abort.signal.aborted) setBusy(false);
    }
  };

  const retry = () => {
    const index = display.map((m) => m.role).lastIndexOf("user");
    if (index < 0 || busy) return;
    const history = display.slice(0, index).filter((m) => m.text.trim()).map((m) => ({ role: m.role, content: m.text }));
    void send(display[index].text, history);
  };

  return (
    <FloatingPanel.Root open={open} onOpenChange={(e) => setOpen(e.open)} persistRect allowOverflow={false}
      size={fitSize} onSizeChange={({ size }) => setSize(size)}
      minSize={{ width: Math.min(320, window.innerWidth - 24), height: Math.min(320, window.innerHeight - 32) }}
      position={{ x: Math.max(0, Math.min(position.x, viewport.width - fitSize.width)), y: Math.max(0, Math.min(position.y, viewport.height - fitSize.height)) }}
      onPositionChange={({ position }) => setPosition(position)}>
      <FloatingPanel.Trigger asChild>
        <Button size="xs" variant="ghost" color="fg.muted" aria-label="AI rule assistant" gap="1.5"><LuSparkles />Ask AI</Button>
      </FloatingPanel.Trigger>
      <Portal container={portalRef}>
      {/* Ark supplies an inline stack index; keep the panel on Chakra's overlay layer. */}
      <FloatingPanel.Positioner style={{ zIndex: "calc(var(--floating-panel-z-index) + var(--layer-index, 0))" }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
        <FloatingPanel.Content bg="bg.panel" borderWidth="1px" shadow="2xl" aria-label="Rule assistant">
          <FloatingPanel.Header>
            <FloatingPanel.DragTrigger cursor="grab" _active={{ cursor: "grabbing" }}>
              <LuGrip /><FloatingPanel.Title>Rule assistant</FloatingPanel.Title>
            </FloatingPanel.DragTrigger>
            <FloatingPanel.Control>
              <IconButton size="xs" variant="ghost" aria-label="New conversation" onClick={() => { stop(); setMessages([]); setDisplay([]); }}><LuSquarePen /></IconButton>
              <FloatingPanel.CloseTrigger asChild><CloseButton size="xs" aria-label="Close rule assistant" /></FloatingPanel.CloseTrigger>
            </FloatingPanel.Control>
          </FloatingPanel.Header>
          <FloatingPanel.Body p="0" display="flex" flexDirection="column" overflow="hidden" minH="0">
            <Box flex="1" minH="0" overflowY="auto" px="4" py="4">
              {display.length === 0 ? <Text color="fg.muted" textStyle="sm">What should this rule detect?</Text> :
                <Stack gap="6" role="log" aria-live="polite" aria-label="Rule conversation" aria-busy={busy}>
                  {display.map((m, n) => m.role === "user" ? <UserMessage key={n} m={m} /> :
                    <AssistantMessage key={n} m={m} last={n === display.length - 1} live={busy && n === display.length - 1} onRegenerate={retry} />)}
                </Stack>}
              <div ref={bottom} />
            </Box>
            <Composer storageKey={key("composer")} where={window.location.pathname} placeholder="Describe the rule you want…" ariaLabel="Rule prompt" busy={busy} onSend={(q) => void send(q)} onStop={stop} />
          </FloatingPanel.Body>
          <FloatingPanel.ResizeTriggers />
        </FloatingPanel.Content>
      </FloatingPanel.Positioner>
      </Portal>
    </FloatingPanel.Root>
  );
}
