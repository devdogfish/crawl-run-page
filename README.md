# Crawler Analytics Platform

[Live demo](https://rbc-analytics.demo.girke.dev) · Original UI, captured public pages, sample crawl history.

A Chakra UI v3 crawler dashboard built with React, Vite and React Router. Overview, Pages, Issues and Crawls read the same checked-in JSON records, with shareable filters and drilldowns. The static Vercel deployment needs no database. Ask AI uses scripted answers; the optional Python backend lives in `backend/`.

## Demo data

- `src/data/public-pages.json`: 72 real public page URLs and titles from RBC Capital Markets and RBC Investor Services.
- `html-snapshots.json`, `html-stylesheets.json`: captured public HTML and deduplicated CSS, with source URLs, capture timestamps, HTTP status and response time. Preview and source use the captured document. Images and fonts load from the original public hosts. Scripts, embedded frames and active form behavior are stripped; the preview is sandboxed.
- `captured-findings.json`: conservative static HTML checks tied to actual selectors/snippets. Performance findings are explicitly sample data, not measured Lighthouse audits.
- `crawl-history.json`: simulated crawl membership, content changes, error states and lab measurements. Counts, trends, comparisons, response totals and Lighthouse coverage use these records.
- `traffic.json`: simulated 30-day page views used by the legacy urgency view.
- `sample-pages.json`, `legacy-audit-findings.json`: QA profiles reuse public captures; four compatibility records retain old demo links and explicitly show unavailable HTML.

The JSON dataset is approximately **7.4 MB**. `pnpm check:data` enforces a **20,000,000-byte cap** across JSON under `src/` and `public/`, and runs before every build. Refresh public captures with `node scripts/capture-pages.mjs`; the script limits captures to an 18 MB budget, leaving room for history and fixtures.

An issue means one failing rule on one page. Element counts represent individual failures. Shared/page-specific element charts partition those elements; a rule can occur in both. Crawl history and performance metrics are illustrative, not claims about the public sites' historical behavior.

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
nvm use
pnpm install
pnpm dev
```

Open http://localhost:5173 (`pnpm dev`; `pnpm build` writes a static `dist/`). It opens the original Overview at `/rbccm/analytics` (or the site you used last). Switch sites with the logo menu in the top-left. Crawl 812 is a sample active run; older crawls open their recorded state. **New crawl** starts a local simulation with your settings.

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

Replay controls simulate processing the saved page inventory; they do not crawl the live sites.

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
| `src/lib/crawls-list.ts` | Stored demo crawl metadata and page coverage | No, replaced by `GET /api/crawls` |
| `src/lib/pages.ts` | Crawl rows derived from the shared page inventory | No (keep the `PageRow` type) |

## Notes
- Built with Vite, React 19, React Router, `@chakra-ui/react` 3.38, `@chakra-ui/charts` 3.38 (Recharts 3) and `react-virtuoso`.
- Recharts 3 needs the `responsive` prop on every chart inside Chakra's `Chart.Root`, or nothing renders.
- Crawl dates, durations, outcomes and page coverage come from the same JSON history on every route.


## Vercel hosting

Production: https://rbc-analytics.demo.girke.dev. The Vercel project `crawler-analytics-platform` belongs to the personal **DevDogFish's projects** workspace (`devdogfishs-projects`). DNS is managed at Spaceship; Vercel manages HTTPS.

The GitHub repository is [devdogfish/crawler-analytics-platform](https://github.com/devdogfish/crawler-analytics-platform). Vercel's Git integration tracks **`resume-demo` as the production branch**: every push runs tests, the 20 MB JSON guard, TypeScript, and Vite, then updates the custom domain after a successful build. Keep demo work on `resume-demo`; it does not need to merge into `main`.

`VITE_AI=scripted` is configured for Production and Preview. For a manual production deployment, verify `vercel whoami` shows `devdogfish`, then run `vercel --prod --yes --scope devdogfishs-projects` from `resume-demo`.
