# Replace steppers with synchronized, reason-bearing pipeline lenses

No serious CI/CD tool, data orchestrator or data SaaS product shows a system-run pipeline as a numbered stepper. They all give you **several linked views of the same run**: a stage chain or graph for structure, a waterfall/Gantt for time, a runs × stages grid for history, and a compact status strip for list rows. Each stage carries a **distinct glyph plus label plus reason string**, and logs open in a side or bottom panel so the graph never disappears. The design systems agree on why steppers feel "vibecoded" here. IBM Carbon and Atlassian scope their progress indicators to user-driven linear forms of 3–6 steps, and Carbon says not to use them when the step count varies with conditional logic ([Carbon](https://carbondesignsystem.com/components/progress-indicator/usage/), [Atlassian](https://atlassian.design/components/progress-tracker/usage)). For a sequential ETL whose stages unblock in order, the strongest references are:

- **Buildkite's segmented waterfall** (waiting → dispatch → run).
- **Dagster's dotted "hypothetical" boxes** for stages that have not started.
- **Airflow's `upstream_failed` state**: amber, with an upstream-pointing icon.
- **The Airflow and Databricks runs × tasks matrices.**
- **GitLab's mini pipeline graph** in list rows.
- **Fivetran's Extract/Process/Load segmented sync bars.**

All of these can be rebuilt with permissively licensed React parts. Apache Airflow 3's own UI is a current, Apache-2.0 reference: React 19, @xyflow/react, elkjs, @visx and @tanstack/react-virtual. The concrete recommendation at the end is a 12-state taxonomy, a four-lens layout and a library stack.

## Mature tools layer four lenses, each answering one question

Across the products studied, each run is shown through several synchronized lenses, and each lens answers one question: structure, time, detail or trend.

- **Databricks Jobs** gives every job run Graph, Timeline and List toggles ([Databricks](https://docs.databricks.com/aws/en/jobs/monitor)).
- **Buildkite** offers Canvas (dependency graph), Table, Waterfall and List views ([Buildkite build page](https://buildkite.com/docs/pipelines/build-page)).
- **AWS Step Functions** pairs a Graph or Table view (with an optional Timeline column) with a Step details panel and an Events table. Selection stays **synced between Graph and Table** ([AWS](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)).
- **Temporal** ships four history lenses: Compact, Timeline, Full History and JSON ([Temporal blog](https://temporal.io/blog/the-dark-magic-of-workflow-exploration)).
- **dbt's platform** splits a run into Run summary, Model timing, Lineage, Explain, Artifacts and Compare ([dbt](https://docs.getdbt.com/docs/deploy/run-visibility)).

The lens most relevant to the user's complaint is **Temporal's Compact view**. It shows event groups left to right "in what order", ignores clock time, and collapses repeated groups into one line with a count ([Temporal](https://temporal.io/blog/the-dark-magic-of-workflow-exploration)). It is the professional version of a horizontal stepper. Each node is a chip carrying state colour, a dashed and animated line while pending, and a repeat count. It has no ordinal numbers, because order is already implied by position.

For a strictly linear pipeline, a full DAG canvas adds little. GitLab learned this the hard way. After `needs` shipped, the pipeline graph drew lines between every job of adjacent stages and so implied relationships that did not exist. GitLab called them **"placebo lines"**, removed them, and found pipelines with **8,000+ potential job connections**, each one a DOM node ([GitLab blog](https://about.gitlab.com/blog/placebo-lines-on-the-pipeline-graph/)). GitLab later deprecated its separate DAG tab after user research showed the job-dependencies column view solved the problem better ([gitlab #336560](https://gitlab.com/gitlab-org/gitlab/-/issues/336560)). The lesson for an ETL UI is to **draw edges only when they encode a real dependency**. For a sequential chain, a horizontal stage row plus a waterfall conveys "blocked chronologically" more honestly than a graph engine.

These are the screens worth studying first; each linked doc page contains annotated screenshots:

| Pattern | Product reference | What to steal |
|---|---|---|
| Segmented waterfall | [Buildkite Waterfall](https://buildkite.com/docs/pipelines/waterfall) | Grey wait / yellow dispatch / green-or-red run segments, hover popover with exact durations |
| Retry-aware timeline | [AWS Step Functions execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html) ([timeline screenshot](https://docs.aws.amazon.com/step-functions/latest/dg/images/sm-table-view-timeline-color-codes.png)) | Red failed-attempt segments with grey backoff gaps; error banner with "View step details" |
| Runs × tasks matrix | [Databricks monitor jobs](https://docs.databricks.com/aws/en/jobs/monitor), [Airflow Grid](https://airflow.apache.org/docs/apache-airflow/stable/ui.html) | Duration bar chart above a state matrix; repaired runs appear as a new column |
| Mini status strip | [GitLab mini pipeline graph](https://docs.gitlab.com/ci/pipelines/) | One glyph per stage in list rows; click to expand the stage's jobs |
| Phase-segmented history | [Fivetran Connection Status](https://fivetran.com/docs/getting-started/fivetran-dashboard/connectors/status) | Each sync bar split into Extract/Process/Load with status, duration and volume on hover |
| Analytical Gantt | [dbt Model timing](https://docs.getdbt.com/docs/deploy/run-visibility) | Critical-path tiles, "highlight by duration, grey the rest" |
| Ordered chip strip | [Temporal Workflow UI](https://temporal.io/blog/the-dark-magic-of-workflow-exploration) | Compact ordered view, dashed animated pending lines |
| Status sidebar | [Dagster GanttStatusPanel](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/src/gantt/GanttStatusPanel.tsx) | Executing/Errored expanded, Succeeded/Not-executed collapsed |

## Twelve states, with three distinct kinds of "not running"

Mature orchestrators keep fine-grained state sets.

- **Airflow 3** defines **14 task-instance states**, including `upstream_failed`, `up_for_retry`, `deferred` and the human-in-the-loop `awaiting_input` ([Airflow tasks](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html)).
- **GitLab** exposes **13 job statuses**. It deliberately splits `pending` (queued for a runner) from `waiting_for_resource` (blocked on a lock) and `waiting_for_callback` (blocked on an external system) ([GitLab jobs](https://docs.gitlab.com/ci/jobs/)).
- **Prefect** separates state *types*, which drive logic, from state *names*, which are "visual bookkeeping" such as Late, AwaitingRetry, AwaitingConcurrencySlot and InfrastructurePending. It also distinguishes **Failed (code) from Crashed (infrastructure)** ([Prefect states](https://www.prefect.io/docs/v3/concepts/states)).
- **Dagster** keeps an **UNKNOWN** step state for runs that "exited without step reaching a final state", which is an honest answer when a runner dies ([Dagster source](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/src/runs/RunMetadataProvider.tsx)).

The most common amateur mistake is to merge every non-running state into one grey "pending". The data SaaS products keep them apart. **Airbyte** distinguishes three things. Stream **Queued** means later in this run. **Queued for next sync** means a later run. **Pending** means the whole job is queued. Connection-level Queued means "waiting for data worker capacity" and uses a **yellow hourglass** ([Airbyte status](https://docs.airbyte.com/platform/cloud/managing-airbyte-cloud/review-connection-status)). **Supabase's** sequential branch-provisioning pipeline (`clone < pull < health < configure < migrate < seed < deploy`) states the blocking rule outright. A **PAUSED** step finished with a warning or was skipped on purpose, and later steps still run. A **DEAD** step failed, and dependent steps don't run ([Supabase blog](https://supabase.com/blog/how-a-new-branch-gets-its-config-migrations-and-functions)). That one rule, that **a warning does not block and a failure does**, is the backbone of a chronologically blocked ETL.

The "partial" outcome is first-class everywhere data is involved:

- Jenkins has a yellow **Unstable** state ([Jenkins](https://www.jenkins.io/doc/book/blueocean/pipeline-run-details/)).
- Databricks has **Succeeded with failures**, derived from leaf tasks ([Databricks](https://docs.databricks.com/aws/en/jobs/monitor)).
- Hightouch has **Completed with errors**, meaning the destination rejected some rows ([Hightouch](https://hightouch.com/docs/syncs/overview)).
- Airbyte has **Incomplete**, meaning some or no data loaded and the error is expected to self-resolve ([Airbyte timeline](https://docs.airbyte.com/cloud/managing-airbyte-cloud/review-connection-timeline)).

Hightouch and Airbyte also separate **run status** (this execution) from **health** (the connection over time: Healthy, Warning, Pending, Disabled). Lists show health and detail pages show the run ([Hightouch](https://hightouch.com/docs/syncs/overview)).

### Encoding rules come from the design systems

**IBM Carbon** publishes the most complete status-indicator rules:

- **Never rely on colour alone.** Keep at least **3:1 contrast**, outline light yellows and oranges, and don't reuse one shape in several colours.
- When you roll several states up into one, **show the highest-attention colour**.
- Use about **5–6 indicator types per screen** at most.
- The colour semantics are: red for error, orange for serious warning, yellow for warning, green for success, **blue for workflow progress**, **grey for unstarted jobs**, and purple for undefined.

([Carbon status pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/))

**Airflow 3** implements this cleanly in code. Every state has its own Chakra semantic token (OKLCH, 600 shade, with solid, subtle, muted and emphasized variants) *and* its own icon. Running is cyan with FiActivity. `upstream_failed` is **amber** with **LuCircleFadingArrowUp**, an icon that literally points upstream. `up_for_retry` is yellow with LuRedo2. `none` uses **LuCircleDashed** ([theme.ts](https://github.com/apache/airflow/blob/main/airflow-core/src/airflow/ui/src/theme.ts), [StateIcon.tsx](https://github.com/apache/airflow/blob/main/airflow-core/src/airflow/ui/src/components/StateIcon.tsx)).

**Vercel Geist's StatusDot** adds two more rules:

- **Animate only non-terminal states** (QUEUED, BUILDING), without a separate spinner.
- **Update only on real state changes**, not on every polling tick.

([Geist](https://vercel.com/geist/status-dot))

**Temporal** encodes retrying as **dashed red**, and pending as **dashed purple that animates forward** ([Temporal](https://temporal.io/blog/the-dark-magic-of-workflow-exploration)). The industry signal is consistent: dotted or dashed means "not final yet", and solid fill means terminal.

## Blocking is explained with reasons, placeholders and blast-radius previews

Showing a dimmed node is not enough. Good products say *why* a stage is waiting and *what* will happen next. They do this at four layers.

**At the state layer**, the reason travels with the state. Argo pairs "phase: Pending" with a message such as "PodInitializing" ([KodeKloud notes](https://notes.kodekloud.com/docs/Prep-Course-Certified-Argo-Project-Associate-CAPA/Argo-Workflow/Demo-simple-Workflow-using-CLI-or-UI/page)). Census exposes a **current-step string** from a fixed sequence ("Unloading data from warehouse" → "Loading data into destination service" → …) ([Census API](https://developers.getcensus.com/api-reference/sync-runs/fetch-sync-run)). Airbyte shows a rate-limit message with a **countdown** when one is known ([Airbyte](https://docs.airbyte.com/platform/cloud/managing-airbyte-cloud/review-connection-status)). CircleCI renamed "On Hold" to the action-oriented **"Needs Approval"** ([CircleCI changelog](https://circleci.com/changelog/on-hold-now-shows-as-needs-approval-in-circleci-ui)).

**At the geometry layer**, Dagster's Gantt draws stages that have not started as **"hypothetical" boxes with a 1.5px dotted grey border**, and edges into waiting steps are dotted rather than solid ([GanttChartLayout.ts](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/src/gantt/GanttChartLayout.ts)). GitLab's dependency view **highlights every upstream job on hover**, which explains a blocked job in one gesture ([GitLab pipelines](https://docs.gitlab.com/ci/pipelines/)). Buildkite and CircleCI treat gates (block, input and approval steps) as **first-class nodes**, not hidden properties ([Buildkite](https://buildkite.com/docs/pipelines/build-page)).

**At the page layer**, AWS Step Functions puts an **error banner** on a failed execution with a Cause and a "View step details" link. That link highlights the failing step in Graph, Table and Step details at once. A **Recover** dropdown offers Redrive ([AWS](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)).

**At the recovery layer**, the Databricks **Repair job run** dialog lists the failed tasks *and the dependent tasks that will re-run* before you commit. After a repair, a new matrix column turns red cells green ([Databricks repair](https://docs.databricks.com/aws/en/jobs/repair-job-failures)). Azure Data Factory offers **Rerun from failed activity** and **Rerun from activity**, and labels rows as Original, Rerun or Rerun (Latest) ([ADF](https://learn.microsoft.com/en-us/azure/data-factory/monitor-visually)). ADF is also a cautionary example: it does not auto-refresh, so users must click Refresh, and Microsoft now steers new users to Fabric ([ADF](https://learn.microsoft.com/en-us/azure/data-factory/monitor-visually)).

## Time belongs on a segmented waterfall, not in a duration column

**Buildkite's waterfall** is the clearest professional pattern for answering "why did this take three hours?". Each job is a bar split into **grey (waiting for an agent) → yellow (dispatch) → green or red (run)**. A hover popover gives each segment to the second, and parallel children nest under a parent bar that turns red if any child failed. The waterfall is limited to builds of **3,000 jobs / 1,800 steps** ([Buildkite waterfall](https://buildkite.com/docs/pipelines/waterfall)). A 2024 release made waterfall bars link straight to job logs ([Buildkite release](https://buildkite.com/releases/2024-q1/investigate-jobs-from-the-waterfall-view)).

The gap Buildkite fills is real. GitHub Actions shows queue time only while a job is queued, and community users are still asking for it once the job has started ([GitHub discussion](https://github.com/orgs/community/discussions/200704)).

Retries are where timelines become enterprise-grade:

- **AWS Step Functions'** Timeline column draws **failed attempts as red segments with light-grey BackoffRate gaps** between them, and its Retry tab lists each attempt with its reason or output ([AWS](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)).
- **Dagster** models every attempt as its own box segment. Its Gantt has FLAT, WATERFALL and WATERFALL_TIMED modes, a **logarithmic zoom**, a requestAnimationFrame **"now" clock** that grows running bars live, a "hide waiting" toggle, and labels that hide below 30px ([Dagster Constants.ts](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/src/gantt/Constants.ts), [GanttChart.tsx](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/src/gantt/GanttChart.tsx)).
- **dbt's Model timing** tab is the most analytical. It has metric tiles (estimated critical path, peak concurrency, longest model, wall clock), a "Highlight: critical path / by duration" mode that greys out the rest, and a concurrency-over-time chart ([dbt](https://docs.getdbt.com/docs/deploy/run-visibility)).

For compact summaries, data products put metrics directly on phase segments. **Fivetran** splits each sync bar into **Extract, Process and Load**, each with status, duration and data volume on hover ([Fivetran](https://fivetran.com/docs/getting-started/fivetran-dashboard/connectors/status)). **Hightouch** expands a run's operations into rows added, changed and removed, and splits successful (green) from rejected (red) operations ([Hightouch](https://hightouch.com/docs/syncs/overview)). **BigQuery** labels execution-graph edges with **estimated rows exchanged** between stages, which makes drops between stages visible ([BigQuery](https://docs.cloud.google.com/bigquery/query-plan-explanation)). One trap to note: Airbyte sums metrics across attempts, so records extracted can exceed records loaded ([Airbyte timeline](https://docs.airbyte.com/cloud/managing-airbyte-cloud/review-connection-timeline)). Label summed counts explicitly.

History matrices complete the time story. **Airflow's Grid** has tasks as rows and runs as columns. Clicking a cell opens logs or lets you mark success, mark failed or clear. Airflow 3 keeps the grid as a **persistent sidebar** on run pages, so cross-run context stays visible ([Airflow UI](https://airflow.apache.org/docs/apache-airflow/stable/ui.html)). **Databricks** draws a run-duration bar row whose **height encodes duration**. It warns when a run exceeds its expected completion time, and its cell tooltips give start, duration, cluster and status ([Databricks](https://docs.databricks.com/aws/en/jobs/monitor)). These grids work because they encode state (colour), duration (height) and recency (x-position) at once. Recurring failures then show up as horizontal streaks, and regressions as vertical columns. For lists of runs, the **GitLab mini pipeline graph** shows one status icon per stage wherever a pipeline is referenced, with hover for the stage name and status and click for the jobs ([GitLab](https://docs.gitlab.com/ci/pipelines/)). GitLab sorts mini-graph jobs by severity ([GitLab jobs](https://docs.gitlab.com/ci/jobs/)). A linear ETL should keep pipeline order instead.

## Drill-down keeps the pipeline visible beside a tabbed panel

The products converge on this sequence: select a node, bar or cell, then open a docked panel with **Logs first**, while the stage view stays on screen.

- **Buildkite** has a collapsible step sidebar and a resizable step panel (Log, Artifacts, Environment) that **docks right, bottom or center**. Keyboard shortcuts include `f` (next failure), `j` (follow active steps) and `s` (step search). A retry selector switches between attempts ([Buildkite](https://buildkite.com/docs/pipelines/build-page)).
- **Dagster** places the Gantt top-left and a filterable bottom pane that toggles **Structured event logs** against **Raw compute logs** ([Dagster UI](https://dagster.io/docs/guides/operate/webserver)).
- **Dagster's** status sidebar groups steps as Preparing, Executing, Errored and Succeeded, with **Succeeded and Not executed collapsed by default**. The default view therefore shows what is in flight and what broke ([GanttStatusPanel.tsx](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/src/gantt/GanttStatusPanel.tsx)).

Inside the log, the cross-vendor convention is **collapsible groups**:

- GitHub uses `::group::` / `::endgroup::`, **auto-expands failed steps**, and makes every line deep-linkable. Job summaries are rendered from `$GITHUB_STEP_SUMMARY` Markdown ([GitHub logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs), [workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)).
- Jenkins Pipeline Graph View accepts both `##[group]` and `::group::` and collapses sections longer than 25 lines ([Jenkins PGV](https://plugins.jenkins.io/pipeline-graph-view/)).
- Vercel highlights error lines in red and warnings in yellow. Clicking a timestamp creates a `#L6` anchor, and Shift-click selects a range `#L6-L9`. Logs are truncated at 4MB with secrets auto-redacted ([Vercel logs](https://vercel.com/docs/deployments/logs)).
- dbt tails only the last 1,000 lines or 0.5MB while a run is in progress, which keeps the browser responsive ([dbt](https://docs.getdbt.com/docs/deploy/run-visibility)).
- Airbyte offers logs **per attempt**, and classifies errors as **red configuration errors** (the user must act) versus **yellow system errors** (transient) ([Airbyte](https://docs.airbyte.com/platform/cloud/managing-airbyte-cloud/review-connection-status)).

Row-level problems belong in their own tab, separate from stage failure. Hightouch has a Rejected tab with the destination's error per row ([Hightouch](https://hightouch.com/docs/syncs/overview)). Vercel also mirrors status in the **browser tab icon** (queued, building, error, ready), which is cheap to copy ([Vercel blog](https://vercel.com/blog/dashboard-redesign)).

## Airflow 3's dependency list is the de facto open-source stack

The closest maintained, permissively licensed React reference is the **Apache Airflow 3 UI** (Apache-2.0). Its package.json declares:

- React 19 and Chakra UI v3.
- **@xyflow/react 12** with **elkjs** for graph layout.
- **@visx/group and @visx/shape** for hand-rolled bars.
- Chart.js.
- **@tanstack/react-virtual** for the virtualized grid.

([package.json](https://github.com/apache/airflow/blob/main/airflow-core/src/airflow/ui/package.json))

Dagster's UI, also Apache-2.0, is built on React 18, Blueprint.js v5, a patched dagre and @tanstack/react-virtual ([ui-core package.json](https://github.com/dagster-io/dagster/blob/master/js_modules/ui-core/package.json)). Its Gantt source is the best reference for a live waterfall. Prefect's main UI is Vue and Temporal's is SvelteKit, so both are visual references only ([Prefect UI library](https://github.com/PrefectHQ/prefect-ui-library), [temporalio/ui](https://github.com/temporalio/ui)).

The component landscape as of November 2026:

| Need | Pick | Status and licence | Notes |
|---|---|---|---|
| Stage graph (if fan-out ever appears) | [@xyflow/react](https://github.com/xyflow/xyflow) 12.12 | MIT, 38.9k stars, active | Custom React nodes become full stage cards |
| Graph layout | [@dagrejs/dagre](https://github.com/dagrejs/dagre) 3.1 | MIT, maintained again | [elkjs](https://github.com/kieler/elkjs) is stronger but **EPL-2.0/GPL**, so check with legal |
| Waterfall / Gantt | Hand-rolled with [@visx/shape](https://github.com/airbnb/visx) | MIT, 21.1k stars | What Airflow does; full control over segments, retries and the "now" line |
| Off-the-shelf timeline | [vis-timeline](https://github.com/visjs/vis-timeline) 8.5 | Apache-2.0 or MIT, active | Not React-native, needs a wrapper. [SVAR React Gantt](https://github.com/svar-widgets/react-gantt) is native but young (215 stars). Avoid stale [gantt-task-react](https://www.npmjs.com/package/gantt-task-react) (last release 2022) |
| Run-history strip | [Tremor Tracker](https://www.tremor.so/docs/visualizations/tracker) | Apache-2.0, copy-paste; repo idle since Oct 2025 | Treat as owned code (Tailwind + Radix hover-card) |
| Log viewer | [@melloware/react-logviewer](https://github.com/melloware/react-logviewer) 6.6 | MPL-2.0, active | ANSI, virtualization, websocket and stream support. Original react-lazylog is **archived** |
| Virtualized grid | @tanstack/react-virtual | MIT | Used by both Airflow and Dagster |
| Design-system base | [@carbon/react](https://carbondesignsystem.com/patterns/status-indicator-pattern/), Blueprint, Fluent, Primer | Apache-2.0 / MIT, all published Nov 2026 | Polaris React is **archived**. EUI uses Elastic's custom licence |

These numbers are a 4 November 2026 snapshot ([npm](https://www.npmjs.com/), [GitHub](https://github.com/)). For a shadcn/Tailwind codebase, the third-party **Buildbrook** block is a useful Vercel-style reference. It has a phase-share bar, collapsible phases with duration and share of total, a sparkline of the last 12 builds, a "warnings and errors only" switch, auto-expansion of the failed phase, and skipped phases noted as "did not run because an earlier phase failed" ([shadcn.io Buildbrook](https://www.shadcn.io/blocks/radix/monitoring-vercel-deployment-log)).

## Recommended design for the ETL status UI

### State taxonomy

Keep orchestration types few and display names rich, as Prefect does. Give every state a unique glyph and label, so it never depends on colour alone (Carbon). Animate only `running` and `retrying`, and swap to a static glyph under `prefers-reduced-motion`. That last point is my own addition; none of the sources address reduced motion.

| State | Meaning | Colour token | Glyph / shape | Blocks downstream? | Precedent |
|---|---|---|---|---|---|
| Not started | Future stage, upstream still running | neutral | Dotted outline box, dashed circle | n/a | Dagster hypothetical box, Airflow `none` |
| Waiting on upstream | Next in line; reason "Waiting on Transform" | neutral, emphasized | Dashed circle + lock or upstream arrow | n/a | GitLab hover-upstream, Census current step |
| Queued | Ready, waiting for capacity or a slot; show queue position or ETA | stone/amber-subtle | Hourglass | n/a | Airbyte hourglass, GitLab `pending` |
| Waiting for resource / external | Lock, upstream file or rate limit; show countdown | amber | Clock | n/a | GitLab `waiting_for_resource`, Airbyte countdown |
| Needs approval | Manual or data-quality gate | violet | Pause + action button | Yes, until approved | CircleCI "Needs Approval", Buildkite block step |
| Running | Live elapsed timer, live row counts | blue | Animated activity ring | n/a | Geist, Carbon blue for progress |
| Retrying | "Attempt 2 of 3", backoff countdown | blue with dashed outline | Redo arrow + attempt badge | n/a | Airflow `up_for_retry`, Temporal dashed |
| Succeeded | Terminal | green | Check | No | Universal |
| Succeeded with warnings | Partial load, rejected rows under threshold | yellow, outlined | Check + warning dot | **No** | Supabase PAUSED, Hightouch "Completed with errors", Jenkins Unstable |
| Failed | Code or data error; classify user-action vs transient | red | X | **Yes** | Airbyte red/yellow split, Prefect Failed/Crashed |
| Upstream failed | Never ran because an earlier stage failed | amber | Circle with upstream arrow | Yes (cascades) | Airflow `upstream_failed` |
| Cancelled / Skipped / Unknown | User stop; intentional skip with reason; runner died | grey | Slash / skip-forward / question | Cancelled and Unknown block | GitLab, Buildkite skip reason, Dagster UNKNOWN |

### Layout composition

**1. Runs list.** Each row carries pipeline health (Healthy / Warning / Failing, following Hightouch) and the latest run's **mini stage strip**: one glyph per stage, in pipeline order, with hover for name and duration and click to open the run. Add a "Live" badge on the run whose output is currently published downstream, borrowed from Render's Live deploy badge ([Render](https://render.com/blog/deploys-page)). Add a duration sparkline of the last N runs.

**2. Run header.** Status, run ID, trigger (schedule, manual or upstream event), data window or partition, start time, total elapsed, and **current or blocking stage**. Include actions: Cancel, **Retry from failed stage** (with a Databricks-style preview of the stages that will re-run), and Copy link. On failure, show an AWS-style banner naming the failed stage, its one-line cause and a "Jump to stage" link.

**3. Hero: horizontal stage chain.** Rich cards connected by edges. Edges are **solid once the upstream stage completes and dotted while blocked**. Each card shows the glyph, stage name, state label and reason line ("Waiting on Transform", "Attempt 2 of 3, retry in 40s"), plus elapsed or final duration. It also shows **records in → out (rejected)**, so drops between stages are visible as in BigQuery. Gates render as small nodes of their own. Plain flex components are enough for a strictly linear chain. Use @xyflow/react + dagre only if fan-out is on the roadmap.

**4. Timeline toggle (Buildkite-style).** A waterfall with one lane per stage. Each bar is split into **queued / waiting (grey) → starting (yellow) → running (state colour)**, retries show as separate segments with grey backoff gaps, and future stages are dotted placeholders. Add a live "now" line and a "highlight slowest stage" toggle borrowed from dbt.

**5. History toggle (Airflow/Databricks-style).** A stages × last-25-runs matrix with a duration bar row on top, where every cell opens that run's stage panel.

**6. Detail panel.** Docked right or bottom, so the chain stays visible. Tabs: **Logs** (default; groups per sub-step with per-group timing; auto-expand and scroll to the first error; errors-only filter; line anchors; per-attempt selector), **Summary** (metrics, row counts, data-quality results), **Rejected rows**, and **Details** (config, worker, input and output).

**7. Ambient cues.** A favicon or tab-title status, and a "next failure" keyboard shortcut. Re-render only on state transitions.

### Library stack

Use React with your design-system base (Carbon or Blueprint for an IBM- or Palantir-like density, or shadcn/Radix + Tailwind with Airflow-style semantic tokens in OKLCH for a Vercel-like finish). Build the chain with plain components, or with @xyflow/react + @dagrejs/dagre. Hand-roll the waterfall with @visx/shape. Copy and own Tremor Tracker for strips. Use @tanstack/react-virtual for the history grid, and @melloware/react-logviewer for streaming logs. Read the Airflow 3 `ui/` and Dagster `ui-core/src/gantt/` sources before writing your own.

## Conclusion

The fix for the "vibecoded" feel is not a nicer stepper. It is to **separate the questions a stepper conflates**: order (the chain), time (the waterfall), history (the matrix) and cause (reason strings, upstream-failed state, logs). A numbered circle carries one bit, "done or not". Every reference product spends its pixels on the bits a stepper hides: why a stage is waiting, how long it queued versus ran, which attempt this is, how many rows survived, and what a retry will re-run. The honest-geometry rule is the same lesson underneath. GitLab's placebo lines and Dagster's dotted hypothetical boxes both show that professional UIs draw only what is true and render the future as provisional.

Some evidence is thin. Exact icon specs for GitHub, GitLab Pajamas (auth-gated during research), Fivetran and Hightouch are undocumented. No source covers reduced-motion handling, auto-scroll or completion toasts. Airflow 3's integrated Gantt was still settling as of the 3.1.x releases ([3.1.1 notes](https://www.gitclear.com/open_repos/apache/airflow/release/3.1.1)). The safest course is to copy the patterns that are documented in source code, from Airflow's tokens and icons and Dagster's Gantt, rather than inferring styling from screenshots.
