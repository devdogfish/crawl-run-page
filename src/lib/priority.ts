// Priority is fixed per severity, the same for everyone: Critical P1, Serious P2, Moderate P3, Minor P4.
import type { Severity } from "@/lib/page-issues";

export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];
export const PRIORITY: Record<Severity, Priority> = { critical: "P1", serious: "P2", moderate: "P3", minor: "P4" };
