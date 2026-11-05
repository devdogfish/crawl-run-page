// Charts shared by option F (copied from D so D/E stay untouched)
import { useMemo } from "react";
import { BarSegment, Chart, useChart } from "@chakra-ui/charts";
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { USUAL_CRAWL_SEC, type CodeBucket } from "@/lib/crawl";
import { fmtClock, fmtDur, fmtNum } from "@/lib/types";

export function CrawlChart({ samples, usualRate }: { samples: { t: number; pagesPerSec: number; queue: number }[]; usualRate: number }) {
  const chart = useChart({
    data: samples,
    series: [
      { name: "pagesPerSec", color: "blue.solid", label: "Pages/sec" },
      { name: "queue", color: "orange.solid", label: "Queue (right axis)", strokeDasharray: "4 3" },
    ],
  });
  return (
    <Chart.Root chart={chart} h="52">
      <ComposedChart responsive data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <Chart.Gradient id="crawl-rate" stops={[{ offset: "0%", color: "blue.solid", opacity: 0.4 }, { offset: "100%", color: "blue.solid", opacity: 0.02 }]} />
        </defs>
        <CartesianGrid stroke={chart.color("border.muted")} vertical={false} />
        <XAxis dataKey="t" type="number" domain={[0, (d: number) => Math.max(d, USUAL_CRAWL_SEC)]} tickFormatter={(t) => fmtDur(t)} tickLine={false} fontSize={11} stroke={chart.color("border")} />
        <YAxis yAxisId="rate" width={36} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("border")} />
        <YAxis yAxisId="queue" orientation="right" tickFormatter={fmtNum} width={44} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("border")} />
        <ReferenceLine yAxisId="rate" y={Math.round(usualRate)} stroke={chart.color("fg.subtle")} strokeDasharray="4 4" label={{ value: "usual rate", position: "insideTopLeft", fontSize: 10, fill: chart.color("fg.muted") }} />
        <RTooltip animationDuration={0} content={<Chart.Tooltip labelFormatter={(t) => (Number.isFinite(Number(t)) ? fmtClock(Number(t)) : "")} formatter={(v) => fmtNum(Number(v))} />} />
        <Legend verticalAlign="top" align="right" height={24} content={<Chart.Legend />} />
        <Area yAxisId="rate" isAnimationActive={false} type="monotone" dataKey={chart.key("pagesPerSec")} stroke={chart.color("blue.solid")} fill="url(#crawl-rate)" strokeWidth={2} />
        <Line yAxisId="queue" isAnimationActive={false} type="monotone" dataKey={chart.key("queue")} stroke={chart.color("orange.solid")} strokeDasharray="4 3" dot={false} strokeWidth={1.5} />
      </ComposedChart>
    </Chart.Root>
  );
}

export const CODE_META: Record<CodeBucket, { label: string; color: string }> = {
  "2xx": { label: "2xx", color: "green.solid" },
  "3xx": { label: "3xx", color: "teal.solid" },
  "4xx": { label: "4xx", color: "orange.solid" },
  "429": { label: "429", color: "yellow.solid" },
  "5xx": { label: "5xx", color: "red.solid" },
  timeout: { label: "Timeout", color: "purple.solid" },
};
export function CodesBar({ codes }: { codes: Record<CodeBucket, number> }) {
  const data = (Object.keys(CODE_META) as CodeBucket[]).map((k) => ({ name: CODE_META[k].label, value: codes[k], color: CODE_META[k].color })).filter((d) => d.value > 0);
  const chart = useChart({ data });
  if (!data.length) return null;
  return (
    <BarSegment.Root chart={chart} barSize="2.5">
      <BarSegment.Content>
        <BarSegment.Bar tooltip />
      </BarSegment.Content>
      <BarSegment.Legend showPercent gap="4" textStyle="xs" />
    </BarSegment.Root>
  );
}

// Past crawl durations; the last point is this run (projected and hollow while crawling)
export function HistoryChart({ current, live, h = "32", compact = false }: { current: number; live: boolean; h?: string; compact?: boolean }) {
  const data = useMemo(() => {
    const past = Array.from({ length: 19 }, (_, i) => ({
      run: `#${793 + i}`,
      minutes: +(21 + 1.6 * Math.sin(i * 1.1) + (i === 12 ? 6.5 : 0)).toFixed(1),
    }));
    return [...past, { run: "#812", minutes: +(current / 60).toFixed(1) }];
  }, [current]);
  const chart = useChart({ data, series: [{ name: "minutes", color: "blue.solid", label: "Minutes" }] });
  return (
    <Chart.Root chart={chart} h={h}>
      <LineChart responsive data={chart.data} margin={compact ? { top: 6, right: 6, left: 6, bottom: 6 } : { top: 8, right: 12, left: 0, bottom: 0 }}>
        {!compact && <CartesianGrid stroke={chart.color("border.muted")} vertical={false} />}
        <XAxis dataKey="run" hide={compact} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("border")} interval="preserveStartEnd" minTickGap={40} />
        <YAxis hide={compact} tickFormatter={(v) => `${v}m`} width={36} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("border")}
          domain={compact ? [(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)] : [0, (max: number) => Math.ceil((max + 2) / 10) * 10]} />
        <ReferenceLine y={21} stroke={chart.color("fg.subtle")} strokeDasharray="4 4" label={compact ? undefined : { value: "median", position: "insideTopLeft", fontSize: 10, fill: chart.color("fg.muted") }} />
        <RTooltip animationDuration={0} cursor={compact ? false : undefined} content={<Chart.Tooltip formatter={(v) => `${v} min`} />} />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey={chart.key("minutes")}
          stroke={chart.color("blue.solid")}
          strokeWidth={2}
          dot={(p: { cx?: number; cy?: number; index?: number }) =>
            p.index === data.length - 1
              ? <circle key={p.index} cx={p.cx} cy={p.cy} r={compact ? 3.5 : 5} fill={live ? chart.color("bg") : chart.color("blue.solid")} stroke={chart.color("blue.solid")} strokeWidth={2} strokeDasharray={live ? "2 2" : undefined} />
              : <g key={p.index} />
          }
        />
      </LineChart>
    </Chart.Root>
  );
}
