"use client";

// Crawl run page · /[site]/crawls/[crawlId]
// Built like CI/orchestration run pages (GitHub Actions, Vercel, Dagster):
//   page header (breadcrumbs, status, actions) → facts row → two panes:
//   step list on the left, the selected step on the right with Logs | Metrics | Pages | Scores tabs.
// Per-page results live in the Pages table, not in the log. Lighthouse runs on a sample by default;
// a full-site audit is a separate follow-up job that reuses this crawl.
//
// PROTOTYPE: data comes from the simulator in src/lib/crawl.ts and src/lib/pages.ts.
// SLICES.md describes how to replace it with the FastAPI endpoints in SPEC.md.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Alert, Badge, Box, Breadcrumb, Button, ButtonGroup, Container, DataList, EmptyState, Flex, Grid, HStack, Heading, IconButton,
  Menu, Pagination, Portal, Progress, ProgressCircle, Span, Stack, Tabs, Text,
} from "@chakra-ui/react";
import {
  LuArrowRight, LuChevronLeft, LuChevronRight, LuCopy, LuDownload, LuEllipsis, LuGauge, LuPause, LuPlay, LuRotateCcw, LuSettings2, LuSkipForward, LuTimer,
} from "react-icons/lu";

import { STAGE_COLORS, STATUS, StageAreaChart, StageIcon } from "@/components/step-ui";
import { CodesBar, CrawlChart, HistoryChart } from "@/components/crawl-charts";
import { LogViewer } from "@/components/log-viewer";
import { DataToolbar, downloadText } from "@/components/data-toolbar";
import NextLink from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { CrawlSettingsDialog } from "@/components/crawl-settings-dialog";
import { CRAWLS, type CrawlRow } from "@/lib/crawls-list";
import { ENVIRONMENTS, defaultSettings, hostOf, type CrawlSettings } from "@/lib/settings";
import { SITES, type SiteId } from "@/lib/sites";
import { useSite } from "@/components/site-context";
import { ESTIMATED_PAGES, FULL_LH_SEC, PREVIOUS_CRAWLS, useCrawlRun, type CrawlScenario, type FullJob } from "@/lib/crawl";
import { PAGE_FILTERS, matches, pageAt, redirectSide, type PageFilter, type PageRow } from "@/lib/pages";
import { fmtClock, fmtDur, fmtNum, stageDuration, type LogLine, type Stage, type StageStatus } from "@/lib/types";

const SCENARIOS: { v: CrawlScenario; label: string }[] = [
  { v: "healthy", label: "Healthy run" },
  { v: "ratelimited", label: "Rate limited" },
  { v: "failure", label: "Fails after crawl" },
];

// Prototype: settings come from the "New crawl" dialog (?settings=…) or from the crawl's row in the list
function useInitialSettings(row: CrawlRow | undefined, site: SiteId): CrawlSettings {
  const raw = useSearchParams().get("settings");
  try { if (raw) return { ...defaultSettings(site), ...JSON.parse(raw) }; } catch { /* fall through */ }
  return row ? { ...defaultSettings(row.site), environment: row.environment, url: row.url } : defaultSettings(site);
}

export default function CrawlRunPage() {
  const crawlId = useCrawlId();
  const row = CRAWLS.find((c) => c.id === crawlId);
  // A crawl belongs to one site: if the URL names another site, send it to the right one
  const site = useSite();
  const settings = useInitialSettings(row, site);
  const router = useRouter();
  useEffect(() => { if (row && row.site !== site) router.replace(`/${row.site}/crawls/${row.id}`); }, [row, site, router]);
  const finished = !!row && row.status !== "running" && row.status !== "paused";
  const [scenario, setScenario] = useState<CrawlScenario>(row?.status === "failed" ? "failure" : "healthy");
  const [replay, setReplay] = useState(false); // prototype bar restarts a finished crawl live
  const [runKey, setRunKey] = useState(0);
  const restart = (s: CrawlScenario) => { setScenario(s); setRunKey((k) => k + 1); setReplay(true); };
  return (
    <Box bg="bg" minH="100vh">
      <Run key={`${scenario}-${runKey}`} scenario={scenario} settings={settings} finished={finished && !replay} onScenario={restart} />
    </Box>
  );
}

const useCrawlId = () => useParams<{ crawlId: string }>().crawlId;

type RunView = ReturnType<typeof useCrawlRun>;
type StepInfo = {
  id: string;
  name: string;
  sub: string;
  status: StageStatus;
  dur: number | null;
  expected: number;
  progress: number;
  startedAt: number | null;
  logs: LogLine[];
  kind: "crawl" | "tail" | "job";
  stage?: Stage;
};

function useSteps(run: RunView): StepInfo[] {
  const { state } = run;
  const c = state.crawl;
  const crawl: StepInfo = {
    id: "crawl", name: "Crawl", kind: "crawl",
    status: c.status === "running" ? (state.paused ? "paused" : "running") : "success",
    sub: c.status === "running" ? `${fmtNum(c.done)} of ~${fmtNum(ESTIMATED_PAGES)} pages` : `${fmtNum(c.done)} pages`,
    dur: (c.endedAt ?? state.t) - c.startedAt, expected: 1260, progress: run.crawlPct, startedAt: 0, logs: c.logs,
  };
  const tail: StepInfo[] = state.tail.map((s, i) => ({
    id: s.id, name: s.name, kind: "tail", stage: s, status: s.status === "running" && state.paused ? "paused" : s.status,
    sub: s.status === "waiting" ? `Waiting on ${i === 0 ? "Crawl" : state.tail[i - 1].name}`
      : s.status === "blocked" ? "Not run · an earlier step failed"
      : s.status === "failed" ? "Failed" : s.description,
    dur: stageDuration(s, state.t), expected: s.expectedSec, progress: s.progress, startedAt: s.startedAt, logs: s.logs,
  }));
  return [crawl, ...tail];
}

function jobStep(j: FullJob): StepInfo {
  return {
    id: j.id, name: "Lighthouse · full site", kind: "job", stage: j, status: j.status,
    sub: `${fmtNum(j.pagesDone)} of ${fmtNum(j.pagesTotal)} pages`,
    dur: j.elapsed, expected: j.expectedSec, progress: j.progress, startedAt: j.startedAt, logs: j.logs,
  };
}

function Run({ scenario, settings, finished, onScenario }: { scenario: CrawlScenario; settings: CrawlSettings; finished: boolean; onScenario: (s: CrawlScenario) => void }) {
  const run = useCrawlRun(scenario, settings, finished);
  const steps = useSteps(run);
  const job = run.state.fullLh ? jobStep(run.state.fullLh) : null;
  const all = job ? [...steps, job] : steps;

  // Follow the active step until the user picks one
  const active = steps.find((s) => s.status === "running" || s.status === "paused") ?? steps.find((s) => s.status === "failed") ?? (job?.status === "running" ? job : undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = all.find((s) => s.id === (picked ?? active?.id)) ?? job ?? steps[steps.length - 1];

  return (
    <>
      <PrototypeBar scenario={scenario} onScenario={onScenario} onSkip={run.skipStage} canSkip={run.canSkip} />
      <RunHeader run={run} onFullLighthouse={() => { run.runFullLighthouse(); setPicked("lighthouse-full"); }} />
      <Container maxW="7xl" py="6">
        <Grid templateColumns={{ base: "1fr", lg: "280px minmax(0, 1fr)" }} gap="6" alignItems="start">
          <Sidebar
            run={run} steps={steps} job={job} selected={selected.id} onSelect={setPicked}
            onFullLighthouse={() => { run.runFullLighthouse(); setPicked("lighthouse-full"); }}
          />
          <StepPane key={selected.id} run={run} step={selected} onFullLighthouse={() => { run.runFullLighthouse(); setPicked("lighthouse-full"); }} />
        </Grid>
      </Container>
    </>
  );
}

// ───────────────────────── Header ─────────────────────────

function RunHeader({ run, onFullLighthouse }: { run: RunView; onFullLighthouse: () => void }) {
  const crawlId = useCrawlId();
  const { state } = run;
  const c = state.crawl;
  const paused = run.runStatus === "paused";
  const running = run.runStatus === "crawling" || run.runStatus === "processing";
  const active = running || paused;
  const palette = run.runStatus === "failed" ? "red" : run.runStatus === "success" ? "green" : paused ? "yellow" : "blue";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fetched = Object.values(c.codes).reduce((a, n) => a + n, 0);
  const errPct = fetched ? (run.errors / fetched) * 100 : 0;
  const label = { crawling: "Crawling", processing: "Processing", paused: "Paused", failed: "Failed", success: "Succeeded" }[run.runStatus];
  const lhDone = state.tail.find((s) => s.id === "lighthouse")?.status === "success";

  const downloadAll = () => {
    const lines = [c.logs, ...state.tail.map((s) => s.logs)].flat();
    const text = lines.map((l) => `${fmtClock(l.t)}  ${l.msg}`).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: `crawl-${crawlId}.log` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box borderBottomWidth="1px" bg="bg.subtle">
      <Container maxW="7xl" pt="5" pb="5">
        <Breadcrumb.Root size="sm" mb="3">
          <Breadcrumb.List>
            <Breadcrumb.Item><Breadcrumb.Link asChild><NextLink href={`/${state.settings.site}/crawls`}>Crawls</NextLink></Breadcrumb.Link></Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item><Breadcrumb.CurrentLink>{crawlId}</Breadcrumb.CurrentLink></Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb.Root>

        <Flex gap="4" align="center" wrap="wrap">
          <HStack gap="3">
            <Heading size="xl" fontWeight="semibold">Crawl {crawlId}</Heading>
            <Badge colorPalette={palette} variant="subtle" size="md">
              {running ? <Box boxSize="1.5" rounded="full" bg="blue.solid" animation="pulse 1.5s infinite" /> : null}
              {label}
            </Badge>
          </HStack>
          <HStack gap="2" ms="auto">
            {run.failed && <Button size="sm" onClick={run.retry}><LuRotateCcw />Retry from {run.failed.name}</Button>}
            {paused && <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><LuSettings2 />Settings</Button>}
            {running && <Button size="sm" variant="outline" onClick={run.pause}><LuPause />Pause</Button>}
            {paused && <Button size="sm" onClick={run.resume}><LuPlay />Resume</Button>}
            <Button size="sm" variant="outline" onClick={downloadAll}><LuDownload />Logs</Button>
            <Menu.Root positioning={{ placement: "bottom-end" }}>
              <Menu.Trigger asChild>
                <IconButton aria-label="More actions" size="sm" variant="outline"><LuEllipsis /></IconButton>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="64">
                    <Menu.Item value="lh" disabled={!lhDone || !!state.fullLh} onClick={onFullLighthouse}>
                      <LuGauge />Run Lighthouse on full site
                    </Menu.Item>
                    <Menu.Item value="settings" onClick={() => setSettingsOpen(true)}>
                      <LuSettings2 />{paused ? "Edit settings" : "View settings"}
                    </Menu.Item>
                    <Menu.Item value="copy" onClick={() => navigator.clipboard.writeText(location.href)}>
                      <LuCopy />Copy link to run
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          </HStack>
        </Flex>

        <CrawlSettingsDialog
          open={settingsOpen} onOpenChange={setSettingsOpen} mode={paused ? "paused" : "view"} initial={state.settings}
          onSubmit={(next, { resume }) => { run.updateSettings(next); if (resume) run.resume(); }}
        />

        <DataList.Root orientation="vertical" size="sm" mt="5" display="grid" gridTemplateColumns={{ base: "repeat(2, 1fr)", md: "repeat(6, minmax(0, 1fr))" }} gap="5">
          {active ? (
            <Fact label="Progress">
              <HStack gap="2" w="full">
                <Progress.Root value={run.overallPct} size="xs" flex="1" maxW="24" colorPalette={paused ? "yellow" : "blue"}>
                  <Progress.Track><Progress.Range transition="width 0.25s linear" /></Progress.Track>
                </Progress.Root>
                <Span fontVariantNumeric="tabular-nums">{run.overallPct}%</Span>
              </HStack>
            </Fact>
          ) : (
            <Fact label="Trigger">Schedule · daily 02:00</Fact>
          )}
          <Fact label="Started">Nov 4, 02:00 UTC</Fact>
          <Fact label={active ? "Elapsed" : "Duration"}>
            {fmtDur(state.t)}
            {paused && <Span color="fg.muted"> · paused</Span>}
            {running && run.runEta != null && <Span color="fg.muted"> · done ~{fmtClock(state.t + run.runEta).slice(0, 5)}</Span>}
          </Fact>
          <Fact label="Pages">
            {fmtNum(c.done)}
            {c.status === "running" && (
              <Tooltip content={`Estimate: median of the last ${PREVIOUS_CRAWLS.length} crawls (${ESTIMATED_PAGES.toLocaleString("en-US")})`} showArrow>
                <Span color="fg.muted" textDecoration="underline dotted" textUnderlineOffset="3px" cursor="help"> / ~{fmtNum(ESTIMATED_PAGES)}</Span>
              </Tooltip>
            )}
          </Fact>
          <Fact label="Errors">
            <Span color={errPct > 5 ? "red.fg" : undefined}>{errPct.toFixed(1)}%</Span>
            <Span color="fg.muted"> · {fmtNum(run.errors)}</Span>
          </Fact>
          <Fact label="Target">
            <Tooltip content={`${hostOf(state.settings.url)} · ${state.settings.concurrency} workers · delay ${state.settings.delayMs} ms · timeout ${state.settings.timeoutS} s`} showArrow>
              <Span>{SITES[state.settings.site].short} <Span color="fg.muted">· {ENVIRONMENTS[state.settings.environment].label}</Span></Span>
            </Tooltip>
          </Fact>
        </DataList.Root>
      </Container>
    </Box>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DataList.Item>
      <DataList.ItemLabel>{label}</DataList.ItemLabel>
      <DataList.ItemValue display="block" fontWeight="medium" fontVariantNumeric="tabular-nums" minW="0" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">{children}</DataList.ItemValue>
    </DataList.Item>
  );
}

// ───────────────────────── Sidebar ─────────────────────────

function Sidebar({ run, steps, job, selected, onSelect, onFullLighthouse }: {
  run: RunView; steps: StepInfo[]; job: StepInfo | null; selected: string; onSelect: (id: string) => void; onFullLighthouse: () => void;
}) {
  const { state } = run;
  const lhDone = state.tail.find((s) => s.id === "lighthouse")?.status === "success";
  return (
    <Stack gap="6" position={{ lg: "sticky" }} top={{ lg: "calc(var(--sticky-top, 4rem) + 1rem)" }}>
      <Box>
        <Stack gap="0.5">
          {steps.map((s) => <StepButton key={s.id} step={s} selected={s.id === selected} onSelect={onSelect} />)}
          {/* Optional full-site audit: same row as the other steps, started on demand */}
          {job ? (
            <StepButton step={job} selected={job.id === selected} onSelect={onSelect} />
          ) : (
            <HStack gap="2.5" align="flex-start" px="2" py="2">
              <Box pt="0.5"><StageIcon status="pending" size="sm" /></Box>
              <Stack gap="0" flex="1" minW="0">
                <Text textStyle="sm" fontWeight="medium" color={lhDone ? undefined : "fg.muted"}>Lighthouse · full site</Text>
                <Text textStyle="xs" color="fg.muted" truncate>
                  {lhDone ? `Optional · ~${fmtDur(FULL_LH_SEC)}` : run.failed ? "Optional · needs a successful run" : "Optional · after the run finishes"}
                </Text>
              </Stack>
              {lhDone && <Button size="2xs" variant="outline" onClick={onFullLighthouse}>Run</Button>}
            </HStack>
          )}
        </Stack>
      </Box>

      <CrawlTrend run={run} />
    </Stack>
  );
}

// Sparkline: this crawl vs the last 19. One number, one line; hover for each run.
function CrawlTrend({ run }: { run: RunView }) {
  const c = run.state.crawl;
  const live = c.status === "running";
  const current = c.endedAt ?? (run.crawlEta != null ? run.state.t + run.crawlEta : run.state.t);
  return (
    <Box px="2">
      {/* One font, one size; only the value is emphasised */}
      <HStack justify="space-between" textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
        <Text>Crawl duration</Text>
        <Text><Span color="fg">{live ? "~" : ""}{fmtDur(current)}</Span> · median 21m</Text>
      </HStack>
      <HistoryChart compact h="12" current={current} live={live} />
    </Box>
  );
}

function StepButton({ step: s, selected, onSelect }: { step: StepInfo; selected: boolean; onSelect: (id: string) => void }) {
  const locked = s.status === "pending" || s.status === "waiting" || s.status === "blocked";
  return (
    <Box
      as="button"
      onClick={() => !locked && onSelect(s.id)}
      w="full" textAlign="left" px="2" py="2" rounded="l2" position="relative"
      bg={selected ? "bg.muted" : undefined}
      cursor={locked ? "default" : "pointer"}
      _hover={locked || selected ? undefined : { bg: "bg.subtle" }}
      aria-current={selected ? "true" : undefined}
    >
      <HStack gap="2.5" align="flex-start">
        <Box pt="0.5"><StageIcon status={s.status} size="sm" /></Box>
        <Stack gap="0" flex="1" minW="0">
          <Text textStyle="sm" fontWeight={selected ? "semibold" : "medium"} color={locked ? "fg.muted" : undefined}>{s.name}</Text>
          <Text textStyle="xs" color={s.status === "failed" ? "red.fg" : "fg.muted"} truncate>{s.sub}</Text>
        </Stack>
        <Text textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums" pt="0.5">{s.dur != null ? fmtDur(s.dur) : `~${fmtDur(s.expected)}`}</Text>
      </HStack>
      {(s.status === "running" || s.status === "paused") && (
        <Progress.Root value={s.progress} size="xs" mt="2" ms="6.5" colorPalette="blue">
          <Progress.Track h="1"><Progress.Range transition="width 0.25s linear" /></Progress.Track>
        </Progress.Root>
      )}
    </Box>
  );
}

// ───────────────────────── Step pane ─────────────────────────

function StepPane({ run, step, onFullLighthouse }: { run: RunView; step: StepInfo; onFullLighthouse: () => void }) {
  const crawlId = useCrawlId();
  const c = run.state.crawl;
  const isLh = step.id === "lighthouse" || step.kind === "job";
  const tabs = [
    { v: "logs", label: "Logs", count: step.logs.length },
    { v: "metrics", label: "Metrics" },
    ...(step.kind === "crawl" ? [{ v: "pages", label: "Pages", count: c.done }] : []),
    ...(isLh ? [{ v: "scores", label: "Scores" }] : []),
  ];
  const [tab, setTab] = useState("logs");

  return (
    <Box borderWidth="1px" rounded="l3" minW="0">
      {/* Step header */}
      <Flex px="5" pt="4" pb="3" gap="4" align="flex-start" wrap="wrap">
        <Stack gap="1" flex="1 1 320px" minW="0">
          <HStack gap="2.5">
            <StageIcon status={step.status} />
            <Heading size="md" fontWeight="semibold">{step.name}</Heading>
            {step.status !== "running" && step.status !== "paused" && step.status !== "success" && (
              <Badge size="sm" variant="subtle" colorPalette={STATUS[step.status].palette}>{STATUS[step.status].label}</Badge>
            )}
          </HStack>
          <Text textStyle="sm" color="fg.muted">{step.stage?.description ?? "Fetch and render every URL on the site"}</Text>
        </Stack>
        <HStack gap="5" textStyle="sm" color="fg.muted">
          {step.startedAt != null && <HStack gap="1.5"><Text>Started</Text><Text color="fg" fontVariantNumeric="tabular-nums">{fmtClock(step.startedAt)}</Text></HStack>}
          <HStack gap="1.5"><LuTimer /><Text color="fg" fontVariantNumeric="tabular-nums">{step.dur != null ? fmtDur(step.dur) : "—"}</Text><Text>/ usual ~{fmtDur(step.expected)}</Text></HStack>
        </HStack>
      </Flex>

      {step.status === "running" && (
        <Progress.Root value={step.progress} size="xs" colorPalette="blue" striped animated>
          <Progress.Track rounded="0" h="0.5"><Progress.Range transition="width 0.25s linear" /></Progress.Track>
        </Progress.Root>
      )}

      {step.status === "failed" && (
        <Alert.Root status="error" rounded="0" borderTopWidth="1px">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{step.stage?.error}</Alert.Title>
            <Alert.Description>Later steps did not run. The crawl output is kept, so a retry starts here without crawling again.</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {step.kind === "crawl" && c.backoffUntil && (
        <Alert.Root status="warning" rounded="0" borderTopWidth="1px">
          <Alert.Indicator />
          <Alert.Title>Rate limited by shop.example.com. Concurrency dropped from 64 to 16 until the 429s stop.</Alert.Title>
        </Alert.Root>
      )}

      <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value)} variant="line" size="sm">
        <Tabs.List px="5" borderTopWidth="1px">
          {tabs.map((t) => (
            <Tabs.Trigger key={t.v} value={t.v}>
              {t.label}
              {"count" in t && t.count != null && <Badge size="xs" variant="subtle" fontVariantNumeric="tabular-nums">{fmtNum(t.count)}</Badge>}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Box p="5">
          <Tabs.Content value="logs" p="0">
            <LogViewer lines={step.logs} running={step.status === "running"} fileName={`crawl-${crawlId}-${step.id}.log`} />
          </Tabs.Content>
          <Tabs.Content value="metrics" p="0">
            {step.kind === "crawl" ? <CrawlMetrics run={run} /> : <StepMetrics step={step} />}
          </Tabs.Content>
          {step.kind === "crawl" && (
            <Tabs.Content value="pages" p="0">
              <PagesTable done={c.done} />
            </Tabs.Content>
          )}
          {isLh && (
            <Tabs.Content value="scores" p="0">
              <Scores run={run} step={step} onFullLighthouse={onFullLighthouse} />
            </Tabs.Content>
          )}
        </Box>
      </Tabs.Root>
    </Box>
  );
}

function CrawlMetrics({ run }: { run: RunView }) {
  const c = run.state.crawl;
  const queue = c.samples.at(-1)?.queue ?? 0;
  return (
    <Stack gap="6">
      <DataList.Root orientation="vertical" size="sm" display="grid" gridTemplateColumns="repeat(4, minmax(0, 1fr))" gap="4">
        <Fact label="Rate">{c.status === "running" ? `${Math.round(run.rate)} pages/s` : `${(c.done / Math.max(1, (c.endedAt ?? 1))).toFixed(0)} pages/s avg`}</Fact>
        <Fact label="URLs discovered">{fmtNum(c.discovered)}</Fact>
        <Fact label="Queue">{fmtNum(queue)}</Fact>
        <Fact label="Median render">2.1s</Fact>
      </DataList.Root>
      <Box>
        <Text textStyle="sm" fontWeight="medium" mb="2">Throughput and queue</Text>
        <CrawlChart samples={c.samples} usualRate={run.usualRate} />
      </Box>
      <Box>
        <Text textStyle="sm" fontWeight="medium" mb="3">Responses</Text>
        <CodesBar codes={c.codes} />
      </Box>
    </Stack>
  );
}

function StepMetrics({ step }: { step: StepInfo }) {
  if (!step.stage || step.stage.samples.length < 2) {
    return (
      <EmptyState.Root size="sm">
        <EmptyState.Content>
          <EmptyState.Title>No metrics yet</EmptyState.Title>
          <EmptyState.Description>Metrics appear once the step starts reporting progress.</EmptyState.Description>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }
  const job = step.kind === "job";
  return (
    <Stack gap="6">
      <DataList.Root orientation="vertical" size="sm" display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="4">
        <Fact label="Progress">{Math.floor(step.progress)}%</Fact>
        <Fact label={job ? "Pages audited" : "Items"}>{job ? `${fmtNum((step.stage as FullJob).pagesDone)} / ${fmtNum((step.stage as FullJob).pagesTotal)}` : fmtNum(step.stage.samples.at(-1)?.rows ?? 0)}</Fact>
        <Fact label="Usual duration">~{fmtDur(step.expected)}</Fact>
      </DataList.Root>
      <Box>
        <Text textStyle="sm" fontWeight="medium" mb="2">{job ? "Pages per minute" : "Rows per second"}</Text>
        <StageAreaChart stage={step.stage} color={STAGE_COLORS[2]} dataKey="rowsPerSec" height="48" />
      </Box>
    </Stack>
  );
}

// ───────────────────────── Pages table ─────────────────────────

const COLS = "44px minmax(160px, 2.6fr) 56px 128px 60px 52px minmax(0, 1.6fr)";
const PAGE_SIZE = 50;
const SIDE_COLOR = { server: "blue", client: "purple", mixed: "orange" } as const;

function PagesTable({ done }: { done: number }) {
  const crawlId = useCrawlId();
  const [filter, setFilter] = useState<PageFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // Real backend: GET /api/crawls/{crawl_id}/pages?filter=…&q=…&cursor=…&limit=50 returns one page; counts come from a separate query.
  // Here the rows are generated in the browser and sliced to the same page size.
  const bucket = Math.floor(done / 500) * 500; // recompute every 500 pages, not every tick
  const all = useMemo(() => Array.from({ length: Math.max(done, bucket) }, (_, i) => pageAt(i)), [bucket]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => Object.fromEntries(PAGE_FILTERS.map((f) => [f.v, all.filter((p) => matches(p, f.v)).length])), [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((p) => matches(p, filter) && (!q || p.path.toLowerCase().includes(q) || p.finalPath?.toLowerCase().includes(q)));
  }, [all, filter, query]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const changeFilter = (f: PageFilter) => { setFilter(f); setPage(1); setOpen(null); };
  const changeQuery = (q: string) => { setQuery(q); setPage(1); setOpen(null); };

  const toCsv = (ps: PageRow[]) =>
    ["n,url,status,redirect,hops,final_url,fetch_ms,render_ms,note",
      ...ps.map((p) => [p.n, p.path, p.status ?? "", redirectSide(p) ?? "", p.hops.map((h) => h.via).join(" > "), p.finalPath ?? "", p.fetchMs ?? "", p.renderMs ?? "", p.note ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

  return (
    <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
      <DataToolbar
        query={query} onQuery={changeQuery} placeholder="Search URLs"
        segments={PAGE_FILTERS.map((f) => ({ value: f.v, label: `${f.label} ${fmtNum(counts[f.v] ?? 0)}` }))}
        value={filter} onValue={changeFilter}
        count={query ? `${rows.length.toLocaleString("en-US")} matches` : ""}
        copyLabel="Copy visible URLs" onCopy={() => navigator.clipboard.writeText(rows.map((p) => p.path).join("\n"))}
        downloadLabel="Download all pages (.csv)" onDownload={() => downloadText(toCsv(all), `crawl-${crawlId}-pages.csv`, "text/csv")}
      />
      <Box overflowX="auto">
        <Box minW="760px">
          <Grid templateColumns={COLS} gap="3" px="3" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
            <Text textAlign="right">#</Text><Text>URL</Text><Text>Status</Text><Text>Redirect</Text><Text textAlign="right">Fetch</Text><Text textAlign="right">Render</Text><Text>Final URL / note</Text>
          </Grid>
          {rows.length === 0 ? (
            <Text p="4" textStyle="sm" color="fg.muted">{all.length ? "No pages match." : "No pages yet."}</Text>
          ) : (
            pageRows.map((p) => (
              <PageRowView key={p.n} p={p} open={open === p.n} onToggle={() => setOpen((o) => (o === p.n ? null : p.n))} />
            ))
          )}
        </Box>
      </Box>
      {rows.length > 0 && (
        <Pagination.Root count={rows.length} pageSize={PAGE_SIZE} page={page} onPageChange={(e) => { setPage(e.page); setOpen(null); }}>
          <HStack justify="space-between" px="3" py="2" borderTopWidth="1px" bg="bg.subtle">
            <Pagination.PageText format="long" textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums" />
            <ButtonGroup variant="ghost" size="xs">
              <Pagination.PrevTrigger asChild><IconButton aria-label="Previous page"><LuChevronLeft /></IconButton></Pagination.PrevTrigger>
              <Pagination.Items render={(pg) => <IconButton variant="ghost" color="fg.muted" _selected={{ bg: "bg.emphasized", color: "fg", fontWeight: "semibold" }}>{pg.value}</IconButton>} />
              <Pagination.NextTrigger asChild><IconButton aria-label="Next page"><LuChevronRight /></IconButton></Pagination.NextTrigger>
            </ButtonGroup>
          </HStack>
        </Pagination.Root>
      )}
    </Flex>
  );
}

function statusBadge(p: PageRow) {
  if (p.kind === "skipped") return { t: "Skipped", c: "gray" };
  if (p.kind === "timeout") return { t: "Timeout", c: "red" };
  if (p.kind === "loop") return { t: String(p.status), c: "red" };
  if (p.kind === "client") return { t: String(p.status), c: "orange" };
  if (p.kind === "server") return { t: String(p.status), c: "red" };
  if (p.kind === "redirect") return { t: String(p.status), c: p.status === 200 ? "green" : "blue" };
  return { t: "200", c: "green" };
}

function PageRowView({ p, open, onToggle }: { p: PageRow; open: boolean; onToggle: () => void }) {
  const status = statusBadge(p);
  const side = redirectSide(p);
  const expandable = p.hops.length > 1; // a single hop is fully described by the row itself
  return (
    <Box borderBottomWidth="1px" borderColor="border.muted">
      <Grid
        templateColumns={COLS} gap="3" px="3" py="1.5" textStyle="xs" alignItems="center"
        _hover={{ bg: "bg.subtle" }} cursor={expandable ? "pointer" : undefined}
        onClick={expandable ? onToggle : undefined} aria-expanded={expandable ? open : undefined}
      >
        <Text textAlign="right" color="fg.muted" fontVariantNumeric="tabular-nums">{p.n}</Text>
        <Text fontFamily="mono" truncate title={p.path}>{p.path}</Text>
        <Box><Badge size="xs" variant="subtle" colorPalette={status.c}>{status.t}</Badge></Box>
        <HStack gap="1.5">
          {side ? (
            <>
              <Badge size="xs" variant="outline" colorPalette={p.kind === "loop" ? "red" : SIDE_COLOR[side]} textTransform="capitalize">{p.kind === "loop" ? "Loop" : side}</Badge>
              {expandable && <Text fontVariantNumeric="tabular-nums" color="fg.muted">{p.hops.length} hops</Text>}
              {expandable && <Box color="fg.subtle" transition="transform 0.15s" transform={open ? "rotate(90deg)" : undefined}><LuChevronRight /></Box>}
            </>
          ) : <Text color="fg.subtle">—</Text>}
        </HStack>
        <Text textAlign="right" fontVariantNumeric="tabular-nums" color="fg.muted">{p.fetchMs != null ? `${p.fetchMs}ms` : "—"}</Text>
        <Text textAlign="right" fontVariantNumeric="tabular-nums" color="fg.muted">{p.renderMs != null ? `${(p.renderMs / 1000).toFixed(1)}s` : "—"}</Text>
        <Text color="fg.muted" truncate>
          {p.finalPath ? <><LuArrowRight style={{ display: "inline", verticalAlign: "-2px" }} /> <Span fontFamily="mono">{p.finalPath}</Span></> : p.note ?? ""}
        </Text>
      </Grid>

      {/* Hop chain on one line: each URL once, with how it redirected on the arrow */}
      {open && expandable && (
        <Flex bg="bg.subtle" px="3" py="2" ps="calc(44px + 1.5rem)" borderTopWidth="1px" borderColor="border.muted" textStyle="xs" fontFamily="mono" wrap="wrap" align="center" columnGap="2" rowGap="1">
          <Text>{p.hops[0].from}</Text>
          {p.hops.map((h, k) => (
            <Fragment key={k}>
              <Text color={`${SIDE_COLOR[h.side]}.fg`} whiteSpace="nowrap">→ {h.via} →</Text>
              <Text>{h.to}</Text>
            </Fragment>
          ))}
          {p.note && <Text color="red.fg" fontFamily="body" ms="2">{p.note}</Text>}
        </Flex>
      )}
    </Box>
  );
}

// ───────────────────────── Lighthouse scores ─────────────────────────

const SAMPLE = { performance: 72, accessibility: 91, "best practices": 96, seo: 98 };
const FULL = { performance: 70, accessibility: 90, "best practices": 95, seo: 97 };

function Scores({ run, step, onFullLighthouse }: { run: RunView; step: StepInfo; onFullLighthouse: () => void }) {
  const full = step.kind === "job";
  const ready = step.status === "success";
  const scores = full ? FULL : SAMPLE;
  return (
    <Stack gap="5">
      <Text textStyle="sm" color="fg.muted">
        {full ? `Median scores across all ${fmtNum((step.stage as FullJob).pagesTotal)} pages.` : "Median scores across a sample of 200 pages."}
        {!ready && " Scores appear when the audit finishes."}
      </Text>
      <Grid templateColumns="repeat(4, minmax(0, 1fr))" gap="4">
        {Object.entries(scores).map(([k, v]) => {
          const color = !ready ? "gray" : v >= 90 ? "green" : v >= 50 ? "orange" : "red";
          return (
            <Stack key={k} align="center" gap="2" borderWidth="1px" rounded="l2" py="4">
              <ProgressCircle.Root value={ready ? v : null} size="xl" colorPalette={color}>
                <ProgressCircle.Circle css={{ "--thickness": "5px" }}>
                  <ProgressCircle.Track />
                  <ProgressCircle.Range strokeLinecap="round" />
                </ProgressCircle.Circle>
                {ready && <ProgressCircle.ValueText />}
              </ProgressCircle.Root>
              <Text textStyle="sm">{k === "seo" ? "SEO" : k[0].toUpperCase() + k.slice(1)}</Text>
            </Stack>
          );
        })}
      </Grid>
      {!full && ready && !run.state.fullLh && (
        <Alert.Root status="info" variant="surface">
          <Alert.Indicator><LuGauge /></Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Need every page?</Alert.Title>
            <Alert.Description>A full audit of {fmtNum(run.state.crawl.done)} pages takes about {fmtDur(FULL_LH_SEC)}. It runs as a separate job and reuses this crawl.</Alert.Description>
          </Alert.Content>
          <Button size="xs" alignSelf="center" onClick={onFullLighthouse}>Run full audit</Button>
        </Alert.Root>
      )}
    </Stack>
  );
}

// PROTOTYPE ONLY: switch simulated scenarios. Delete in slice 1 (see SLICES.md).
function PrototypeBar({ scenario, onScenario, onSkip, canSkip }: {
  scenario: CrawlScenario; onScenario: (s: CrawlScenario) => void; onSkip: () => void; canSkip: boolean;
}) {
  return (
    <HStack gap="1" px="4" py="1.5" borderBottomWidth="1px" bg="bg.muted" wrap="wrap">
      <Text textStyle="xs" fontWeight="semibold" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" me="2">Prototype</Text>
      {SCENARIOS.map((x) => (
        <Button key={x.v} size="xs" variant={scenario === x.v ? "subtle" : "ghost"} onClick={() => onScenario(x.v)}>{x.label}</Button>
      ))}
      <Button size="xs" variant="outline" onClick={() => onScenario(scenario)}>Restart</Button>
      <Button size="xs" variant="outline" onClick={onSkip} disabled={!canSkip}><LuSkipForward />Skip stage</Button>
    </HStack>
  );
}
