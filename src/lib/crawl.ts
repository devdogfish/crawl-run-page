// PROTOTYPE SIMULATOR. Replaced by the API in slice 1 (see SLICES.md).
// A crawl-heavy run: one long crawl (~90% of the run), then short processing steps.
// Supports pause/resume and live settings changes, like the real run page will.
import { useCallback, useEffect, useState } from "react";
import type { LogLevel, LogLine, Stage } from "@/lib/types";
import { fmtDur } from "@/lib/types";
import { pageAt } from "@/lib/pages";
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
export type CrawlStatus = "running" | "success" | "failed";
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
};

export type FullJob = Stage & { elapsed: number; pagesDone: number; pagesTotal: number };
export const FULL_LH_SEC = 13_200; // ~3h 40m for the whole site, from previous full audits
const FULL_LH_DT = 300; // simulated seconds per tick (~11s real time)

export const PREVIOUS_CRAWLS = [47_910, 48_050, 48_200, 48_640, 49_010];
export const ESTIMATED_PAGES = 48_200; // median of the last 5 crawls
export const USUAL_CRAWL_SEC = 1_260; // ~21 min
export const TICK_REAL_MS = 250;
const DT = 7.5; // simulated seconds per tick (crawl ≈ 40s of real time)

const TAIL_DEFS = [
  { id: "parse", name: "Parse", description: "Extract product fields from the crawled pages", sec: 60 },
  { id: "transform", name: "Transform", description: "Normalise prices, dedupe, join catalogue", sec: 75 },
  { id: "load", name: "Load", description: "Upsert into ANALYTICS.PRODUCTS", sec: 45 },
  { id: "lighthouse", name: "Lighthouse", description: "Sample of pages · performance, accessibility, SEO", sec: 90 },
  { id: "publish", name: "Publish", description: "Refresh dashboards, notify #pricing", sec: 20 },
];
export const USUAL_TOTAL_SEC = USUAL_CRAWL_SEC + TAIL_DEFS.reduce((a, d) => a + d.sec, 0);

// Lines each processing step prints, positioned by progress (0..1)
type Scripted = { at: number; outcome: string; action: string; subject: string; ms?: number; details?: string[] };
function tailScript(id: string, s: CrawlSettings): Scripted[] {
  if (id === "parse") {
    return [0, 1, 2, 3, 4].map((b) => {
      const to = Math.min(49_350, (b + 1) * 10_000);
      return { at: (b + 1) / 5.2, outcome: "OK", action: "PARSE", subject: `pages ${n(b * 10_000 + 1)}–${n(to)}`, ms: 11_000 + b * 400, details: [`${n(to - b * 10_000 - 246)} products`, "246 skipped"] };
    });
  }
  if (id === "transform") {
    return [
      { at: 0.2, outcome: "OK", action: "BUILD", subject: "view stg_products", ms: 8_200 },
      { at: 0.5, outcome: "OK", action: "BUILD", subject: "table int_price_history", ms: 21_400 },
      { at: 0.95, outcome: "OK", action: "BUILD", subject: "table fct_prices", ms: 31_000, details: ["48,146 rows"] },
    ];
  }
  if (id === "load") {
    return [
      { at: 0.7, outcome: "OK", action: "UPSERT", subject: "table PRODUCTS", ms: 12_300, details: ["48,146 rows"] },
      { at: 0.9, outcome: "OK", action: "INSERT", subject: "audit row", ms: 100 },
    ];
  }
  if (id === "lighthouse") {
    const total = s.lighthouseSample;
    return Array.from({ length: total }, (_, i) => {
      const path = pageAt((i * 241) % 49_350).path;
      const failed = i % 25 === 24;
      return failed
        ? { at: ((i + 1) / total) * 0.98, outcome: "ERR", action: "AUDIT", subject: path, ms: 60_000, details: ["timed out"] }
        : { at: ((i + 1) / total) * 0.98, outcome: "OK", action: "AUDIT", subject: path, ms: 2_400 + ((i * 53) % 2_000), details: [`performance ${55 + ((i * 37) % 40)}`] };
    });
  }
  return [
    { at: 0.3, outcome: "OK", action: "REFRESH", subject: "dashboard pricing_overview", ms: 1_200 },
    { at: 0.5, outcome: "OK", action: "REFRESH", subject: "dashboard pricing_by_brand", ms: 900 },
    { at: 0.8, outcome: "OK", action: "POST", subject: "message to #pricing", ms: 300 },
  ];
}
const TAIL_START: Record<string, (s: CrawlSettings) => string[]> = {
  parse: () => ["49,350 pages"],
  transform: () => ["3 models"],
  load: () => ["48,146 rows"],
  lighthouse: (s) => [`${s.lighthouseSample} pages`],
  publish: () => ["2 dashboards, 1 message"],
};
const TAIL_DONE: Record<string, (s: CrawlSettings) => string[]> = {
  parse: () => ["48,146 products", "1,204 skipped"],
  transform: () => ["3 models"],
  load: () => ["48,146 rows"],
  lighthouse: (s) => [`${s.lighthouseSample} pages`, "performance 72", "accessibility 91", "best practices 96", "SEO 98"],
  publish: () => ["2 dashboards, 1 message"],
};

function initial(scenario: CrawlScenario, settings: CrawlSettings): RunState {
  return {
    t: 0,
    paused: false,
    settings,
    cursor: {},
    failArmed: scenario === "failure",
    fullLh: null,
    crawl: {
      status: "running",
      startedAt: 0,
      endedAt: null,
      done: 0,
      discovered: 1_200,
      total: 49_350,
      codes: { "2xx": 0, "3xx": 0, "4xx": 0, "429": 0, "5xx": 0, timeout: 0 },
      samples: [],
      logs: [
        logLine(0, "—", "START", `crawl ${settings.url}`, { details: [`${settings.concurrency} workers`, `delay ${settings.delayMs} ms`, `timeout ${settings.timeoutS} s`] }),
        logLine(0, "—", "SEED", "1,200 URLs from sitemap.xml", { details: [`expecting ~${n(ESTIMATED_PAGES)} pages`] }),
      ],
      backoffUntil: null,
    },
    tail: TAIL_DEFS.map((d, i) => ({
      id: d.id, name: d.name, description: d.id === "lighthouse" ? `Sample of ${settings.lighthouseSample} pages · performance, accessibility, SEO` : d.description,
      status: i === 0 ? "waiting" : "pending",
      startedAt: null, endedAt: null, expectedSec: d.sec,
      rowsIn: 0, rowsOut: 0, rejected: 0, progress: 0, logs: [], samples: [],
    })),
  };
}

const wave = (t: number, seed: number) => 0.86 + 0.1 * Math.sin(t / 37 + seed) + 0.05 * Math.sin(t / 9 + seed * 3);
// Fewer workers or a longer delay → slower crawl (baseline: 64 workers, 250 ms delay, ~400 ms responses)
const speed = (s: CrawlSettings) => Math.min(3, Math.max(0.1, (s.concurrency / 64) * (650 / (s.delayMs + 400))));

function stepCrawl(c: CrawlState, t: number, scenario: CrawlScenario, s: CrawlSettings): CrawlState {
  const discovered = Math.min(c.total, Math.round(1_200 + c.total * 1.03 * (1 - Math.exp(-t / 260))));
  const limited = scenario === "ratelimited" && t > 420 && t < 720;
  const base = 41 * wave(t, 1) * speed(s) * (limited ? 0.32 : 1);
  const fetched = Math.max(0, Math.min(discovered - c.done, Math.round(base * DT)));
  const done = c.done + fetched;

  // One line per HTTP request, generated from the same rows as the Pages table,
  // so the log, the response-code bar and the table always agree.
  const codes = { ...c.codes };
  const logs = [...c.logs];
  const tick = Math.round(t / DT);
  const n429 = limited ? Math.round(fetched * 0.18) : 0;
  const end = Math.min(done, c.total);
  const span = Math.max(1, end - c.done + n429);
  let k = 0;
  const at = () => t - DT + (DT * k++) / span; // spread the requests across the tick
  if (limited && !c.backoffUntil) logs.push(logLine(t - DT, "—", "THROTTLE", hostOf(s.url), { details: ["429 responses", `${s.concurrency} → ${Math.round(s.concurrency / 4)} workers`, "backing off 30 s"] }));
  for (let i = 0; i < n429; i++) {
    codes["429"] += 1;
    logs.push(logLine(at(), 429, "GET", pageAt(c.done + i).path, { ms: 40 + (i % 30), details: ["will retry"] }));
  }
  for (let i = c.done; i < end; i++) {
    const p = pageAt(i);
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
      to: clientHop?.to, ms: p.fetchMs ?? 0,
      details: [clientHop && `client-side ${clientHop.via}`, p.kind === "server" && `after ${s.maxRetries + 1} attempts`],
    }));
  }
  if (c.backoffUntil && !limited) logs.push(logLine(t, "—", "THROTTLE", hostOf(s.url), { details: ["recovered", `${Math.round(s.concurrency / 4)} → ${s.concurrency} workers`] }));
  if (tick % 4 === 0) logs.push(logLine(t, "—", "PROGRESS", `${n(end)} pages`, { details: [`${Math.round(base)}/s`, `${n(discovered - done)} queued`] }));

  const finished = done >= c.total;
  if (finished) logs.push(logLine(t, "OK", "DONE", "crawl", { ms: t * 1000, details: [`${n(c.total)} pages`, `+${(((c.total - ESTIMATED_PAGES) / ESTIMATED_PAGES) * 100).toFixed(1)}% vs expected`] }));

  return {
    ...c,
    done: Math.min(done, c.total),
    discovered,
    codes,
    logs, // every request is kept; the viewer is virtualised
    samples: [...c.samples, { t, pagesPerSec: Math.round(base), queue: Math.max(0, discovered - done), done }],
    status: finished ? "success" : "running",
    endedAt: finished ? t : null,
    backoffUntil: limited ? 720 : null,
  };
}

function stepTail(state: RunState): RunState {
  const tail = state.tail.map((x) => ({ ...x }));
  const cursor = { ...state.cursor };
  const st = state.settings;
  let i = tail.findIndex((x) => x.status === "running");
  if (i < 0) {
    i = tail.findIndex((x) => x.status === "waiting");
    if (i < 0) return state;
    tail[i] = { ...tail[i], status: "running", startedAt: state.t, logs: [...tail[i].logs, logLine(state.t, "—", "START", tail[i].id, { details: TAIL_START[tail[i].id](st) })] };
    cursor[tail[i].id] = 0;
    if (tail[i + 1]) tail[i + 1] = { ...tail[i + 1], status: "waiting" };
  }
  const s = tail[i];
  const script = tailScript(s.id, st);
  const p = Math.min(100, s.progress + (DT / s.expectedSec) * 100);
  const due = script.filter((x) => x.at <= p / 100).length;
  const from = cursor[s.id] ?? 0;
  s.logs = [...s.logs, ...script.slice(from, due).map((x, j) =>
    logLine(state.t - DT + (DT * (j + 1)) / Math.max(1, due - from), x.outcome, x.action, x.subject, { ms: x.ms, details: x.details }))];
  cursor[s.id] = Math.max(from, due);
  s.progress = p;
  s.samples = [...s.samples, { t: state.t, rowsPerSec: Math.round(800 * wave(state.t, i + 2)), rows: Math.round(49_350 * (p / 100)) }];

  if (state.failArmed && s.id === "transform" && p >= 70) {
    s.status = "failed";
    s.endedAt = state.t;
    s.error = "Numeric value '1.299,00' is not recognized in fct_prices";
    s.logs = [...s.logs,
      logLine(state.t, "ERR", "BUILD", "table fct_prices", { ms: 14_000, details: ["Numeric value '1.299,00' is not recognized", "3,412 prices use a comma decimal separator"] }),
      logLine(state.t, "ERR", "STOP", "transform", { ms: (state.t - s.startedAt!) * 1000, details: ["1 model failed", "later steps not run"] })];
    for (let j = i + 1; j < tail.length; j++) tail[j] = { ...tail[j], status: "blocked" };
    return { ...state, tail, cursor };
  }
  if (p >= 100) {
    s.status = "success";
    s.endedAt = state.t;
    s.logs = [...s.logs, logLine(state.t, "OK", "DONE", s.id, { ms: (state.t - s.startedAt!) * 1000, details: TAIL_DONE[s.id](st) })];
    if (tail[i + 1]) tail[i + 1] = { ...tail[i + 1], status: "waiting" };
  }
  return { ...state, tail, cursor };
}

function mainDone(s: RunState) {
  return s.tail.some((x) => x.status === "failed") || s.tail.every((x) => x.status === "success");
}

function stepFullLh(j: FullJob): FullJob {
  const elapsed = j.elapsed + FULL_LH_DT;
  const progress = Math.min(100, (elapsed / j.expectedSec) * 100);
  const pagesDone = Math.round((progress / 100) * j.pagesTotal);
  const logs = [...j.logs];
  const now = j.startedAt! + elapsed;
  for (let i = j.pagesDone; i < pagesDone; i++) {
    const t = now - FULL_LH_DT + (FULL_LH_DT * (i - j.pagesDone + 1)) / Math.max(1, pagesDone - j.pagesDone);
    logs.push(i % 61 === 60
      ? logLine(t, "ERR", "AUDIT", pageAt(i).path, { ms: 60_000, details: ["timed out"] })
      : logLine(t, "OK", "AUDIT", pageAt(i).path, { ms: 2_400 + ((i * 53) % 2_000), details: [`performance ${55 + ((i * 37) % 40)}`] }));
  }
  const finished = progress >= 100;
  if (finished) logs.push(logLine(now, "OK", "DONE", "lighthouse full site", { ms: elapsed * 1000, details: [`${n(j.pagesTotal)} pages`, "performance 70", "accessibility 90", "best practices 95", "SEO 97"] }));
  return {
    ...j, elapsed, progress, pagesDone, logs,
    samples: [...j.samples, { t: now, rowsPerSec: Math.round(3.6 * 60 * wave(elapsed, 7)), rows: pagesDone }],
    status: finished ? "success" : "running",
    endedAt: finished ? now : null,
  };
}

function step(state: RunState, scenario: CrawlScenario): RunState {
  let next: RunState = state;
  if (!state.paused && !mainDone(state)) {
    const t = state.t + DT;
    next = { ...state, t };
    next = state.crawl.status === "running" ? { ...next, crawl: stepCrawl(state.crawl, t, scenario, state.settings) } : stepTail(next);
  }
  if (next.fullLh?.status === "running") next = { ...next, fullLh: stepFullLh(next.fullLh) };
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

export function useCrawlRun(scenario: CrawlScenario, initialSettings: CrawlSettings = DEFAULT_SETTINGS, finished = false) {
  // finished: open an already-completed crawl (from the list) by running the simulation to the end up front
  const [state, setState] = useState<RunState>(() => {
    let x = initial(scenario, initialSettings);
    if (finished) for (let i = 0; i < 5_000 && !mainDone(x); i++) x = step(x, scenario);
    return x;
  });
  const failed = state.tail.find((s) => s.status === "failed");
  const done = !!failed || state.tail.every((s) => s.status === "success");

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
        ? { ...x, description: `Sample of ${next.lighthouseSample} pages · performance, accessibility, SEO` } : x));
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
        status: "running", startedAt: s.t, endedAt: null, expectedSec: FULL_LH_SEC,
        rowsIn: 0, rowsOut: 0, rejected: 0, progress: 0, samples: [], elapsed: 0, pagesDone: 0, pagesTotal: s.crawl.done,
        logs: [logLine(s.t, "—", "START", "lighthouse full site", { details: [`${n(s.crawl.done)} pages`, "reusing crawl output"] })],
      },
    });
  }, []);

  // Derived numbers the UI shows
  const c = state.crawl;
  const target = Math.max(ESTIMATED_PAGES, c.discovered);
  const recent = c.samples.slice(-6);
  const rate = recent.length ? recent.reduce((a, x) => a + x.pagesPerSec, 0) / recent.length : 0;
  const crawlPct = c.status === "success" ? 100 : Math.min(99, (c.done / target) * 100);
  const crawlEta = c.status === "success" ? 0 : rate > 0 ? (target - c.done) / rate : null;
  const tailRemaining = state.tail.reduce((a, s) => a + (s.status === "success" ? 0 : s.expectedSec * (1 - s.progress / 100)), 0);
  const runEta = failed || state.paused ? null : (crawlEta ?? 0) + tailRemaining;
  const crawlWeight = USUAL_CRAWL_SEC / USUAL_TOTAL_SEC;
  const tailDone = state.tail.reduce((a, s) => a + (s.status === "success" ? s.expectedSec : (s.progress / 100) * s.expectedSec), 0);
  const overallPct = Math.round(crawlPct * crawlWeight + (tailDone / (USUAL_TOTAL_SEC - USUAL_CRAWL_SEC)) * 100 * (1 - crawlWeight));
  const errors = c.codes["4xx"] + c.codes["429"] + c.codes["5xx"] + c.codes.timeout;
  const runStatus: "crawling" | "processing" | "paused" | "success" | "failed" =
    failed ? "failed" : done ? "success" : state.paused ? "paused" : c.status === "running" ? "crawling" : "processing";

  return {
    state, retry, skipStage, runFullLighthouse, pause, resume, updateSettings,
    canSkip: !!currentStage(state) && !state.paused, canPause: !done && !failed,
    failed, runStatus, rate, target, crawlPct, crawlEta, runEta, overallPct, errors,
    usualRate: ESTIMATED_PAGES / USUAL_CRAWL_SEC,
  };
}

function pickEditable(s: CrawlSettings) {
  const { delayMs, timeoutS, concurrency, maxRetries, lighthouseSample } = s;
  return { delayMs, timeoutS, concurrency, maxRetries, lighthouseSample };
}
