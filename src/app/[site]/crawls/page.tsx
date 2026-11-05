"use client";

// Crawl history · /[site]/crawls
// Same frame as the run page: facts row → one data panel
// (shared toolbar + table + pagination). Rows open /[site]/crawls/[crawlId].
import { useMemo, useState } from "react";
import NextLink from "next/link";
import {
  Box, Container, DataList, Flex, Grid, HStack, Heading, Progress, Span, Text,
} from "@chakra-ui/react";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { TablePagination } from "@/components/table-pagination";
import { StageIcon } from "@/components/step-ui";
import { crawlsFor, type CrawlListStatus, type CrawlRow } from "@/lib/crawls-list";
import { useSite } from "@/components/site-context";
import { hostOf } from "@/lib/settings";
import { fmtDur, fmtNum, type StageStatus } from "@/lib/types";

type Filter = "all" | "active" | "failed" | "success";
const FILTERS: { v: Filter; label: string; match: (c: CrawlRow) => boolean }[] = [
  { v: "all", label: "All", match: () => true },
  { v: "active", label: "Running", match: (c) => c.status === "running" || c.status === "paused" },
  { v: "failed", label: "Failed", match: (c) => c.status === "failed" },
  { v: "success", label: "Succeeded", match: (c) => c.status === "success" },
];
const STATUS_LABEL: Record<CrawlListStatus, string> = { running: "Running", paused: "Paused", success: "Succeeded", failed: "Failed", cancelled: "Cancelled" };
const STATUS_ICON: Record<CrawlListStatus, StageStatus> = { running: "running", paused: "paused", success: "success", failed: "failed", cancelled: "blocked" };
const COLS = "88px minmax(180px, 2fr) 132px 96px 72px 96px 120px 92px";
const PAGE_SIZE = 20;

const fmtDate = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export default function CrawlsPage() {
  const site = useSite();
  const CRAWLS = useMemo(() => crawlsFor(site), [site]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.v, CRAWLS.filter(f.match).length])), [CRAWLS]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.v === filter)!;
    return CRAWLS.filter((c) => f.match(c) && (!q || c.id.includes(q) || c.url.includes(q)));
  }, [CRAWLS, filter, query]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Facts: last 30 days
  const recent = CRAWLS.filter((c) => c.startedAt >= new Date(Date.UTC(2026, 9, 5)));
  const finished = recent.filter((c) => c.status === "success" || c.status === "failed");
  const successRate = finished.length ? (finished.filter((c) => c.status === "success").length / finished.length) * 100 : 0;
  const prod = recent.filter((c) => c.status === "success").map((c) => c.durationSec).sort((a, b) => a - b);
  const median = prod.length ? prod[Math.floor(prod.length / 2)] : 0;

  const toCsv = () => ["id,url,status,pages,error_pct,duration_s,started_at,trigger",
    ...rows.map((c) => [c.id, c.url, c.status, c.pages, c.errorPct, c.durationSec, c.startedAt.toISOString(), c.trigger].join(","))].join("\n");

  return (
    <Box bg="bg" minH="100vh">
      <Box borderBottomWidth="1px" bg="bg.subtle">
        <Container maxW="7xl" pt="7" pb="5">
          <Heading size="xl" fontWeight="semibold" mb="5">Crawl history</Heading>

          <DataList.Root orientation="vertical" size="sm" display="grid" gridTemplateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, minmax(0, 1fr))" }} gap="5">
            <Fact label="Running now">{counts.active}</Fact>
            <Fact label="Crawls, last 30 days">{recent.length}</Fact>
            <Fact label="Success rate">{successRate.toFixed(0)}%</Fact>
            <Fact label="Median duration">{fmtDur(median)}</Fact>
          </DataList.Root>
        </Container>
      </Box>

      <Container maxW="7xl" py="6">
        <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden">
          <DataToolbar
            query={query} onQuery={(q) => { setQuery(q); setPage(1); }} placeholder="Search crawls"
            segments={FILTERS.map((f) => ({ value: f.v, label: `${f.label} ${counts[f.v]}` }))}
            value={filter} onValue={(v) => { setFilter(v); setPage(1); }}
            count={query ? `${rows.length} matches` : ""}
            copyLabel="Copy visible crawl IDs" onCopy={() => navigator.clipboard.writeText(pageRows.map((c) => c.id).join("\n"))}
            downloadLabel="Download crawls (.csv)" onDownload={() => downloadText(toCsv(), `crawls-${site}.csv`, "text/csv")}
          />
          <Box overflowX="auto">
            <Box minW="980px">
              <Grid templateColumns={COLS} gap="4" px="4" py="2" borderBottomWidth="1px" textStyle="xs" fontWeight="medium" color="fg.muted">
                <Text>Crawl</Text><Text>Target</Text><Text>Status</Text>
                <Text textAlign="right">Pages</Text><Text textAlign="right">Errors</Text><Text textAlign="right">Duration</Text>
                <Text>Started</Text><Text>Trigger</Text>
              </Grid>
              {pageRows.length === 0 ? (
                <Text p="4" textStyle="sm" color="fg.muted">No crawls match.</Text>
              ) : pageRows.map((c) => <CrawlRowView key={c.id} c={c} site={site} />)}
            </Box>
          </Box>
          {rows.length > 0 && (
            <TablePagination count={rows.length} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
          )}
        </Flex>
      </Container>

    </Box>
  );
}

function CrawlRowView({ c, site }: { c: CrawlRow; site: string }) {
  const live = c.status === "running" || c.status === "paused";
  return (
    <Grid
      asChild templateColumns={COLS} gap="4" px="4" py="2.5" alignItems="center" textStyle="sm"
      borderBottomWidth="1px" borderColor="border.muted" _hover={{ bg: "bg.subtle" }} fontVariantNumeric="tabular-nums"
    >
      <NextLink href={`/${site}/crawls/${c.id}`}>
        <Text fontWeight="medium">{c.id}</Text>
        <Text color="fg.muted" truncate>{hostOf(c.url)}</Text>
        <HStack gap="2">
          <StageIcon status={STATUS_ICON[c.status]} size="sm" />
          <Text>{STATUS_LABEL[c.status]}</Text>
          {live && c.progressPct != null && (
            <Progress.Root value={c.progressPct} size="xs" w="10" colorPalette={c.status === "paused" ? "yellow" : "blue"}>
              <Progress.Track><Progress.Range /></Progress.Track>
            </Progress.Root>
          )}
        </HStack>
        <Text textAlign="right">{fmtNum(c.pages)}</Text>
        <Text textAlign="right" color={c.errorPct > 5 ? "red.fg" : undefined}>{c.errorPct.toFixed(1)}%</Text>
        <Text textAlign="right">{live ? <Span color="fg.muted">{fmtDur(c.durationSec)}</Span> : fmtDur(c.durationSec)}</Text>
        <Text color="fg.muted">{fmtDate(c.startedAt)}</Text>
        <Text color="fg.muted">{c.trigger}</Text>
      </NextLink>
    </Grid>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DataList.Item>
      <DataList.ItemLabel>{label}</DataList.ItemLabel>
      <DataList.ItemValue display="block" fontWeight="medium" fontVariantNumeric="tabular-nums">{children}</DataList.ItemValue>
    </DataList.Item>
  );
}
