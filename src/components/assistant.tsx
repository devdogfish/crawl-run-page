import { NavAction } from "@/components/nav-action";
// Ask AI: one assistant for the whole app, docked on the right, opened from the navbar.
//
// Nothing is hidden: buttons around the app ("Fix with AI", "Explain with AI", …) put a prompt into the
// conversation, a short instruction plus the context it's about, and the user sees both. So does the place
// the user is looking at (the line in the input), which goes along with every message. While the model works,
// the lookups it makes show as small rows above its answer (Looking up issues ✓). The model answers in light
// Markdown; the app turns these things in that text into components (assistant/markdown.tsx):
//   @issue:ID / @rule:RULE_ID / @page:ID / @crawl:ID → inline chips linking to the thing (assistant/chips.tsx)
//   [label](/site/route?params)                       → a text link, only for paths url-map.json knows (src/lib/nav/url-map.ts)
//   ```ui {"type": "…", …}```                          → a component block: one JSON shape, `type` picks the component (assistant/cards.tsx)
// When the model asks to open a screen, the app goes there (if the URL checks out) and says so in the message.
// Everything a chip or component shows comes from the id (src/lib/refs.ts), not from the model.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useStickToBottom } from "use-stick-to-bottom";
import { Box, Button, IconButton, Stack } from "@chakra-ui/react";
import { LuArrowDown, LuSparkles, LuSquarePen } from "react-icons/lu";

import { Tooltip } from "@/components/ui/tooltip";
import { saveChatRule } from "@/lib/custom-rules";
import { DEFAULT_SITE } from "@/lib/sites";
import { streamChat, type ChatMessage } from "@/lib/ai";
import { type Seed } from "@/lib/refs";
import { validateUrl } from "@/lib/nav/url-map";
import { Composer } from "./assistant/composer";
import { EmptyState } from "./assistant/empty";
import { AssistantMessage, UserMessage } from "./assistant/messages";
import { siteIn } from "./assistant/route";
import { AssistantFrame, type Placement } from "./assistant/frame";
import type { AssistantMsg, Msg } from "./assistant/types";

type Assistant = { placement: Placement; open: boolean; setOpen: (v: boolean) => void; send: (q: string | Seed) => void };
const Ctx = createContext<Assistant>({ placement: "right", open: false, setOpen: () => {}, send: () => {} });
export const useAssistant = () => useContext(Ctx);
export const PANEL_W = "400px";

// The conversation survives a reload (this tab only)
const KEY = "crawler.ask-ai";
function load(): Msg[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    // a reload mid-answer leaves lookups "running" forever
    return v.map((m: Msg) => m.role === "assistant" && m.tools ? { ...m, tools: m.tools.map((t) => t.status === "running" ? { ...t, status: "error" as const, summary: "Interrupted" } : t) } : m);
  } catch { return []; }
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("right");
  const [msgs, setMsgs] = useState<Msg[]>(load);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const loc = useLocation();
  const navigate = useNavigate();
  const where = loc.pathname + loc.search;

  useEffect(() => {
    if (busy) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs)); } catch { /* storage unavailable */ }
  }, [msgs, busy]);

  // Runs the model on a conversation that ends with a user message
  const run = async (history: Msg[]) => {
    setMsgs([...history, { role: "assistant", text: "", tools: [], opened: [] }]);
    setOpen(true);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const update = (f: (m: AssistantMsg) => AssistantMsg) => setMsgs((m) => [...m.slice(0, -1), f(m[m.length - 1] as AssistantMsg)]);
    try {
      // What the real call sends: the conversation with each button's context, and where the user is. The server adds the system prompt.
      const messages: ChatMessage[] = history
        .map((m): ChatMessage => ({ role: m.role, content: m.role === "user" && m.context ? `${m.text}\n\nContext:\n${m.context}` : m.text }))
        .filter((m) => m.content.trim());
      // POST /api/chat (src/lib/ai.ts): the agent loop in the backend, or the scripted answers with no backend
      for await (const ev of streamChat(messages, { site: siteIn(loc.pathname) || DEFAULT_SITE, url: where }, ctl.signal)) {
        if (ev.type === "delta") update((m) => ({ ...m, text: m.text + ev.text }));
        else if (ev.type === "tool") {
          update((m) => {
            const tools = m.tools ?? [];
            return { ...m, tools: tools.some((t) => t.id === ev.id) ? tools.map((t) => (t.id === ev.id ? { ...t, ...ev } : t)) : [...tools, ev] };
          });
        } else if (ev.type === "create_rule") {
          try {
            const rule = saveChatRule(ev.rule);
            update((m) => ({ ...m, text: `${m.text}\n\nCreated @rule:${rule.id}. Click to edit.\n\n` }));
          } catch (e) {
            update((m) => ({ ...m, error: e instanceof Error ? e.message : "Could not save the rule." }));
          }
        } else if (ev.type === "navigate") {
          // Only to places url-map.json knows; the panel stays open
          const v = validateUrl(ev.url);
          if (v.ok) { navigate(v.url); update((m) => ({ ...m, opened: [...(m.opened ?? []), { url: v.url, label: ev.label }] })); }
        } else update((m) => ({ ...m, error: ev.message }));
      }
    } catch (e) {
      if (!ctl.signal.aborted) update((m) => ({ ...m, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      // lookups cut short by Stop don't spin forever
      if (ctl.signal.aborted) update((m) => ({ ...m, stopped: true }));
      update((m) => ({ ...m, tools: m.tools?.map((t) => (t.status === "running" ? { ...t, status: "error", summary: "Stopped" } : t)) }));
      if (abort.current === ctl) { setBusy(false); abort.current = null; }
    }
  };

  const send = (q: string | Seed) => {
    if (busy) return;
    const user: Msg = typeof q === "string" ? { role: "user", text: q } : { role: "user", text: q.instruction, context: q.context };
    if (user.text.trim()) run([...msgs, user]);
  };
  const regenerate = () => {
    if (busy) return;
    const last = msgs.map((m) => m.role).lastIndexOf("user");
    if (last >= 0) run(msgs.slice(0, last + 1));
  };
  const stop = () => abort.current?.abort();
  const reset = () => { abort.current?.abort(); abort.current = null; setBusy(false); setMsgs([]); };

  return (
    <Ctx.Provider value={{ open, placement, setOpen, send }}>
      {children}
      {open && <Panel placement={placement} onPlacementChange={setPlacement} msgs={msgs} busy={busy} where={where} onSend={send} onStop={stop} onRegenerate={regenerate} onReset={reset} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

// The navbar button
export function AskAiButton() {
  const { open, setOpen } = useAssistant();
  return <NavAction aria-expanded={open} onClick={() => setOpen(!open)}><LuSparkles />Ask AI</NavAction>;
}

function Panel({ placement, onPlacementChange, msgs, busy, where, onSend, onStop, onRegenerate, onReset, onClose }: {
  placement: Placement; onPlacementChange: (placement: Placement) => void; msgs: Msg[]; busy: boolean; where: string; onSend: (q: string) => void; onStop: () => void; onRegenerate: () => void; onReset: () => void; onClose: () => void;
}) {
  // follows the answer while it streams; lets go when the user scrolls up
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ resize: "smooth", initial: "instant" });
  // a new turn (the user's message and the empty answer under it) always scrolls into view
  useEffect(() => { if (msgs.length) scrollToBottom(); }, [msgs.length, scrollToBottom]);

  return (
    <AssistantFrame placement={placement} onPlacementChange={onPlacementChange} onClose={onClose} actions={msgs.length > 0 && (
      <Tooltip content="New conversation"><IconButton size="xs" variant="ghost" aria-label="New conversation" onClick={onReset}><LuSquarePen /></IconButton></Tooltip>
    )}>
      <Box position="relative" flex="1" minH="0">
        <Box ref={scrollRef} h="full" overflowY="auto">
          {msgs.length === 0 ? (
            <Box px="4" py="4"><EmptyState where={where} onSend={onSend} /></Box>
          ) : (
            <Stack ref={contentRef} px="4" py="4" gap="6" role="log" aria-live="polite" aria-label="Conversation" aria-busy={busy}>
              {msgs.map((m, n) => m.role === "user"
                ? <UserMessage key={n} m={m} />
                : <AssistantMessage key={n} m={m} last={n === msgs.length - 1} live={busy && n === msgs.length - 1} onRegenerate={onRegenerate} />)}
            </Stack>
          )}
        </Box>
        {!isAtBottom && msgs.length > 0 && (
          <Button position="absolute" bottom="3" left="50%" transform="translateX(-50%)" size="2xs" rounded="full" variant="outline" bg="bg" color="fg.muted" shadow="xs"
            onClick={() => scrollToBottom()}>
            <LuArrowDown />Jump to latest
          </Button>
        )}
      </Box>

      <Composer where={where} busy={busy} onSend={onSend} onStop={onStop} />
    </AssistantFrame>
  );
}
