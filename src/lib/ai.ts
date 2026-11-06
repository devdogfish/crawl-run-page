// The calls Ask AI makes to the backend (docs/ai.md): POST /api/chat, streamed as server-sent events, and
// GET /api/assistant/system. Every backend response carries the header `X-Crawler-AI`. Without it (the backend
// isn't running, so the dev proxy errors; or a static build), or with VITE_AI=scripted, the scripted answers in
// mock-ai.ts stand in, so the prototype still works.
import { streamAnswer as scripted } from "@/lib/mock-ai";
import { SYSTEM_PROMPT } from "@/lib/refs";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatContext = { site: string; url: string };
export type ToolEvent = { type: "tool"; id: string; name: string; args?: unknown; status: "running" | "done" | "error"; summary?: string };
export type ChatEvent =
  | { type: "delta"; text: string }
  | ToolEvent
  | { type: "navigate"; url: string; label: string }
  | { type: "error"; message: string };

const FORCE_SCRIPTED = import.meta.env.VITE_AI === "scripted";

async function* scriptedEvents(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<ChatEvent> {
  for await (const text of scripted(messages, signal)) yield { type: "delta", text };
}

// One SSE `data:` payload → events
function* parse(data: Record<string, unknown>): Generator<ChatEvent> {
  if (typeof data.delta === "string" && data.delta) yield { type: "delta", text: data.delta };
  const t = data.tool as Record<string, unknown> | undefined;
  if (t && typeof t.id === "string" && typeof t.name === "string") {
    yield { type: "tool", id: t.id, name: t.name, args: t.args, status: t.status === "done" || t.status === "error" ? t.status : "running", summary: typeof t.summary === "string" ? t.summary : undefined };
  }
  const n = data.navigate as Record<string, unknown> | undefined;
  if (n && typeof n.url === "string") yield { type: "navigate", url: n.url, label: typeof n.label === "string" ? n.label : n.url };
  if (typeof data.error === "string") yield { type: "error", message: data.error };
}

export async function* streamChat(messages: ChatMessage[], context: ChatContext, signal: AbortSignal): AsyncGenerator<ChatEvent> {
  if (FORCE_SCRIPTED) { yield* scriptedEvents(messages, signal); return; }
  let res: Response;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ messages, context }) });
  } catch {
    if (signal.aborted) return;
    yield* scriptedEvents(messages, signal); // network error: no backend
    return;
  }
  if (!res.headers.get("X-Crawler-AI")) { yield* scriptedEvents(messages, signal); return; }
  if (!res.ok || !res.body) { yield { type: "error", message: (await res.text().catch(() => "")) || `Ask AI failed (${res.status})` }; return; }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += value;
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.replace(/^data:\s?/, "")).join("\n").trim();
      if (data === "[DONE]") return;
      if (!data) continue;
      try { yield* parse(JSON.parse(data)); } catch { /* not an event */ }
    }
  }
}

// What the panel shows as "what the AI is told": the backend's prompt, or the local copy offline
export async function fetchSystemPrompt(): Promise<string> {
  if (FORCE_SCRIPTED) return SYSTEM_PROMPT;
  try {
    const res = await fetch("/api/assistant/system");
    if (res.ok && res.headers.get("X-Crawler-AI")) { const p = (await res.json()).prompt; if (typeof p === "string" && p) return p; }
  } catch { /* offline */ }
  return SYSTEM_PROMPT;
}
