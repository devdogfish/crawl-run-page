// Priority is fixed per severity, the same for everyone: Critical P1, Serious P2, Moderate P3, Minor P4.
import type { Severity } from "@/lib/page-issues";

export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];
export const PRIORITY: Record<Severity, Priority> = { critical: "P1", serious: "P2", moderate: "P3", minor: "P4" };
// One colour scheme for priorities everywhere (dots, bars, charts, labels), the same in light and dark mode.
// Dots and fills use fixed palette steps, which don't invert between modes; text uses the matching readable "fg" step.
export const PRIORITY_DOT: Record<Priority, string> = { P1: "red.500", P2: "orange.500", P3: "yellow.400", P4: "gray.400" };
export const PRIORITY_COLOR: Record<Priority, string> = { P1: "red.fg", P2: "orange.fg", P3: "yellow.fg", P4: "gray.fg" };
