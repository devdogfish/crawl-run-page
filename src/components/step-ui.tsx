// Small shared pieces for steps: status labels, status icon, per-step throughput chart.
import { Chart, useChart } from "@chakra-ui/charts";
import { Icon, Spinner } from "@chakra-ui/react";
import { Area, AreaChart, Tooltip, XAxis, YAxis } from "recharts";
import { LuCircleCheck, LuCircleDashed, LuCircleDot, LuCirclePause, LuCircleX, LuLock, LuTriangleAlert } from "react-icons/lu";

import { fmtClock, fmtNum, type Stage, type StageStatus } from "@/lib/types";

export const STATUS: Record<StageStatus, { label: string; palette: string }> = {
  pending: { label: "Pending", palette: "gray" },
  waiting: { label: "Waiting", palette: "gray" },
  running: { label: "Running", palette: "blue" },
  paused: { label: "Paused", palette: "yellow" },
  success: { label: "Succeeded", palette: "green" },
  warning: { label: "Warnings", palette: "orange" },
  failed: { label: "Failed", palette: "red" },
  blocked: { label: "Not run", palette: "gray" },
};

export const STAGE_COLORS = ["blue.solid", "cyan.solid", "purple.solid", "orange.solid", "teal.solid", "pink.solid"];

export function StageIcon({ status, size = "md" }: { status: StageStatus; size?: "sm" | "md" }) {
  const boxSize = size === "sm" ? 4 : 5;
  if (status === "running") return <Spinner size="sm" color="blue.solid" borderWidth="2px" />;
  const map = {
    paused: [LuCirclePause, "yellow.solid"],
    success: [LuCircleCheck, "green.solid"],
    warning: [LuTriangleAlert, "orange.solid"],
    failed: [LuCircleX, "red.solid"],
    waiting: [LuCircleDot, "fg.muted"],
    blocked: [LuLock, "fg.subtle"],
    pending: [LuCircleDashed, "fg.subtle"],
  } as const;
  const [I, color] = map[status];
  return <Icon as={I} boxSize={boxSize} color={color} flexShrink={0} />;
}

// Rows written over time for one stage (Chakra Charts + Recharts)
export function StageAreaChart({ stage, color, height = "28", dataKey = "rows" }: { stage: Stage; color: string; height?: string; dataKey?: "rows" | "rowsPerSec" }) {
  const chart = useChart({
    data: stage.samples.map((p) => ({ ...p, time: fmtClock(p.t) })),
    series: [{ name: dataKey, color: stage.status === "failed" ? "red.solid" : color, label: dataKey === "rows" ? "Rows written" : "Rows/sec" }],
  });
  const id = `grad-${stage.id}-${dataKey}`;
  return (
    <Chart.Root chart={chart} h={height}>
      <AreaChart responsive data={chart.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <Chart.Gradient id={id} stops={[{ offset: "0%", color: chart.color(chart.series[0].color), opacity: 0.45 }, { offset: "100%", color: chart.color(chart.series[0].color), opacity: 0.02 }]} />
        </defs>
        <XAxis dataKey="time" hide />
        <YAxis hide domain={[0, "dataMax"]} />
        <Tooltip animationDuration={0} cursor={false} content={<Chart.Tooltip formatter={(v) => fmtNum(Number(v))} />} />
        <Area isAnimationActive={false} type="monotone" dataKey={chart.key(dataKey)} stroke={chart.color(chart.series[0].color)} fill={`url(#${id})`} strokeWidth={2} />
      </AreaChart>
    </Chart.Root>
  );
}

