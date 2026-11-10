import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  LuArrowDownToLine, LuArrowRight, LuArrowUpRight, LuChartNoAxesCombined,
  LuCheck, LuChevronDown, LuCircleHelp, LuFileText, LuGithub, LuHistory,
  LuLayoutGrid, LuPlay, LuScanLine, LuSearch, LuTriangleAlert, LuX,
} from "react-icons/lu";
import {
  CATEGORIES, DEFAULT_FILTERS, SECTIONS, SITES, exportCsv, filterPages,
  getCrawls, getPages, getTrend, groupIssues, scorePage, summarize,
} from "./model";
import type { Category, DemoPage, Filters, Severity, SiteId } from "./model";
import {
  CrawlHistory, EmptyState, IssueList, PageTable, SEVERITY_LABELS, SeverityBadge, Summary, dateLabel,
} from "./panels";
import "./demo.css";

const SOURCE_URL = "https://github.com/devdogfish/crawl-run-page/tree/codex/portfolio-demo";

const NAV = [
  { id: "overview", label: "Overview", icon: LuLayoutGrid, description: "Track site health and see what needs attention." },
  { id: "pages", label: "Pages", icon: LuFileText, description: "Inspect page health, response times, and individual findings." },
  { id: "issues", label: "Issues", icon: LuTriangleAlert, description: "Prioritize fixes across pages with the same issue." },
  { id: "crawls", label: "Crawls", icon: LuHistory, description: "Compare saved snapshots and replay the crawl workflow." },
] as const;

type Tab = (typeof NAV)[number]["id"];
type Modal = { type: "page"; pageId: string } | { type: "about" } | null;
type Issue = ReturnType<typeof groupIssues>[number];

function FilterSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="sl-select">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <LuChevronDown aria-hidden />
    </label>
  );
}

function DetailsDialog({ children, onClose, drawer }: { children: ReactNode; onClose: () => void; drawer: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  function dismiss() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className={drawer ? "sl-dialog sl-drawer" : "sl-dialog"}
      aria-labelledby="sl-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dismiss();
      }}
    >
      <div className="sl-dialog-content">
        <button className="sl-icon-button sl-close" type="button" aria-label="Close dialog" onClick={dismiss}><LuX /></button>
        {children}
      </div>
    </dialog>
  );
}

function PageDetails({ page }: { page: DemoPage }) {
  return (
    <>
      <div className="sl-kicker">Page inspection</div>
      <h2 id="sl-dialog-title">{page.title}</h2>
      <a className="sl-inline-link sl-wrap-url" href={page.url} target="_blank" rel="noreferrer">{page.url}<LuArrowUpRight aria-hidden /></a>
      <dl className="sl-inspection-data">
        <div><dt>Health score</dt><dd>{page.score}<span> / 100</span></dd></div>
        <div><dt>HTTP status</dt><dd>{page.status}</dd></div>
        <div><dt>Response</dt><dd>{page.responseMs.toLocaleString()}<span> ms</span></dd></div>
      </dl>
      <h3>Findings <span className="sl-count">{page.findings.length}</span></h3>
      {page.findings.length ? (
        <div className="sl-findings">
          {page.findings.map((finding) => (
            <article key={finding.id} className="sl-finding">
              <div className="sl-finding-meta">
                <SeverityBadge severity={finding.severity} />
                <span>{CATEGORIES.find(({ id }) => id === finding.category)?.label}</span>
              </div>
              <h4>{finding.title}</h4>
              <p className="sl-evidence">{finding.evidence}</p>
              <p>{finding.recommendation}</p>
            </article>
          ))}
        </div>
      ) : <p className="sl-clear-finding"><LuCheck aria-hidden /> No findings match this view.</p>}
    </>
  );
}

export default function DemoApp() {
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<Modal>(null);
  const [replay, setReplay] = useState({ tick: 0, running: false });
  const [notice, setNotice] = useState("");
  const site = SITES.find(({ id }) => id === params.get("site")) ?? SITES[0];
  const siteId = site.id;
  const currentTab = NAV.find(({ id }) => id === params.get("view")) ?? NAV[0];
  const tab = currentTab.id;
  const filters: Filters = {
    search: params.get("q") ?? "",
    section: SECTIONS.find((section) => section === params.get("section")) ?? "all",
    category: CATEGORIES.find(({ id }) => id === params.get("category"))?.id ?? "all",
    severity: (Object.keys(SEVERITY_LABELS) as Severity[]).find((severity) => severity === params.get("severity")) ?? "all",
  };
  const range = params.get("range") === "7" ? 7 : 30;
  const ruleId = tab === "pages" ? params.get("rule") : null;
  const crawlList = getCrawls(siteId);
  const currentCrawl = crawlList.find(({ id }) => id === params.get("snapshot")) ?? crawlList[0];
  const isHistorical = currentCrawl.id !== crawlList[0].id;
  const allPages = getPages(siteId, currentCrawl.id);
  const pages = filterPages(allPages, filters);
  const issues = groupIssues(pages);
  const activeIssue = issues.find((issue) => issue.ruleId === ruleId);
  const visiblePages = ruleId ? pages.flatMap((page) => {
    const findings = page.findings.filter((finding) => finding.ruleId === ruleId);
    return findings.length ? [{ ...page, findings, score: scorePage(findings) }] : [];
  }) : pages;
  const selectedPage = modal?.type === "page" ? visiblePages.find(({ id }) => id === modal.pageId) : undefined;
  const hasFilters = Object.keys(DEFAULT_FILTERS).some((key) => filters[key as keyof Filters] !== DEFAULT_FILTERS[key as keyof Filters]);
  const replayLimit = 48;
  const replayComplete = replay.tick >= replayLimit;

  const finishReplay = useEffectEvent(() => {
    updateParams({ snapshot: undefined }, true);
    setNotice("Replay complete. Latest snapshot loaded.");
  });

  useEffect(() => {
    if (!replay.running || tab !== "crawls") return;
    const timeout = window.setTimeout(() => {
      if (replay.tick >= replayLimit - 1) {
        setReplay({ tick: replayLimit, running: false });
        finishReplay();
      } else {
        setReplay({ tick: replay.tick + 1, running: true });
      }
    }, 125);
    return () => window.clearTimeout(timeout);
  }, [replay, tab]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function updateParams(values: Record<string, string | undefined>, replace = false) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace });
  }

  function selectTab(next: Tab, extra?: Record<string, string | undefined>) {
    if (next !== "crawls") setReplay((previous) => ({ ...previous, running: false }));
    updateParams({ view: next === "overview" ? undefined : next, rule: next === "pages" ? ruleId ?? undefined : undefined, ...extra });
    window.scrollTo(0, 0);
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    updateParams({ [key === "search" ? "q" : key]: value === DEFAULT_FILTERS[key] ? undefined : value }, key === "search");
  }

  function resetFilters() {
    updateParams({ q: undefined, section: undefined, category: undefined, severity: undefined, rule: undefined });
  }

  function viewIssue(issue: Issue) {
    selectTab("pages", { rule: issue.ruleId });
  }

  function download() {
    const contents = exportCsv(visiblePages);
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sitelens-${siteId}-${currentCrawl.date.slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("CSV exported.");
  }

  function beginReplay() {
    selectTab("crawls");
    setReplay({ tick: 0, running: true });
  }

  return (
    <div className="sl-app">
      <a className="sl-skip" href="#sl-main">Skip to content</a>
      <aside className="sl-sidebar" aria-label="SiteLens workspace">
        <div className="sl-brand">
          <span className="sl-brand-mark"><LuScanLine aria-hidden /></span>
          <span>SiteLens<span className="sl-brand-period">.</span></span>
        </div>
        <div className="sl-workspace">
          <div className="sl-side-caption">Workspace</div>
          <label className="sl-site-select">
            <span className="sl-site-icon"><LuChartNoAxesCombined aria-hidden /></span>
            <span className="sl-site-display"><strong>{site.name}</strong><small>{site.host}</small></span>
            <LuChevronDown className="sl-site-chevron" aria-hidden />
            <select aria-label="Switch site" value={siteId} onChange={(event) => {
              const nextSite = event.target.value as SiteId;
              updateParams({ site: nextSite === SITES[0].id ? undefined : nextSite, snapshot: undefined, rule: undefined });
              setReplay({ tick: 0, running: false });
              setNotice("");
            }}>
              {SITES.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>
        <nav className="sl-nav" aria-label="Workspace views">
          <div className="sl-side-caption">Audit</div>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => selectTab(id)}>
              <Icon aria-hidden /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sl-sidebar-footer">
          <button type="button" onClick={() => setModal({ type: "about" })}><LuCircleHelp aria-hidden /> About this demo</button>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer"><LuGithub aria-hidden /> Source code <LuArrowUpRight className="sl-footer-arrow" aria-hidden /></a>
        </div>
      </aside>

      <main className="sl-main" id="sl-main">
        <div className="sl-topbar">
          <div className="sl-breadcrumb"><span>Workspace</span><span aria-hidden>/</span><strong>{currentTab.label}</strong></div>
          <button className="sl-sample-badge" type="button" onClick={() => setModal({ type: "about" })}><i aria-hidden />Sample data</button>
        </div>
        <header className="sl-header">
          <div>
            <div className="sl-kicker"><span aria-hidden />Website audit</div>
            <h1>{tab === "overview" ? "Site overview" : currentTab.label}</h1>
            <p>{currentTab.description}</p>
          </div>
          <div className="sl-header-actions">
            <button className="sl-button" type="button" onClick={download} disabled={!visiblePages.length}><LuArrowDownToLine aria-hidden />Export CSV</button>
            <button className="sl-button sl-primary" type="button" onClick={beginReplay} disabled={tab === "crawls" && replay.running}><LuPlay aria-hidden />Replay crawl</button>
          </div>
        </header>
        <div className="sl-toolbar">
          <div className="sl-filters" role="group" aria-label="Filter audit results">
            <div className="sl-search">
              <LuSearch aria-hidden />
              <input aria-label="Search pages" value={filters.search} placeholder="Search pages…" onChange={(event) => updateFilter("search", event.target.value)} />
              {filters.search && <button type="button" aria-label="Clear search" onClick={() => updateFilter("search", "")}><LuX /></button>}
            </div>
            <FilterSelect label="Filter by section" value={filters.section} options={[{ value: "all", label: "All sections" }, ...SECTIONS.map((section) => ({ value: section, label: section }))]} onChange={(value) => updateFilter("section", value)} />
            <FilterSelect label="Filter by category" value={filters.category} options={[{ value: "all", label: "All categories" }, ...CATEGORIES.map(({ id, label }) => ({ value: id, label }))]} onChange={(value) => updateFilter("category", value)} />
            <FilterSelect label="Filter by severity" value={filters.severity} options={[{ value: "all", label: "All severities" }, ...Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value: value as Severity, label }))]} onChange={(value) => updateFilter("severity", value)} />
            {hasFilters && <button type="button" className="sl-text-button sl-reset" onClick={resetFilters}>Reset filters</button>}
          </div>
          {tab === "overview" && (
            <div className="sl-range" role="group" aria-label="Health trend range">
              <button type="button" aria-pressed={range === 7} onClick={() => updateParams({ range: "7" })}>7 days</button>
              <button type="button" aria-pressed={range === 30} onClick={() => updateParams({ range: undefined })}>30 days</button>
            </div>
          )}
        </div>

        <div className="sl-content">
          {tab !== "crawls" && (
            <div className="sl-snapshot">
              <span><LuHistory aria-hidden /> {isHistorical ? "Historical snapshot" : "Latest snapshot"} <strong>{dateLabel(currentCrawl.date, true)}</strong></span>
              {isHistorical && <button className="sl-text-button" type="button" onClick={() => updateParams({ snapshot: undefined })}>Return to latest</button>}
            </div>
          )}

          {tab === "overview" && (
            <>
              <Summary
                metrics={summarize(pages)}
                trend={getTrend(siteId, filters, range, currentCrawl.id)}
                onCategory={(category: Category) => selectTab("issues", { category })}
              />
              <section className="sl-panel">
                <div className="sl-panel-heading">
                  <div><h2>Priority fixes</h2><p>Findings grouped by rule and ranked by impact.</p></div>
                  <button className="sl-text-button" type="button" onClick={() => selectTab("issues")}>View all issues <LuArrowRight aria-hidden /></button>
                </div>
                <IssueList issues={issues.slice(0, 4)} onIssue={viewIssue} />
              </section>
            </>
          )}

          {tab === "pages" && (
            <section className="sl-panel">
              <div className="sl-panel-heading">
                <div><h2>Page inventory <span className="sl-count">{visiblePages.length}</span></h2><p>Open a page to inspect its findings.</p></div>
                {ruleId && (
                  <button className="sl-rule-filter" type="button" aria-label="Remove issue filter" onClick={() => updateParams({ rule: undefined })}>
                    {activeIssue?.title ?? "Selected issue"} <LuX aria-hidden />
                  </button>
                )}
              </div>
              {visiblePages.length ? <PageTable pages={visiblePages} onPage={(page) => setModal({ type: "page", pageId: page.id })} /> : <EmptyState title="No matching pages" description="Clear the filters or try a different search." action={resetFilters} />}
            </section>
          )}

          {tab === "issues" && (
            <section className="sl-panel">
              <div className="sl-panel-heading"><div><h2>Issue inventory <span className="sl-count">{issues.length}</span></h2><p>Open an issue to see affected pages.</p></div></div>
              <IssueList issues={issues} onIssue={viewIssue} />
              {!issues.length && hasFilters && <div className="sl-empty-action"><button className="sl-button" type="button" onClick={resetFilters}>Reset filters</button></div>}
            </section>
          )}

          {tab === "crawls" && (
            <CrawlHistory
              crawls={crawlList}
              selected={currentCrawl.id}
              filtered={hasFilters}
              countPages={(id) => filterPages(getPages(siteId, id), filters).length}
              tick={replay.tick}
              limit={replayLimit}
              running={replay.running}
              complete={replayComplete}
              onToggle={() => setReplay({ tick: replayComplete ? 0 : replay.tick, running: !replay.running })}
              onRestart={() => setReplay({ tick: 0, running: true })}
              onSnapshot={(id) => selectTab("pages", { snapshot: id === crawlList[0].id ? undefined : id })}
            />
          )}
        </div>

        <footer className="sl-main-footer"><span>SiteLens audit workspace</span><span>Portfolio demo</span></footer>
      </main>

      <div className="sl-live" role="status">{notice && <span><LuCheck aria-hidden />{notice}</span>}</div>

      {modal?.type === "about" && (
        <DetailsDialog onClose={() => setModal(null)} drawer={false}>
          <div className="sl-kicker">Portfolio project</div>
          <h2 id="sl-dialog-title">About SiteLens</h2>
          <p>SiteLens is an interactive website audit demo. It uses public URLs with simulated crawl results, scores, and findings.</p>
          <p>Page health starts at 100 and drops 24 points per critical finding, 10 per warning, and 4 per notice, to a minimum of zero. The dashboard averages matching pages and recalculates scores from findings that match the category and severity filters.</p>
          <p>Crawl replay shows how the workflow progresses using a saved sample. SiteLens is an independent portfolio project with no affiliation to the sites shown.</p>
          <a className="sl-button sl-primary" href={SOURCE_URL} target="_blank" rel="noreferrer"><LuGithub aria-hidden />View source <LuArrowUpRight aria-hidden /></a>
        </DetailsDialog>
      )}
      {selectedPage && (
        <DetailsDialog onClose={() => setModal(null)} drawer>
          <PageDetails page={selectedPage} />
        </DetailsDialog>
      )}
    </div>
  );
}
