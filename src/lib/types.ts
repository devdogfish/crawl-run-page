// Shared types and formatters for the crawl run page.
// These mirror the API payloads described in SPEC.md (§ API).

export type StageStatus =
  | "pending" // a later stage, not reached yet
  | "waiting" // the next stage, blocked on the one before
  | "running"
  | "paused" // running step while the user has paused the run
  | "success"
  | "warning" // finished, but with rejected rows / soft issues
  | "failed"
  | "blocked"; // never ran because an earlier stage failed

// Log levels only drive colour. "event" = lifecycle lines (start, progress, pause, settings, done), shown muted.
export type LogLevel = "info" | "warn" | "error" | "event" | "cmd";
export type LogLine = { t: number; level: LogLevel; msg: string };
export type Sample = { t: number; rowsPerSec: number; rows: number };

export type Stage = {
  id: string;
  name: string;
  description: string;
  status: StageStatus;
  startedAt: number | null; // seconds since run start
  endedAt: number | null;
  expectedSec: number; // median of previous runs
  rowsIn: number;
  rowsOut: number;
  rejected: number;
  progress: number; // 0..100
  logs: LogLine[];
  samples: Sample[];
  error?: string;
};

// Formatters
export const fmtDur = (s: number) => {
  const v = Math.max(0, Math.round(s));
  if (v >= 3600) return `${Math.floor(v / 3600)}h ${String(Math.floor((v % 3600) / 60)).padStart(2, "0")}m`;
  return v < 60 ? `${v}s` : `${Math.floor(v / 60)}m ${String(v % 60).padStart(2, "0")}s`;
};
export const fmtNum = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`;
export const fmtClock = (t: number) => {
  const base = Date.UTC(2026, 10, 4, 2, 0, 0) + t * 1000;
  return new Date(base).toISOString().slice(11, 19);
};
export const stageDuration = (s: Stage, now: number) =>
  s.startedAt == null ? null : (s.endedAt ?? now) - s.startedAt;
