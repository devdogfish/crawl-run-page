# SiteLens — website quality demo

[Live demo](https://crawl-run-page.vercel.app)

Interactive portfolio demo built on the crawler prototype in this repository. The root URL opens SiteLens; the original app remains available at `/rbccm/analytics` and its existing routes.

- One shared filter state drives dashboard metrics, trends, issue groups, page lists, and CSV exports.
- Public page titles and URLs provide recognizable content; all audit findings, scores, response times, and crawl history are **simulated**, not claims about the public sites.
- Inspect a page, trace a finding to its suggested fix, compare sample crawls, or replay the crawl pipeline.
- Runs entirely in the browser. No database, credentials, crawler, or AI service required.

## Run the demo

```bash
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:5173>. Node 24 is required by the current toolchain. `pnpm test` runs tests only in this checkout's `src/`; nested worktrees are excluded. `pnpm build` typechecks and produces `dist/`.

## Two-minute walkthrough

1. Open Overview and choose **Services**. Metrics, health history, categories, and fix priorities update together.
2. Choose **Accessibility** and **Critical** to narrow the findings. Open a fix to see its affected pages, then inspect a page.
3. Export the current selection to CSV. Reset the filters and switch sites to compare a different inventory.
4. Open Crawls, inspect an earlier snapshot, then replay the sample pipeline. Pause and resume the replay.

## Deploy

The Vercel configuration builds the static Vite app and rewrites client routes to `index.html`. Backend code and local worktrees are excluded from deployment.

```bash
vercel --prod
```

The demo is independent of the original prototype's Python backend. Public source inventory and collection notes live in `src/demo/sources.json`; the deterministic data model and aggregation tests live beside it.

---

# Original crawler prototype

A Chakra UI v3 prototype of the crawler UI (crawls, run page, pages, issues, settings, Cmd+K search, Ask AI): a React + Vite single-page app with React Router, ready to drop into the app. All data is simulated in the browser. The AI (Cmd+K's fallback, Ask AI's agent and the MCP server) runs in a small Python backend in `backend/`, built to be copied into the real FastAPI app.

Docs, in the order to read them:

| Doc | What it is |
|---|---|
| [CONTEXT.md](CONTEXT.md) | The words we use (crawl, page, issue, element…) |
| [PLAN.md](PLAN.md) | **The plan**: every ticket in order, and when each tier is done |
| [SPEC.md](SPEC.md) | The crawl run page: decisions, UI, log format, storage, endpoints |
| [docs/pages-and-issues.md](docs/pages-and-issues.md) | The read side behind Pages, page detail and Issues: core, storage, element ids |
| [docs/ai.md](docs/ai.md) | The AI: Cmd+K search, Ask AI, the MCP server. Design, running it, moving it into the real app |
| [docs/adr/](docs/adr/) | Decisions and why |
| [docs/research-enterprise-pipeline-ui.md](docs/research-enterprise-pipeline-ui.md), [research/](research/) | Background research |

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173/rbccm/analytics for the original prototype (`pnpm dev`; `pnpm build` writes a static `dist/`). The root URL opens the portfolio demo. Switch sites with the logo menu in the top-left. Crawl 812 is a live simulation; older crawls open finished; **New crawl** starts a new simulated crawl with your settings.

**The AI** needs two more processes (Python via `uv`, and the Codex CLI signed in, which stands in for the corporate gateway):

```bash
pnpm dev:api      # backend on :8000 (Vite proxies /api to it)
pnpm dev:codex    # OpenAI-compatible stand-in gateway on :8787
```

Without them the app still works: Cmd+K shows instant matches only and Ask AI uses scripted answers. Press Cmd+K (Ctrl+K) anywhere to search. See [docs/ai.md](docs/ai.md) §3. Tests: `pnpm test`, `pnpm test:api`.

The grey **Prototype** bar at the top only exists in this prototype:
- **Healthy run / Rate limited / Fails after crawl** switch the scenario;
- **Restart** runs it again;
- **Skip stage** jumps to the end of the current step.

A simulated run takes about a minute; the full-site Lighthouse job takes about 11 seconds.

## What's where

| Path | What it is | Keep when integrating? |
|---|---|---|
| `src/main.tsx`, `src/app.tsx` | Entry point and every route (`/:site/crawls`, `/:site/crawls/:crawlId`, `/:site/pages`, `/:site/pages/:pageId`, `/:site/issues`, `/:site/issues/:ruleId`, `/:site/settings`) | Merge the routes into your router |
| `src/routes/crawls.tsx` | Crawl history: title, facts, toolbar, table, pagination | Yes (swap the data source) |
| `src/routes/crawl-run.tsx` | The run page: header, facts row, step list, step pane, Pages table, Lighthouse scores | Yes (swap the data source) |
| `src/components/log-viewer.tsx` | Virtualized log viewer: follow mode, search, line selection, copy, download | Yes |
| `src/components/data-toolbar.tsx` | Toolbar shared by Logs, Pages and the crawls list | Yes |
| `src/components/app-navbar.tsx` | Navbar: site switcher (logo) on the left, New crawl on the right | Yes |
| `src/components/site-context.tsx` | Current site, remembered per browser | Yes |
| `src/lib/sites.ts` | **Sites config** (RBC CM, RBC Investor Services): names, logos, environment URLs. Staging/dev URLs are placeholders | Replace with `GET /api/sites` |
| `public/sites/*.svg` | Official logos (colour + white for dark mode) | Yes |
| `src/routes/site-layout.tsx` | Reads the site from the first URL segment (not found if unknown), renders the navbar and the `<Outlet />` | Yes |
| `src/routes/pages.tsx`, `page-detail.tsx` | Pages across the site (compared with a baseline crawl) and one page's issues, preview and source | Yes (swap the data source) |
| `src/components/assistant.tsx`, `src/components/assistant/`, `src/lib/ai.ts` | Ask AI: panel shell and chat UI (markdown, tool rows, composer, chips, ` ```ui ` cards); the chat client (docs/ai.md §7). Needs `react-markdown`, `remark-gfm`, `remend`, `use-stick-to-bottom` | Yes |
| `src/components/command-palette.tsx`, `src/lib/nav/` | Cmd+K search: instant matches, the AI result, URL validation (docs/ai.md §6) | Yes (page and rule lookups via the API) |
| `url-map.json` | Every route, URL parameter and allowed value; read by the frontend and the backend | Yes |
| `backend/` | The AI backend: gateway, MCP server, Ask AI agent, navigation (docs/ai.md §4) | Yes, `crawler_ai/` (write `RealCore`); not `dev/` |
| `src/lib/refs.ts` | Issue ids → issue data and links; the prompts the buttons write; the offline system prompt | Yes (resolve ids via the API) |
| `src/lib/mock-ai.ts`, `src/lib/proto-api.ts` | **Scripted answers** when the backend is off; the prototype's data served to the backend | No |
| `src/routes/issues.tsx`, `rule-detail.tsx` | Issues by rule, and one rule's affected pages | Yes (swap the data source) |
| `src/lib/custom-rules.ts`, `src/components/rule-*.tsx` | Custom rules, saved in the browser for now | Yes (store rules via the API) |
| `src/components/crawl-settings-dialog.tsx` | New crawl / paused settings / read-only settings dialog | Yes |
| `src/lib/settings.ts` | Settings model: environments, locked vs editable fields | Yes (align with the API) |
| `src/components/crawl-charts.tsx` | Crawl throughput/queue chart, response-code bar, duration sparkline | Yes |
| `src/components/step-ui.tsx` | Step status labels and icons, per-step throughput chart | Yes |
| `src/components/ui/*` | Chakra CLI snippets (provider, tooltip, color mode, toaster) | Use your app's own |
| `src/lib/types.ts` | Shared types and formatters | Yes (align with the API models) |
| `src/lib/crawl.ts` | **Simulator** for the crawl and steps (incl. pause/resume and the log format) | No, replaced by the API |
| `src/lib/crawls-list.ts` | **Fake data** for the crawls list | No, replaced by `GET /api/crawls` |
| `src/lib/pages.ts` | **Simulator** for per-page rows (redirect chains etc.) | No (keep the `PageRow` type) |

## Notes
- Built with Vite, React 19, React Router, `@chakra-ui/react` 3.38, `@chakra-ui/charts` 3.38 (Recharts 3) and `react-virtuoso`.
- Recharts 3 needs the `responsive` prop on every chart inside Chakra's `Chart.Root`, or nothing renders.
- All times in the simulator are relative to 02:00 UTC on 2026-11-04.
