import type { ToolEvent } from "@/lib/ai";

export type Opened = { url: string; label: string };
export type UserMsg = { role: "user"; text: string };
export type AssistantMsg = { role: "assistant"; text: string; error?: string; stopped?: boolean; tools?: ToolEvent[]; opened?: Opened[] };
export type Msg = UserMsg | AssistantMsg;
