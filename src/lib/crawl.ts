"use client";

// Simulated crawl-heavy run: one long crawl (~90% of the run), then short processing steps.
// Page total is estimated from previous crawls, so progress and ETA are real numbers.
import { useCallback, useEffect, useState } from "react";
import type { LogLine, Stage } from "@/lib/types";
import { pageAt } from "@/lib/pages";

// Request line template: "<status> GET <path> (<ms> ms[, detail])". Status first, so it lines up like an access log.
// Level follows the status class: 2xx/3xx info, 4xx warning, 5xx and network failures error.
function requestLine(t: number, status: number | null, path: string, ms: number, detail?: string): LogLine {
  const code = status == null ? "ERR" : String(status);
  const time = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  const level: LogLine["level"] = status == null || status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const tail = detail?.startsWith("→") ? ` ${detail} (${time})` : ` (${time}${detail ? `, ${detail}` : ""})`;
  return { t, level, msg: `${code} GET ${path}${tail}` };
}

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
  t: number; // seconds since run start
  crawl: CrawlState;
  tail: Stage[]; // processing steps after the crawl
  failArmed: boolean;
  fullLh: FullJob | null; // optional follow-up job, started by the user after the run
};

// A follow-up job has its own clock: it runs after the main run has finished
export type FullJob = Stage & { elapsed: number; pagesDone: number; pagesTotal: number };
export const FULL_LH_SEC = 13_200; // ~3h 40m for the whole site, from previous full audits
const FULL_LH_DT = 300; // simulated seconds per tick (~11s real time)

// Estimate from the last 5 crawls of this site
export const PREVIOUS_CRAWLS = [47_910, 48_050, 48_200, 48_640, 49_010];
export const ESTIMATED_PAGES = 48_200; // median
export const USUAL_CRAWL_SEC = 1_260; // ~21 min
export const TICK_REAL_MS = 250;
const DT = 7.5; // simulated seconds per tick (crawl ≈ 40s of real time)

const TAIL_DEFS = [
  { id: "parse", name: "Parse", description: "Extract product fields from 49K HTML pages", sec: 60 },
  { id: "transform", name: "Transform", description: "Normalise prices, dedupe, join catalogue", sec: 75 },
  { id: "load", name: "Load", description: "Upsert into ANALYTICS.PRODUCTS", sec: 45 },
  { id: "lighthouse", name: "Lighthouse", description: "Sample of 200 pages · performance, accessibility, SEO", sec: 90 },
  { id: "publish", name: "Publish", description: "Refresh dashboards, notify #pricing", sec: 20 },
];
export const USUAL_TOTAL_SEC = USUAL_CRAWL_SEC + TAIL_DEFS.reduce((a, d) => a + d.sec, 0);

const TAIL_LOGS: Record<string, string[]> = {
  parse: ["$ parse --schema product.v3", "Parsed 49,350 pages (1,204 skipped, no product block)"],
  transform: ["$ dbt build --select +fct_prices", "Built view stg_products", "Built table int_price_history", "Built table fct_prices"],
  load: ["$ warehouse upsert PRODUCTS", "Upserted 48,146 rows into PRODUCTS", "Wrote audit row"],
  lighthouse: ["$ lighthouse --sample 200", "Audited 100 of 200 pages (median performance 71)", "Audited 200 of 200 pages (median performance 72)", "Finished sample (performance 72, accessibility 91, best practices 96, SEO 98)"],
  publish: ["$ publish --dashboards pricing_*", "Refreshed 6 dashboards", "Posted summary to #pricing"],
};
const FAIL_LOGS = [
  "Failed model fct_prices (Numeric value '1.299,00' is not recognized)",
  "Found 3,412 prices with a comma decimal separator (locale de-DE)",
];

function initial(scenario: CrawlScenario): RunState {
  return {
    t: 0,
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
        { t: 0, level: "cmd", msg: "$ crawler run shop.example.com --sitemap --max-concurrency 64" },
        { t: 0, level: "info", msg: "Seeded 1,200 URLs from sitemap.xml (expecting ~48,200 pages)" },
      ],
      backoffUntil: null,
    },
    tail: TAIL_DEFS.map((d, i) => ({
      id: d.id, name: d.name, description: d.description,
      status: i === 0 ? "waiting" : "pending",
      startedAt: null, endedAt: null, expectedSec: d.sec,
      rowsIn: 0, rowsOut: 0, rejected: 0, progress: 0, logs: [], samples: [],
    })),
  };
}

const wave = (t: number, seed: number) => 0.86 + 0.1 * Math.sin(t / 37 + seed) + 0.05 * Math.sin(t / 9 + seed * 3);

function stepCrawl(c: CrawlState, t: number, scenario: CrawlScenario): CrawlState {
  const tau = 260;
  const discovered = Math.min(c.total, Math.round(1_200 + c.total * 1.03 * (1 - Math.exp(-t / tau))));
  const limited = scenario === "ratelimited" && t > 420 && t < 720;
  const base = 41 * wave(t, 1) * (limited ? 0.32 : 1);
  const queue = discovered - c.done;
  const fetched = Math.max(0, Math.min(queue, Math.round(base * DT)));
  const done = c.done + fetched;

  // One log line per HTTP request, generated from the same rows as the Pages table,
  // so the log, the response-code bar and the table always agree.
  const codes = { ...c.codes };
  const logs = [...c.logs];
  const tick = Math.round(t / DT);
  const n429 = limited ? Math.round(fetched * 0.18) : 0;
  const end = Math.min(done, c.total);
  const span = Math.max(1, end - c.done + n429);
  let k = 0;
  const at = () => t - DT + (DT * k++) / span; // spread the requests across the tick
  for (let i = 0; i < n429; i++) {
    codes["429"] += 1;
    logs.push(requestLine(at(), 429, pageAt(c.done + i).path, 40 + (i % 30), "backing off"));
  }
  for (let i = c.done; i < end; i++) {
    const p = pageAt(i);
    if (p.kind === "skipped") { at(); continue; } // never requested: shows in the Pages table only
    for (const h of p.hops) {
      if (h.side === "server") { codes["3xx"] += 1; logs.push(requestLine(at(), Number(h.via), h.from, Math.round((p.fetchMs ?? 200) / 3), `→ ${h.to}`)); }
    }
    const clientHop = p.hops.find((h) => h.side === "client");
    if (p.kind === "timeout") { codes.timeout += 1; logs.push(requestLine(at(), null, p.path, 30_000, "timed out after 30s")); continue; }
    if (p.kind === "loop") { logs.push(requestLine(at(), null, p.path, 0, "redirect loop, gave up after 10 hops")); continue; }
    const status = p.kind === "redirect" ? 200 : (p.status ?? 200);
    const url = clientHop ? clientHop.from : p.kind === "redirect" ? p.finalPath! : p.path;
    codes[status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx"] += 1;
    logs.push(requestLine(at(), status, url, p.fetchMs ?? 0,
      clientHop ? `→ ${clientHop.to}, client-side ${clientHop.via}` : p.kind === "server" ? "after 3 attempts" : undefined));
  }

  if (tick % 4 === 0) logs.push({ t, level: "info", msg: `Crawled ${end.toLocaleString("en-US")} pages (${Math.round(base)}/s, ${(discovered - done).toLocaleString("en-US")} queued)` });
  if (limited && tick % 3 === 0) logs.push({ t, level: "warn", msg: "Rate limited by shop.example.com (429, backing off 30s, concurrency 64 → 16)" });
  if (scenario === "ratelimited" && Math.abs(t - 720) < DT / 2) logs.push({ t, level: "info", msg: "Resumed full speed (concurrency 64)" });

  const finished = done >= c.total;
  if (finished) logs.push({ t, level: "info", msg: `Finished crawl: ${c.total.toLocaleString("en-US")} pages (+${(((c.total - ESTIMATED_PAGES) / ESTIMATED_PAGES) * 100).toFixed(1)}% vs expected)` });

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
  const tail = state.tail.map((s) => ({ ...s }));
  let i = tail.findIndex((s) => s.status === "running");
  if (i < 0) {
    i = tail.findIndex((s) => s.status === "waiting");
    if (i < 0) return state;
    tail[i] = { ...tail[i], status: "running", startedAt: state.t, logs: [{ t: state.t, level: "cmd", msg: TAIL_LOGS[tail[i].id][0] }] };
    if (tail[i + 1]) tail[i + 1] = { ...tail[i + 1], status: "waiting" };
  }
  const s = tail[i];
  const lines = TAIL_LOGS[s.id];
  const p = Math.min(100, s.progress + (DT / s.expectedSec) * 100);
  const shown = Math.min(lines.length, 1 + Math.floor((p / 100) * (lines.length - 1) + 0.0001));
  // Count only lines printed in the current attempt (after the last retry marker)
  const marker = s.logs.map((l) => l.msg.startsWith("Retrying from")).lastIndexOf(true);
  const printed = s.logs.length - (marker + 1);
  s.logs = [...s.logs, ...lines.slice(printed, shown).map((msg) => ({ t: state.t, level: "info" as const, msg }))];
  s.progress = p;
  s.samples = [...s.samples, { t: state.t, rowsPerSec: Math.round(800 * wave(state.t, i + 2)), rows: Math.round(49_350 * (p / 100)) }];

  if (state.failArmed && s.id === "transform" && p >= 70) {
    s.status = "failed";
    s.endedAt = state.t;
    s.error = "Numeric value '1.299,00' is not recognized in fct_prices";
    s.logs = [...s.logs, ...FAIL_LOGS.map((msg) => ({ t: state.t, level: "error" as const, msg }))];
    for (let j = i + 1; j < tail.length; j++) tail[j] = { ...tail[j], status: "blocked" };
    return { ...state, tail };
  }
  if (p >= 100) {
    s.status = "success";
    s.endedAt = state.t;
    if (tail[i + 1]) tail[i + 1] = { ...tail[i + 1], status: "waiting" };
  }
  return { ...state, tail };
}

function mainDone(s: RunState) {
  return s.tail.some((x) => x.status === "failed") || s.tail.every((x) => x.status === "success");
}

function stepFullLh(j: FullJob): FullJob {
  const elapsed = j.elapsed + FULL_LH_DT;
  const progress = Math.min(100, (elapsed / j.expectedSec) * 100);
  const pagesDone = Math.round((progress / 100) * j.pagesTotal);
  const logs = [...j.logs];
  const tick = Math.round(elapsed / FULL_LH_DT);
  if (tick % 4 === 0) logs.push({ t: j.startedAt! + elapsed, level: "info", msg: `Audited ${pagesDone.toLocaleString("en-US")} of ${j.pagesTotal.toLocaleString("en-US")} pages (median performance ${70 + (tick % 4)})` });
  if (tick % 9 === 4) logs.push({ t: j.startedAt! + elapsed, level: "warn", msg: `Timed out /search?q=${tick * 31} (after 60s, will retry)` });
  const finished = progress >= 100;
  if (finished) logs.push({ t: j.startedAt! + elapsed, level: "info", msg: "Finished full-site audit (performance 70, accessibility 90, best practices 95, SEO 97)" });
  return {
    ...j, elapsed, progress, pagesDone, logs,
    samples: [...j.samples, { t: j.startedAt! + elapsed, rowsPerSec: Math.round(3.6 * 60 * wave(elapsed, 7)), rows: pagesDone }],
    status: finished ? "success" : "running",
    endedAt: finished ? j.startedAt! + elapsed : null,
  };
}

function step(state: RunState, scenario: CrawlScenario): RunState {
  let next: RunState = state;
  if (!mainDone(state)) {
    const t = state.t + DT;
    next = { ...state, t };
    next = state.crawl.status === "running" ? { ...next, crawl: stepCrawl(state.crawl, t, scenario) } : stepTail(next);
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

export function useCrawlRun(scenario: CrawlScenario) {
  const [state, setState] = useState<RunState>(() => initial(scenario));
  const failed = state.tail.find((s) => s.status === "failed");
  const done = !!failed || state.tail.every((s) => s.status === "success");

  const ticking = !done || state.fullLh?.status === "running";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setState((s) => step(s, scenario)), TICK_REAL_MS);
    return () => clearInterval(id);
  }, [ticking, scenario]);

  // Retry from the failed step. The crawl is not repeated.
  const retry = useCallback(() => {
    setState((s) => {
      const fi = s.tail.findIndex((x) => x.status === "failed");
      if (fi < 0) return s;
      const tail = s.tail.map((x, i) => {
        if (i < fi) return x;
        if (i === fi) return { ...x, status: "running" as const, startedAt: s.t, endedAt: null, progress: 0, error: undefined, samples: [],
          logs: [...x.logs, { t: s.t, level: "cmd" as const, msg: "Retrying from this step (attempt 2, reusing crawl output)" }] };
        return { ...x, status: (i === fi + 1 ? "waiting" : "pending") as Stage["status"] };
      });
      return { ...s, tail, failArmed: false };
    });
  }, []);

  // Prototype only: fast-forward until the current stage finishes (or fails).
  // Runs the normal ticks, so charts, logs and the failure scenario behave as they would.
  const skipStage = useCallback(() => {
    setState((s) => {
      const from = currentStage(s);
      if (!from) return s;
      let n = s;
      for (let i = 0; i < 2_000 && currentStage(n) === from; i++) n = step(n, scenario);
      return n;
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
        logs: [
          { t: s.t, level: "cmd", msg: `$ lighthouse --all --input runs/812/pages.parquet --concurrency 8` },
          { t: s.t, level: "info", msg: `Queued ${s.crawl.done.toLocaleString("en-US")} pages (reusing crawl output)` },
        ],
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
  const runEta = failed ? null : (crawlEta ?? 0) + tailRemaining;
  const crawlWeight = USUAL_CRAWL_SEC / USUAL_TOTAL_SEC;
  const tailDone = state.tail.reduce((a, s) => a + (s.status === "success" ? s.expectedSec : (s.progress / 100) * s.expectedSec), 0);
  const overallPct = Math.round(crawlPct * crawlWeight + (tailDone / (USUAL_TOTAL_SEC - USUAL_CRAWL_SEC)) * 100 * (1 - crawlWeight));
  const errors = c.codes["4xx"] + c.codes["429"] + c.codes["5xx"] + c.codes.timeout;
  const runStatus: "crawling" | "processing" | "success" | "failed" =
    failed ? "failed" : c.status === "running" ? "crawling" : done ? "success" : "processing";

  return {
    state, retry, skipStage, runFullLighthouse, canSkip: !!currentStage(state), failed, runStatus, rate, target, crawlPct, crawlEta, runEta, overallPct, errors,
    usualRate: ESTIMATED_PAGES / USUAL_CRAWL_SEC,
  };
}
