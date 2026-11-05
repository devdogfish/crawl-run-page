# Crawl run page

A Chakra UI v3 prototype of the crawler UI (crawls, run page, pages, issues, settings): a React + Vite single-page app with React Router, frontend only, ready to drop into the app. All data is simulated in the browser; nothing here talks to a server.

- **[SPEC.md](SPEC.md):** every question asked during design and the decision taken; the UI spec; how to instrument the existing crawler (where to add logs and metrics); SQLite storage; FastAPI endpoints (polling, SSE log streaming, pagination).
- **[SLICES.md](SLICES.md):** the integration broken into 5 slices, with acceptance criteria.
- **[docs/research-enterprise-pipeline-ui.md](docs/research-enterprise-pipeline-ui.md):** the research on how GitHub Actions, Vercel, Dagster, Buildkite and others show pipeline runs.

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 (`pnpm dev`; `pnpm build` writes a static `dist/`). It redirects to `/rbccm/crawls` (or the site you used last). Switch sites with the logo menu in the top-left. Crawl 812 is a live simulation; older crawls open finished; **New crawl** starts a new simulated crawl with your settings.

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
