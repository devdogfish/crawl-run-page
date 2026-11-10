import { useState } from "react";
import {
  LuActivity, LuArrowRight, LuCheck, LuChevronRight, LuFileText, LuGauge, LuPause,
  LuPlay, LuRotateCcw, LuSearch, LuTimer, LuTriangleAlert,
} from "react-icons/lu";
import { CATEGORIES } from "./model";
import type { Category, Crawl, DemoPage, Severity, getTrend, groupIssues, summarize } from "./model";

type Issue = ReturnType<typeof groupIssues>[number];
type Metrics = ReturnType<typeof summarize>;
type Trend = ReturnType<typeof getTrend>;

export const SEVERITY_LABELS = { critical: "Critical", warning: "Warning", notice: "Notice" };

export function dateLabel(date: string, year = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC",
  }).format(new Date(date));
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`sl-severity sl-severity-${severity}`}><i aria-hidden />{SEVERITY_LABELS[severity]}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: () => void }) {
  return (
    <div className="sl-empty">
      <span className="sl-empty-icon"><LuSearch aria-hidden /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && <button className="sl-button" type="button" onClick={action}>Reset filters</button>}
    </div>
  );
}

function TrendChart({ trend }: { trend: Trend }) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const scored = trend.flatMap((point, index) => point.score === null ? [] : [{ ...point, score: point.score, index }]);
  if (!scored.length) return <EmptyState title="No matching snapshots" description="Adjust the filters to see the health trend." />;

  const first = Date.parse(trend[0].date);
  const last = Date.parse(trend[trend.length - 1].date);
  const lower = Math.min(70, Math.floor(Math.min(...scored.map(({ score }) => score)) / 10) * 10);
  const ticks = [100, 100 - (100 - lower) / 3, lower + (100 - lower) / 3, lower];
  const x = (date: string) => first === last ? 50 : 2 + 96 * (Date.parse(date) - first) / (last - first);
  const y = (score: number) => (100 - score) / (100 - lower) * 100;
  const coords = scored.map((point) => `${x(point.date)},${y(point.score)}`);
  const line = `M ${coords.join(" L ")}`;
  const area = `${line} L ${x(scored[scored.length - 1].date)},100 L ${x(scored[0].date)},100 Z`;
  const active = scored.find((point) => point.index === activeIndex) ?? scored[scored.length - 1];

  return (
    <>
      <div className="sl-trend-readout" aria-live="polite">
        <span><i aria-hidden /> Health score</span>
        <span><strong>{active.score}</strong><span className="sl-muted"> / 100</span> <span className="sl-trend-date">· {dateLabel(active.date)}</span></span>
      </div>
      <div className="sl-chart">
        <div className="sl-chart-ticks" aria-hidden>{ticks.map((tick) => <span key={tick}>{Math.round(tick)}</span>)}</div>
        <div className="sl-chart-body">
          <div className="sl-chart-plot" onMouseLeave={() => setActiveIndex(undefined)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="sl-trend-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#6655d6" stopOpacity=".20" />
                  <stop offset="1" stopColor="#6655d6" stopOpacity=".01" />
                </linearGradient>
              </defs>
              {[0, 100 / 3, 200 / 3, 100].map((value) => <line key={value} x1="0" x2="100" y1={value} y2={value} className="sl-grid-line" vectorEffect="non-scaling-stroke" />)}
              <path d={area} fill="url(#sl-trend-fill)" />
              <line x1={x(active.date)} x2={x(active.date)} y1={y(active.score)} y2={100} className="sl-trend-guide" vectorEffect="non-scaling-stroke" />
              <path d={line} className="sl-trend-line" vectorEffect="non-scaling-stroke" />
            </svg>
            {scored.map((point) => (
              <button
                key={point.date}
                className="sl-chart-point"
                style={{ left: `${x(point.date)}%`, top: `${y(point.score)}%` }}
                type="button"
                aria-label={`${dateLabel(point.date)}, health score ${point.score} out of 100`}
                aria-pressed={active.index === point.index}
                onFocus={() => setActiveIndex(point.index)}
                onBlur={() => setActiveIndex(undefined)}
                onMouseEnter={() => setActiveIndex(point.index)}
                onClick={() => setActiveIndex(point.index)}
              />
            ))}
          </div>
          <div className="sl-chart-labels" aria-hidden>
            {trend.filter((_, index) => index === 0 || index === Math.floor(trend.length / 2) || index === trend.length - 1)
              .map(({ date }) => (
                <span key={date} style={{ left: `${x(date)}%` }}>{dateLabel(date)}</span>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function Summary({ metrics, trend, onCategory }: { metrics: Metrics; trend: Trend; onCategory: (id: Category) => void }) {
  const stats = [
    { label: "Health score", value: metrics.score ?? "–", unit: metrics.score === null ? "" : "/ 100", hint: "Average page health", icon: LuGauge, color: "violet" },
    { label: "Pages audited", value: metrics.pages, hint: `${metrics.healthy} without findings`, icon: LuFileText, color: "blue" },
    { label: "Open findings", value: metrics.issues, hint: `${metrics.critical} critical`, icon: LuTriangleAlert, color: "orange" },
    { label: "Avg. response", value: metrics.responseMs === null ? "–" : Math.round(metrics.responseMs).toLocaleString(), unit: metrics.responseMs === null ? "" : "ms", hint: "Across matched pages", icon: LuTimer, color: "teal" },
  ];
  const largest = Math.max(1, ...metrics.categories.map(({ issues }) => issues));

  return (
    <>
      <div className="sl-metrics" aria-label="Audit summary">
        {stats.map(({ label, value, unit, hint, icon: Icon, color }) => (
          <section key={label} className="sl-metric">
            <div className="sl-metric-heading">
              <span className={`sl-metric-icon sl-color-${color}`}><Icon aria-hidden /></span>
              <h2>{label}</h2>
            </div>
            <div className="sl-metric-value">{value}<small>{unit}</small></div>
            <p>{hint}</p>
          </section>
        ))}
      </div>
      <div className="sl-insights">
        <section className="sl-panel sl-trend-panel">
          <div className="sl-panel-heading">
            <div><h2>Health over time</h2><p>Average score across saved snapshots.</p></div>
            <span className="sl-panel-icon"><LuActivity aria-hidden /></span>
          </div>
          <TrendChart trend={trend} />
        </section>
        <section className="sl-panel">
          <div className="sl-panel-heading"><div><h2>Findings by category</h2><p>Select a category to see its issues.</p></div></div>
          <div className="sl-categories">
            {metrics.categories.map(({ id, label, issues }) => (
              <button className={`sl-category sl-category-${id}`} key={id} type="button" onClick={() => onCategory(id)} aria-label={`${label}, ${issues} findings`}>
                <span className="sl-category-label"><span><i aria-hidden />{label}</span><strong>{issues}</strong></span>
                <span className="sl-bar-track" aria-hidden><span style={{ width: `${100 * issues / largest}%` }} /></span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export function IssueList({ issues, onIssue }: { issues: Issue[]; onIssue: (issue: Issue) => void }) {
  if (!issues.length) return <EmptyState title="No matching issues" description="Change the filters to see more findings." />;
  return (
    <ul className="sl-issue-list">
      {issues.map((issue) => (
        <li key={issue.ruleId}>
          <button className="sl-issue-row" type="button" onClick={() => onIssue(issue)}>
            <span className={`sl-issue-icon sl-issue-${issue.severity}`}><LuTriangleAlert aria-hidden /></span>
            <span className="sl-issue-title"><strong>{issue.title}</strong><small>{CATEGORIES.find(({ id }) => id === issue.category)?.label}</small></span>
            <SeverityBadge severity={issue.severity} />
            <span className="sl-affected"><strong>{issue.pages}</strong> {issue.pages === 1 ? "page" : "pages"}</span>
            <LuChevronRight className="sl-row-arrow" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PageTable({ pages, onPage }: { pages: DemoPage[]; onPage: (page: DemoPage) => void }) {
  return (
    <div className="sl-table-scroll" tabIndex={0} role="region" aria-label="Page inventory table">
      <table className="sl-table">
        <thead><tr><th scope="col">Page</th><th scope="col">Section</th><th scope="col">HTTP</th><th scope="col">Health</th><th scope="col">Response</th><th scope="col">Findings</th></tr></thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.id}>
              <th scope="row"><button type="button" className="sl-page-link" onClick={() => onPage(page)}><strong>{page.title}</strong><small>{page.path}</small></button></th>
              <td>{page.section}</td>
              <td><span className={page.status < 400 ? "sl-http" : "sl-http sl-http-error"}>{page.status}</span></td>
              <td><span className={`sl-score ${page.score >= 90 ? "sl-score-good" : page.score >= 75 ? "sl-score-fair" : "sl-score-poor"}`}>{page.score}</span></td>
              <td className="sl-numeric">{page.responseMs.toLocaleString()} ms</td>
              <td className="sl-numeric">{page.findings.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STAGES = [
  { name: "Discover", description: "Load the saved URL inventory." },
  { name: "Fetch", description: "Replay HTTP responses and timings." },
  { name: "Audit", description: "Load sample findings by rule." },
  { name: "Report", description: "Refresh the latest snapshot." },
];

export function CrawlHistory({
  crawls, selected, filtered, countPages, tick, limit, running, complete, onToggle, onRestart, onSnapshot,
}: {
  crawls: Crawl[];
  selected: string;
  filtered: boolean;
  countPages: (id: string) => number;
  tick: number;
  limit: number;
  running: boolean;
  complete: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onSnapshot: (id: string) => void;
}) {
  const stage = Math.floor(tick * STAGES.length / limit);
  const progress = Math.floor(100 * tick / limit);

  return (
    <>
      <section className="sl-panel sl-replay">
        <div className="sl-panel-heading">
          <div><h2>Crawl replay</h2><p>Follow a saved sample through each audit stage.</p></div>
          <div className="sl-replay-controls">
            {tick > 0 && !complete && <button className="sl-icon-button" type="button" aria-label="Restart replay" title="Restart replay" onClick={onRestart}><LuRotateCcw aria-hidden /></button>}
            <button className="sl-button" type="button" onClick={onToggle}>
              {running ? <><LuPause aria-hidden />Pause</> : <><LuPlay aria-hidden />{complete ? "Replay again" : tick > 0 ? "Resume" : "Start replay"}</>}
            </button>
          </div>
        </div>
        <div className="sl-replay-body">
          <div className="sl-replay-status"><span role="status">{complete ? "Complete" : running ? `${STAGES[stage].name} in progress` : tick > 0 ? "Paused" : "Ready to replay"}</span><strong>{progress}%</strong></div>
          <progress aria-label="Crawl replay progress" value={progress} max={100}>{progress}%</progress>
          <ol className="sl-stages">
            {STAGES.map(({ name, description }, index) => (
              <li key={name} className={index < stage ? "sl-stage-done" : index === stage ? "sl-stage-active" : ""}>
                <span>{index < stage ? <LuCheck aria-hidden /> : `0${index + 1}`}</span>
                <strong>{name}</strong>
                <small>{description}</small>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="sl-panel">
        <div className="sl-panel-heading"><div><h2>Saved snapshots <span className="sl-count">{crawls.length}</span></h2><p>Open a snapshot to inspect its pages.</p></div></div>
        <div className="sl-table-scroll" tabIndex={0} role="region" aria-label="Saved crawl snapshots">
          <table className="sl-table sl-crawls-table">
            <thead><tr><th scope="col">Snapshot</th><th scope="col">{filtered ? "Matching pages" : "Pages"}</th><th scope="col">Duration</th><th scope="col"><span className="sl-sr-only">Open</span></th></tr></thead>
            <tbody>
              {crawls.map((crawl) => (
                <tr key={crawl.id}>
                  <th scope="row">{dateLabel(crawl.date, true)}{crawl.id === selected && <span className="sl-current-crawl">Selected</span>}</th>
                  <td className="sl-numeric">{filtered ? countPages(crawl.id) : crawl.pages}</td>
                  <td className="sl-numeric">{crawl.durationSeconds.toLocaleString()} s</td>
                  <td><button className="sl-text-button" type="button" onClick={() => onSnapshot(crawl.id)} aria-label={`View pages for ${dateLabel(crawl.date, true)}`}>View pages <LuArrowRight aria-hidden /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
