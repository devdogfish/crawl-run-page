// PROTOTYPE SIMULATOR. In the real app the run page reads the API (SPEC.md §6).
// A crawl-heavy run: one long crawl (~90% of the run), then short processing steps.
// Supports pause/resume and live settings changes, like the real run page will.
import { useCallback, useEffect, useState } from "react";
import type { LogLevel, LogLine, Stage } from "@/lib/types";
import { fmtDur } from "@/lib/types";
import type { PageRow } from "@/lib/pages";
import { DEFAULT_SETTINGS, describeChanges, hostOf, type CrawlSettings } from "@/lib/settings";

// ───────────────────────── One log format for every step ─────────────────────────
// "<outcome> <ACTION> <subject>[ → <target>] (<duration>[, details])"
//   outcome: HTTP status for requests (200, 301, 404, 503), OK / ERR for other work, "—" for lifecycle events
//   ACTION:  GET, AUDIT, PARSE, BUILD, UPSERT, INSERT, REFRESH, POST · events: START, SEED, PROGRESS,
//            THROTTLE, PAUSE, UPDATE, RESUME, RETRY, DONE, STOP
// Colour comes from the outcome: 4xx yellow, 5xx/ERR red, events muted, everything else default.
export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : fmtDur(ms / 1000));
export function logLine(t: number, outcome: string | number | null, action: string, subject: string,
  o: { ms?: number; to?: string; details?: (string | false | undefined)[] } = {}): LogLine {
  const out = outcome == null ? "ERR" : String(outcome);
  const code = Number(out);
  const level: LogLevel = out === "—" ? "event" : out === "ERR" || code >= 500 ? "error" : code >= 400 ? "warn" : "info";
  const parts = [o.ms != null ? fmtMs(o.ms) : undefined, ...(o.details ?? [])].filter(Boolean);
  return { t, level, msg: `${out.padEnd(3)} ${action} ${subject}${o.to ? ` → ${o.to}` : ""}${parts.length ? ` (${parts.join(", ")})` : ""}` };
}
const n = (v: number) => v.toLocaleString("en-US");

// ───────────────────────── State ─────────────────────────
export type CrawlScenario = "healthy" | "ratelimited" | "failure";
export type CrawlStatus = "running" | "success" | "cancelled";
export type CodeBucket = "2xx" | "3xx" | "4xx" | "429" | "5xx" | "timeout";
export type CrawlSample = { t: number; pagesPerSec: number; queue: number; done: number };

export type CrawlState = {
  status: CrawlStatus;
  startedAt: number;
  endedAt: number | null;
  done: number; // pages fetched
  discovered: number; // URLs found so far
  total: number; // true total, unknown to the UI until the crawl ends
  codes: Record<CodeBucket, number>;
  samples: CrawlSample[];
  logs: LogLine[];
  backoffUntil: number | null;
  carry: number;
};

export type RunState = {
  t: number; // seconds since run start (stops while paused)
  paused: boolean;
  settings: CrawlSettings;
  crawl: CrawlState;
  tail: Stage[]; // processing steps after the crawl
  cursor: Record<string, number>; // scripted lines already printed per step (current attempt)
  failArmed: boolean;
  fullLh: FullJob | null; // optional follow-up job, started by the user after the run
  dataset: RunDataset;
};

export type FullJob = Stage & { elapsed: number; pagesDone: number; pagesTotal: number };
export type RunDataset = { pages: PageRow[]; durationSec: number; startedAt: Date; resumed?: { pages: number; elapsed: number; paused: boolean } };
export const fullAuditDuration = (pages: number) => Math.max(1, pages * 3);
const TICK_REAL_MS = 250;
const DT = 2;
const TAIL_DEFS = [
  { id: "parse", name: "Parse", description: "Extract page metadata and inspectable HTML" },
  { id: "transform", name: "Transform", description: "Group findings by rule and element pattern" },
  { id: "load", name: "Load", description: "Store the page and issue snapshot" },
  { id: "lighthouse", name: "Lighthouse", description: "Replay stored Lighthouse coverage" },
  { id: "publish", name: "Publish", description: "Publish the crawl to Pages and Issues" },
];
const crawlDuration = (data: RunDataset) => Math.max(8, data.durationSec * 0.7);
const auditPages = (data: RunDataset, s: CrawlSettings) => data.pages.filter((p) => p.performance != null).slice(0, s.lighthouseSample);

type Scripted = { at: number; outcome: string; action: string; subject: string; ms?: number; details?: string[] };
function tailScript(id: string, data: RunDataset, settings: CrawlSettings): Scripted[] {
  if (id === "lighthouse") {
    const pages = auditPages(data, settings);
    return pages.map((page, i) => ({
      at: (i + 1) / pages.length, outcome: "OK", action: "AUDIT", subject: page.path,
      details: [`sample performance score ${page.performance}`],
    }));
  }
  const actions: Record<string, [string, string]> = {
    parse: ["PARSE", "page metadata"], transform: ["GROUP", "rule findings"],
    load: ["STORE", "page snapshot"], publish: ["PUBLISH", "Pages and Issues"],
  };
  const [action, subject] = actions[id];
  return [{ at: 0.8, outcome: "OK", action, subject, details: [`${n(data.pages.length)} pages`] }];
}

function initial(scenario: CrawlScenario, settings: CrawlSettings, dataset: RunDataset): RunState {
  const elapsed = dataset.resumed?.elapsed ?? 0;
  const fetched = dataset.pages.slice(0, dataset.resumed?.pages ?? 0);
  const codes: CrawlState["codes"] = { "2xx": 0, "3xx": 0, "4xx": 0, "429": 0, "5xx": 0, timeout: 0 };
  const fetchedLogs = fetched.map((page, i) => {
    const status = page.status ?? 200;
    codes[status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx"]++;
    return logLine((i + 1) * elapsed / fetched.length, status, "GET", page.path, { ms: page.fetchMs ?? undefined });
  });
  return {
    t: elapsed,
    paused: dataset.resumed?.paused ?? false,
    settings,
    cursor: {},
    failArmed: scenario === "failure",
    fullLh: null,
    dataset,
    crawl: {
      status: "running",
      startedAt: 0,
      endedAt: null,
      done: fetched.length,
      discovered: dataset.pages.length,
      total: dataset.pages.length,
      codes,
      samples: fetched.length ? [{ t: elapsed, pagesPerSec: fetched.length / Math.max(1, elapsed), queue: dataset.pages.length - fetched.length, done: fetched.length }] : [],
      logs: [
        logLine(0, "—", "START", `crawl ${settings.url}`, { details: [`${settings.concurrency} workers`, `delay ${settings.delayMs} ms`, `timeout ${settings.timeoutS} s`] }),
        logLine(0, "—", "SEED", `${n(dataset.pages.length)} saved URLs`, { details: ["simulated run"] }),
        ...fetchedLogs,
      ],
      backoffUntil: null,
      carry: 0,
    },
    tail: TAIL_DEFS.map((d, i) => ({
      id: d.id, name: d.name, description: d.id === "lighthouse" ? `${n(auditPages(dataset, settings).length)} pages with sample performance scores` : d.description,
      status: i === 0 ? "waiting" : "pending",
      startedAt: null, endedAt: null, expectedSec: Math.max(DT, (dataset.durationSec - crawlDuration(dataset)) / TAIL_DEFS.length),
      rowsIn: 0, rowsOut: 0, rejected: 0, progress: 0, logs: [], samples: [],
    })),
  };
}

const wave = (t: number, seed: number) => 0.86 + 0.1 * Math.sin(t / 37 + seed) + 0.05 * Math.sin(t / 9 + seed * 3);
// Fewer workers or a longer delay → slower crawl (baseline: 64 workers, 250 ms delay, ~400 ms responses)
const speed = (s: CrawlSettings) => Math.min(3, Math.max(0.1, (s.concurrency / 64) * (650 / (s.delayMs + 400))));

function stepCrawl(c: CrawlState, t: number, scenario: CrawlScenario, s: CrawlSettings, data: RunDataset): CrawlState {
  const duration = crawlDuration(data);
  const discovered = c.total;
  const limited = scenario === "ratelimited" && t > duration * 0.3 && t < duration * 0.55;
  const base = (c.total / duration) * wave(t, 1) * speed(s) * (limited ? 0.32 : 1);
  const batch = c.carry + base * DT;
  const fetched = Math.min(c.total - c.done, Math.floor(batch));
  const done = c.done + fetched;

  // One line per HTTP request, generated from the same rows as the Pages table,
  // so the log, the response-code bar and the table always agree.
  const codes = { ...c.codes };
  const logs = [...c.logs];
  const tick = Math.round(t / DT);
  const n429 = limited && !c.backoffUntil ? Math.min(2, c.total - c.done) : 0;
  const end = Math.min(done, c.total);
  const span = Math.max(1, end - c.done + n429);
  let k = 0;
  const at = () => t - DT + (DT * k++) / span; // spread the requests across the tick
  if (limited && !c.backoffUntil) logs.push(logLine(t - DT, "—", "THROTTLE", hostOf(s.url), { details: ["429 responses", `${s.concurrency} → ${Math.round(s.concurrency / 4)} workers`, "backing off 30 s"] }));
  for (let i = 0; i < n429; i++) {
    codes["429"] += 1;
    logs.push(logLine(at(), 429, "GET", data.pages[c.done + i].path, { ms: 40 + (i % 30), details: ["will retry"] }));
  }
  for (let i = c.done; i < end; i++) {
    const p = data.pages[i];
    if (p.kind === "skipped") { at(); continue; } // never requested: shows in the Pages table only
    for (const h of p.hops) {
      if (h.side === "server") { codes["3xx"] += 1; logs.push(logLine(at(), Number(h.via), "GET", h.from, { to: h.to, ms: (p.fetchMs ?? 200) / 3 })); }
    }
    const clientHop = p.hops.find((h) => h.side === "client");
    if (p.kind === "timeout") { codes.timeout += 1; logs.push(logLine(at(), null, "GET", p.path, { ms: s.timeoutS * 1000, details: ["timed out"] })); continue; }
    if (p.kind === "loop") { logs.push(logLine(at(), null, "GET", p.path, { details: ["redirect loop after 10 hops"] })); continue; }
    const status = p.kind === "redirect" ? 200 : (p.status ?? 200);
    const url = clientHop ? clientHop.from : p.kind === "redirect" ? p.finalPath! : p.path;
    codes[status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx"] += 1;
    logs.push(logLine(at(), status, "GET", url, {
      to: clientHop?.to, ms: p.fetchMs ?? undefined,
      details: [clientHop && `client-side ${clientHop.via}`, p.kind === "server" && `after ${s.maxRetries + 1} attempts`],
    }));
  }
  if (c.backoffUntil && !limited) logs.push(logLine(t, "—", "THROTTLE", hostOf(s.url), { details: ["recovered", `${Math.round(s.concurrency / 4)} → ${s.concurrency} workers`] }));
  if (tick % 4 === 0) logs.push(logLine(t, "—", "PROGRESS", `${n(end)} pages`, { details: [`${Math.round(base)}/s`, `${n(discovered - done)} queued`] }));

  const finished = done >= c.total;
  if (finished) logs.push(logLine(t, "OK", "DONE", "crawl", { ms: t * 1000, details: [`${n(c.total)} pages`] }));

  return {
    ...c,
    done: Math.min(done, c.total),
    discovered,
    codes,
    logs, // every request is kept; the viewer is virtualised
    samples: [...c.samples, { t, pagesPerSec: Math.round(base), queue: Math.max(0, discovered - done), done }],
    status: finished ? "success" : "running",
    endedAt: finished ? t : null,
    backoffUntil: limited ? duration * 0.55 : null,
    carry: batch - fetched,
  };
}

function stepTail(state: RunState): RunState {
  const tail = state.tail.map((x) => ({ ...x }));
  const cursor = { ...state.cursor };
  const st = state.settings;
  const data = state.dataset;
  let i = tail.findIndex((x) => x.status === "running");
  if (i < 0) {
    i = tail.findIndex((x) => x.status === "waiting");
    if (i < 0) return state;
    tail[i] = { ...tail[i], status: "running", startedAt: state.t, logs: [...tail[i].logs, logLine(state.t, "—", "START", tail[i].id, { details: [`${n(tail[i].id === "lighthouse" ? auditPages(data, st).length : data.pages.length)} pages`] })] };
    cursor[tail[i].id] = 0;
    if (tail[i + 1]) tail[i + 1] = { ...tail[i + 1], status: "waiting" };
  }
  const s = tail[i];
  const script = tailScript(s.id, data, st);
  const p = Math.min(100, s.progress + (DT / s.expectedSec) * 100);
  const due = script.filter((x) => x.at <= p / 100).length;
  const from = cursor[s.id] ?? 0;
  s.logs = [...s.logs, ...script.slice(from, due).map((x, j) =>
    logLine(state.t - DT + (DT * (j + 1)) / Math.max(1, due - from), x.outcome, x.action, x.subject, { ms: x.ms, details: x.details }))];
  cursor[s.id] = Math.max(from, due);
  s.progress = p;
  s.samples = [...s.samples, { t: state.t, rowsPerSec: Math.round((data.pages.length / s.expectedSec) * wave(state.t, i + 2)), rows: Math.round((s.id === "lighthouse" ? auditPages(data, st).length : data.pages.length) * (p / 100)) }];

  if (state.failArmed && s.id === "transform" && p >= 70) {
    s.status = "failed";
    s.endedAt = state.t;
    s.error = "Sample issue grouping stopped before publishing";
    s.logs = [...s.logs,
      logLine(state.t, "ERR", "GROUP", "rule findings", { details: ["simulated processing error"] }),
      logLine(state.t, "ERR", "STOP", "transform", { ms: (state.t - s.startedAt!) * 1000, details: ["later steps not run"] })];
    for (let j = i + 1; j < tail.length; j++) tail[j] = { ...tail[j], status: "blocked" };
    return { ...state, tail, cursor };
  }
  if (p >= 100) {
    s.status = "success";
    s.endedAt = state.t;
    s.logs = [...s.logs, logLine(state.t, "OK", "DONE", s.id, { ms: (state.t - s.startedAt!) * 1000, details: [`${n(s.id === "lighthouse" ? auditPages(data, st).length : data.pages.length)} pages`] })];
    if (tail[i + 1]) tail[i + 1] = { ...tail[i + 1], status: "waiting" };
  }
  return { ...state, tail, cursor };
}

function mainDone(s: RunState) {
  return s.crawl.status === "cancelled" || s.tail.some((x) => x.status === "failed") || s.tail.every((x) => x.status === "success");
}

function stepFullLh(j: FullJob, data: RunDataset): FullJob {
  const dt = j.expectedSec / 44;
  const elapsed = Math.min(j.expectedSec, j.elapsed + dt);
  const progress = Math.min(100, (elapsed / j.expectedSec) * 100);
  const pagesDone = Math.round((progress / 100) * j.pagesTotal);
  const logs = [...j.logs];
  const now = j.startedAt! + elapsed;
  for (let i = j.pagesDone; i < pagesDone; i++) {
    const t = now - dt + (dt * (i - j.pagesDone + 1)) / Math.max(1, pagesDone - j.pagesDone);
    const page = data.pages[i];
    logs.push(page.performance == null
      ? logLine(t, "—", "AUDIT", page.path, { details: ["no stored score"] })
      : logLine(t, "OK", "AUDIT", page.path, { details: [`sample performance score ${page.performance}`] }));
  }
  const finished = progress >= 100;
  if (finished) logs.push(logLine(now, "OK", "DONE", "lighthouse full site", { ms: elapsed * 1000, details: [`${n(j.pagesTotal)} pages`, "sample replay"] }));
  return {
    ...j, elapsed, progress, pagesDone, logs,
    samples: [...j.samples, { t: now, rowsPerSec: Math.round((j.pagesTotal / j.expectedSec) * 60 * wave(elapsed, 7)), rows: pagesDone }],
    status: finished ? "success" : "running",
    endedAt: finished ? now : null,
  };
}

function step(state: RunState, scenario: CrawlScenario): RunState {
  let next: RunState = state;
  if (!state.paused && !mainDone(state)) {
    const t = state.t + DT;
    next = { ...state, t };
    next = state.crawl.status === "running" ? { ...next, crawl: stepCrawl(state.crawl, t, scenario, state.settings, state.dataset) } : stepTail(next);
  }
  if (next.fullLh?.status === "running") next = { ...next, fullLh: stepFullLh(next.fullLh, state.dataset) };
  return next;
}

// The stage the run is on: "crawl", a processing step id, or undefined when finished/failed
function currentStage(s: RunState) {
  if (s.crawl.status === "running") return "crawl";
  if (s.tail.some((x) => x.status === "failed")) return undefined;
  return s.tail.find((x) => x.status === "running" || x.status === "waiting")?.id;
}

// Append a lifecycle line to whichever step is current (pause, resume, settings changes)
function withEvent(s: RunState, line: LogLine): RunState {
  const cur = currentStage(s);
  if (cur === "crawl") return { ...s, crawl: { ...s.crawl, logs: [...s.crawl.logs, line] } };
  return { ...s, tail: s.tail.map((x) => (x.id === cur ? { ...x, logs: [...x.logs, line] } : x)) };
}

export function archivedRun(status: "success" | "failed" | "cancelled", data: RunDataset, settings: CrawlSettings = DEFAULT_SETTINGS) {
  const scenario = status === "failed" ? "failure" : "healthy";
  let state = initial(scenario, settings, data);
  while (!mainDone(state)) {
    state = step(state, scenario);
    if (status === "cancelled" && state.crawl.status === "success") {
      state = { ...state, crawl: { ...state.crawl, status: "cancelled", logs: [
        ...state.crawl.logs.slice(0, -1), logLine(state.t, "—", "STOP", "crawl cancelled"),
      ] }, tail: state.tail.map((stage) => ({ ...stage, status: "blocked" })) };
    }
  }
  const factor = Math.max(1, data.durationSec) / Math.max(DT, state.t);
  const scale = (t: number) => Math.min(data.durationSec, t * factor);
  const time = (t: number | null) => t == null ? null : scale(t);
  const logs = (lines: LogLine[]) => lines.map((line) => ({ ...line, t: scale(line.t) }));
  return {
    ...state, t: data.durationSec,
    crawl: { ...state.crawl, endedAt: time(state.crawl.endedAt), logs: logs(state.crawl.logs), samples: state.crawl.samples.map((sample) => ({ ...sample, t: scale(sample.t), pagesPerSec: sample.pagesPerSec / factor })) },
    tail: state.tail.map((stage) => ({ ...stage, startedAt: time(stage.startedAt), endedAt: time(stage.endedAt), logs: logs(stage.logs), samples: stage.samples.map((sample) => ({ ...sample, t: scale(sample.t), rowsPerSec: sample.rowsPerSec / factor })) })),
  };
}

export function useCrawlRun(scenario: CrawlScenario, dataset: RunDataset, initialSettings: CrawlSettings, archived?: "success" | "failed" | "cancelled") {
  const [state, setState] = useState<RunState>(() => archived ? archivedRun(archived, dataset, initialSettings) : initial(scenario, initialSettings, dataset));
  const failed = state.tail.find((s) => s.status === "failed");
  const done = mainDone(state);

  const ticking = (!done && !state.paused) || state.fullLh?.status === "running";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setState((s) => step(s, scenario)), TICK_REAL_MS);
    return () => clearInterval(id);
  }, [ticking, scenario]);

  const pause = useCallback(() => {
    setState((s) => (s.paused ? s : withEvent({ ...s, paused: true }, logLine(s.t, "—", "PAUSE", currentStage(s) ?? "run", {
      details: ["by you", s.crawl.status === "running" ? `${n(s.crawl.done)} pages done` : undefined],
    }))));
  }, []);
  const resume = useCallback(() => {
    setState((s) => (!s.paused ? s : withEvent({ ...s, paused: false }, logLine(s.t, "—", "RESUME", currentStage(s) ?? "run", {
      details: [`${s.settings.concurrency} workers`, `delay ${s.settings.delayMs} ms`, `timeout ${s.settings.timeoutS} s`],
    }))));
  }, []);
  // Only the settings that are editable while paused are applied; the dialog enforces the rest
  const updateSettings = useCallback((next: CrawlSettings) => {
    setState((s) => {
      const changes = describeChanges(s.settings, next);
      if (!changes) return s;
      const tail = s.tail.map((x) => (x.id === "lighthouse" && x.status !== "success"
        ? { ...x, description: `${n(auditPages(s.dataset, next).length)} pages with sample performance scores` } : x));
      return withEvent({ ...s, tail, settings: { ...s.settings, ...pickEditable(next) } }, logLine(s.t, "—", "UPDATE", "settings", { details: [changes] }));
    });
  }, []);

  // Retry from the failed step. The crawl is not repeated.
  const retry = useCallback(() => {
    setState((s) => {
      const fi = s.tail.findIndex((x) => x.status === "failed");
      if (fi < 0) return s;
      const tail = s.tail.map((x, i) => {
        if (i < fi) return x;
        if (i === fi) return { ...x, status: "running" as const, startedAt: s.t, endedAt: null, progress: 0, error: undefined, samples: [],
          logs: [...x.logs, logLine(s.t, "—", "RETRY", x.id, { details: ["attempt 2", "reusing crawl output"] })] };
        return { ...x, status: (i === fi + 1 ? "waiting" : "pending") as Stage["status"] };
      });
      return { ...s, tail, failArmed: false, cursor: { ...s.cursor, [s.tail[fi].id]: 0 } };
    });
  }, []);

  // Prototype only: fast-forward until the current stage finishes (or fails).
  const skipStage = useCallback(() => {
    setState((s) => {
      const from = currentStage(s);
      if (!from || s.paused) return s;
      let x = s;
      for (let i = 0; i < 2_000 && currentStage(x) === from; i++) x = step(x, scenario);
      return x;
    });
  }, [scenario]);

  // Follow-up job: Lighthouse on every crawled page, reusing this run's crawl output
  const runFullLighthouse = useCallback(() => {
    setState((s) => s.fullLh ? s : {
      ...s,
      fullLh: {
        id: "lighthouse-full", name: "Lighthouse · full site", description: "Every crawled page · started by you",
        status: "running", startedAt: s.t, endedAt: null, expectedSec: fullAuditDuration(s.crawl.done),
        rowsIn: 0, rowsOut: 0, rejected: 0, progress: 0, samples: [], elapsed: 0, pagesDone: 0, pagesTotal: s.crawl.done,
        logs: [logLine(s.t, "—", "START", "lighthouse full site", { details: [`${n(s.crawl.done)} pages`, "reusing crawl output"] })],
      },
    });
  }, []);

  // Derived numbers the UI shows
  const c = state.crawl;
  const target = c.total;
  const recent = c.samples.slice(-6);
  const rate = recent.length ? recent.reduce((a, x) => a + x.pagesPerSec, 0) / recent.length : 0;
  const crawlPct = c.status === "success" ? 100 : Math.min(99, (c.done / Math.max(1, target)) * 100);
  const crawlEta = c.status === "success" ? 0 : rate > 0 ? (target - c.done) / rate : null;
  const tailRemaining = state.tail.reduce((a, s) => a + (s.status === "success" ? 0 : s.expectedSec * (1 - s.progress / 100)), 0);
  const runEta = done || state.paused ? null : (crawlEta ?? 0) + tailRemaining;
  const expectedCrawlSec = crawlDuration(dataset);
  const expectedTailSec = state.tail.reduce((total, stage) => total + stage.expectedSec, 0);
  const tailDone = state.tail.reduce((total, stage) => total + (stage.progress / 100) * stage.expectedSec, 0);
  const overallPct = Math.round((crawlPct * expectedCrawlSec + tailDone * 100) / (expectedCrawlSec + expectedTailSec));
  const errors = c.codes["4xx"] + c.codes["429"] + c.codes["5xx"] + c.codes.timeout;
  const runStatus: "crawling" | "processing" | "paused" | "success" | "failed" | "cancelled" =
    c.status === "cancelled" ? "cancelled" : failed ? "failed" : done ? "success" : state.paused ? "paused" : c.status === "running" ? "crawling" : "processing";

  return {
    state, retry, skipStage, runFullLighthouse, pause, resume, updateSettings,
    canSkip: !!currentStage(state) && !state.paused, canPause: !done && !failed,
    failed, runStatus, rate, target, crawlPct, crawlEta, runEta, overallPct, errors,
    usualRate: target / expectedCrawlSec, expectedCrawlSec,
    audited: auditPages(dataset, state.settings),
  };
}

function pickEditable(s: CrawlSettings) {
  const { delayMs, timeoutS, concurrency, maxRetries, lighthouseSample } = s;
  return { delayMs, timeoutS, concurrency, maxRetries, lighthouseSample };
}
