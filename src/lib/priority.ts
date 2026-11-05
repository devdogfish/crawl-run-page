"use client";

// Priority (P1–P4) is the team's own label, mapped from each issue's severity in Settings → Issue priority.
// Saved per browser in the prototype; in the real app it's a per-site setting (see SPEC.md, Developer handoff).
import { useSyncExternalStore } from "react";
import type { Severity } from "@/lib/page-issues";

export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];
export const DEFAULT_PRIORITY: Record<Severity, Priority> = { critical: "P1", serious: "P2", moderate: "P3", minor: "P4" };

const KEY = "crawler.priority";
const listeners = new Set<() => void>();
let cache: { raw: string | null; map: Record<Severity, Priority> } = { raw: null, map: DEFAULT_PRIORITY };

function read(): Record<Severity, Priority> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  if (raw !== cache.raw) {
    try { cache = { raw, map: raw ? { ...DEFAULT_PRIORITY, ...JSON.parse(raw) } : DEFAULT_PRIORITY }; } catch { cache = { raw, map: DEFAULT_PRIORITY }; }
  }
  return cache.map;
}

export function setPriority(sev: Severity, p: Priority) {
  const next = { ...read(), [sev]: p };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function usePriorityMap() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    read,
    () => DEFAULT_PRIORITY,
  );
}
