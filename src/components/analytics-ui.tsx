// Building blocks shared by the Analytics variations: score dial, deltas, donuts, segmented bars, trends.
// Colours: priorities and health bands are status colours (with a label, never colour alone);
// categories keep one fixed hue each (CAT_COLOR). One y-axis per chart.
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { Box, Flex, HStack, Heading, Icon, Stack, Text, type BoxProps } from "@chakra-ui/react";
import { Chart, useChart } from "@chakra-ui/charts";
import { Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceArea, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { LuArrowDownRight, LuArrowRight, LuArrowUpRight, LuInfo } from "react-icons/lu";

import { Tooltip } from "@/components/ui/tooltip";
import { BANDS, bandColor, bandOf, fmtInt, type Point } from "@/lib/analytics";

const cssVar = (token: string) => `var(--chakra-colors-${token.replace(/\./g, "-")})`;

// ───────── Frames ─────────
export function Panel({ title, description, action, children, ...rest }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode } & Omit<BoxProps, "title">) {
  return (
    <Box borderWidth="1px" rounded="l3" bg="bg" p={{ base: "4", md: "5" }} minW="0" {...rest}>
      {(title || action) && (
        <Flex justify="space-between" align="start" gap="3" mb="4">
          <Stack gap="0.5" minW="0">
            {title && <Box textStyle="sm" fontWeight="semibold">{title}</Box>}
            {description && <Box textStyle="xs" color="fg.muted">{description}</Box>}
          </Stack>
          {action}
        </Flex>
      )}
      {children}
    </Box>
  );
}

export function SectionHeading({ title, description, action, id }: { title: string; description?: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return (
    <Flex id={id} justify="space-between" align={{ base: "start", sm: "end" }} direction={{ base: "column", sm: "row" }} gap="2" mb="4" scrollMarginTop="20">
      <Stack gap="1">
        <Heading size="md" fontWeight="semibold">{title}</Heading>
        {description && <Text textStyle="sm" color="fg.muted" maxW="2xl">{description}</Text>}
      </Stack>
      {action}
    </Flex>
  );
}

export function Help({ text }: { text: string }) {
  return (
    <Tooltip content={text} showArrow contentProps={{ maxW: "xs" }}>
      <Box as="span" display="inline-flex" color="fg.subtle" cursor="help" verticalAlign="middle"><Icon as={LuInfo} boxSize="3.5" /></Box>
    </Tooltip>
  );
}

export function MoreLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <HStack asChild gap="1" textStyle="xs" fontWeight="medium" color="fg.muted" _hover={{ color: "fg" }} flexShrink={0}>
      <RouterLink to={to}>{children}<Icon as={LuArrowRight} boxSize="3" /></RouterLink>
    </HStack>
  );
}

// ───────── Numbers ─────────
// Change between two values. goodWhen says which direction is an improvement (green).
export function Delta({ now, then, goodWhen, suffix = "", fmt = fmtInt, label }: {
  now: number; then: number; goodWhen: "up" | "down"; suffix?: string; fmt?: (x: number) => string; label?: string;
}) {
  const d = now - then;
  const flat = Math.abs(d) < 0.5;
  const good = flat ? null : (d > 0) === (goodWhen === "up");
  return (
    <HStack gap="1" textStyle="xs" color={good == null ? "fg.muted" : good ? "green.fg" : "red.fg"} fontVariantNumeric="tabular-nums" whiteSpace="nowrap">
      <Icon as={flat ? LuArrowRight : d > 0 ? LuArrowUpRight : LuArrowDownRight} boxSize="3.5" />
      <Text>{flat ? "No change" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}${suffix}`}</Text>
      {label && <Text color="fg.muted">{label}</Text>}
    </HStack>
  );
}

export function Stat({ label, value, help, children, to }: { label: string; value: React.ReactNode; help?: string; children?: React.ReactNode; to?: string }) {
  const body = (
    <Stack gap="1.5" minW="0">
      <HStack gap="1.5"><Text textStyle="xs" color="fg.muted" truncate>{label}</Text>{help && <Help text={help} />}</HStack>
      <Text textStyle="2xl" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{value}</Text>
      {children}
    </Stack>
  );
  return to ? <Box asChild display="block" _hover={{ "& p:nth-of-type(2)": { textDecoration: "underline" } }}><RouterLink to={to}>{body}</RouterLink></Box> : body;
}

// ───────── Score: a meter against 100, coloured by its band ─────────
export function ScoreDial({ score, size = 132, label = "Health score", thickness = 10 }: { score: number; size?: number; label?: string; thickness?: number }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const color = `${bandColor(score)}.solid`;
  return (
    <Box position="relative" w={`${size}px`} h={`${size}px`} flexShrink={0} role="img" aria-label={`${label}: ${score} out of 100, ${BANDS.find((b) => b.id === bandOf(score))!.label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={cssVar("border.muted")} strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={cssVar(color)} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <Stack position="absolute" inset="0" align="center" justify="center" gap="0">
        <Text fontSize={size > 100 ? "3xl" : "lg"} fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{score}</Text>
        {size > 100 && <Text textStyle="xs" color="fg.muted" mt="1">{BANDS.find((b) => b.id === bandOf(score))!.label}</Text>}
      </Stack>
    </Box>
  );
}

// Small score pill for tables and lists
export function ScoreChip({ score }: { score: number }) {
  const c = bandColor(score);
  return (
    <HStack gap="1.5" fontVariantNumeric="tabular-nums" flexShrink={0}>
      <Box boxSize="2" rounded="full" bg={`${c}.solid`} />
      <Text textStyle="sm" fontWeight="medium" minW="6" textAlign="right">{score}</Text>
    </HStack>
  );
}

// ───────── Part to whole ─────────
export type Part = { name: string; value: number; color: string; to?: string; hint?: string };

// A donut with its legend: name, value, share. Rows link when a part has `to`.
export function Donut({ parts, center, centerLabel, size = 140, legend = "side" }: {
  parts: Part[]; center?: React.ReactNode; centerLabel?: string; size?: number; legend?: "side" | "below";
}) {
  const data = parts.filter((p) => p.value > 0);
  const chart = useChart({ data });
  const total = data.reduce((t, p) => t + p.value, 0);
  // Hovering a slice or a legend row highlights both; no tooltip. The centre shows the hovered part.
  const [active, setActive] = useState<string | null>(null);
  const activeIdx = data.findIndex((d) => d.name === active);
  const activePart = activeIdx >= 0 ? data[activeIdx] : null;
  return (
    <Flex direction={legend === "side" ? { base: "column", sm: "row" } : "column"} align={legend === "side" ? { base: "start", sm: "center" } : "stretch"} gap="5">
      <Box position="relative" w={`${size}px`} h={`${size}px`} flexShrink={0} alignSelf={legend === "below" ? "center" : undefined}>
        <Chart.Root chart={chart} w={`${size}px`} h={`${size}px`}>
          <PieChart responsive>
            <Pie isAnimationActive={false} data={chart.data} dataKey={chart.key("value")} nameKey="name"
              onMouseEnter={(_: unknown, i: number) => setActive(data[i]?.name ?? null)} onMouseLeave={() => setActive(null)}
              innerRadius={size * 0.36} outerRadius={size / 2 - 2} stroke={chart.color("bg")} strokeWidth={2} startAngle={90} endAngle={-270}>
              {chart.data.map((d) => <Cell key={d.name} fill={chart.color(d.color)} fillOpacity={active && active !== d.name ? 0.55 : 1} style={{ transition: "fill-opacity .2s ease", outline: "none" }} />)}
            </Pie>
          </PieChart>
        </Chart.Root>
        {center != null && (
          <Stack position="absolute" inset="0" align="center" justify="center" gap="0" pointerEvents="none">
            <Text textStyle="lg" fontWeight="semibold" lineHeight="1" fontVariantNumeric="tabular-nums">{activePart ? `${Math.round((activePart.value / total) * 100)}%` : center}</Text>
            {(activePart || centerLabel) && <Text textStyle="2xs" color="fg.muted" mt="0.5" maxW="70%" textAlign="center" truncate>{activePart ? activePart.name : centerLabel}</Text>}
          </Stack>
        )}
      </Box>
      <Stack gap="1" flex="1" minW="0" w="full">
        {parts.map((p) => {
          const row = (
            <HStack gap="2" textStyle="xs" py="0.5" fontVariantNumeric="tabular-nums" w="full" transition="opacity .2s ease" opacity={active && active !== p.name ? 0.6 : 1}>
              <Box boxSize="2.5" rounded="sm" bg={p.color} flexShrink={0} />
              <Text flex="1" truncate title={p.hint}>{p.name}</Text>
              <Text color="fg.muted">{fmtInt(p.value)}</Text>
              <Text w="9" textAlign="right" fontWeight="medium">{total ? Math.round((p.value / total) * 100) : 0}%</Text>
            </HStack>
          );
          return p.to
            ? <Box asChild key={p.name} rounded="l1" px="1" mx="-1" bg={active === p.name ? "bg.muted" : undefined} onMouseEnter={() => setActive(p.name)} onMouseLeave={() => setActive(null)}><RouterLink to={p.to}>{row}</RouterLink></Box>
            : <Box key={p.name} rounded="l1" px="1" mx="-1" bg={active === p.name ? "bg.muted" : undefined} onMouseEnter={() => setActive(p.name)} onMouseLeave={() => setActive(null)}>{row}</Box>;
        })}
      </Stack>
    </Flex>
  );
}

// One whole split into parts, as a single bar with 2px gaps; each part has a tooltip and can link
export function SegBar({ parts, h = "3" }: { parts: Part[]; h?: string }) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <Flex h={h} gap="2px" rounded="full" overflow="hidden" w="full">
      {parts.filter((p) => p.value > 0).map((p) => {
        const seg = <Box h="full" bg={p.color} flexGrow={p.value} flexBasis="0" minW="1" _hover={{ opacity: 0.8 }} />;
        return (
          <Tooltip key={p.name} content={`${p.name}: ${fmtInt(p.value)} (${Math.round((p.value / total) * 100)}%)`} openDelay={50} closeDelay={0}>
            {p.to ? <Box asChild flexGrow={p.value} flexBasis="0" minW="1" display="block"><RouterLink to={p.to} aria-label={p.name}>{seg}</RouterLink></Box> : seg}
          </Tooltip>
        );
      })}
    </Flex>
  );
}

// ───────── Over time ─────────
// Tiny line with no axes; the last point is marked
export function Sparkline({ values, color = "fg.muted", h = "8", w = "full", pad = 0 }: { values: number[]; color?: string; h?: string; w?: string; pad?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  const chart = useChart({ data, series: [{ name: "v", color }] });
  return (
    <Chart.Root chart={chart} h={h} w={w}>
      <LineChart responsive data={chart.data} margin={{ top: 3, right: 4, bottom: 3, left: 4 }}>
        <YAxis hide domain={pad ? [(m: number) => m - pad, (m: number) => m + pad] : ["dataMin", "dataMax"]} />
        <Line isAnimationActive={false} type="monotone" dataKey="v" stroke={chart.color(color)} strokeWidth={1.5}
          dot={(p: { cx?: number; cy?: number; index?: number }) => p.index === data.length - 1
            ? <circle key={p.index} cx={p.cx} cy={p.cy} r={2.5} fill={chart.color(color)} />
            : <g key={p.index} />} />
      </LineChart>
    </Chart.Root>
  );
}

// The health score over time, with the bands shaded behind it
export function ScoreTrend({ points, h = "56", pick = (p: Point) => p.score, label = "Health score" }: { points: Point[]; h?: string; pick?: (p: Point) => number; label?: string }) {
  const data = points.map((p) => ({ label: p.label, score: pick(p) }));
  const chart = useChart({ data, series: [{ name: "score", color: "brand.solid", label }] });
  const ys = data.map((d) => d.score);
  const lo = Math.max(0, Math.floor((Math.min(...ys) - 6) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...ys) + 6) / 5) * 5);
  return (
    <Chart.Root chart={chart} h={h}>
      <AreaChart responsive data={chart.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <Chart.Gradient id="score-fill" stops={[{ offset: "0%", color: "brand.solid", opacity: 0.25 }, { offset: "100%", color: "brand.solid", opacity: 0.02 }]} />
        </defs>
        <ReferenceArea y1={80} y2={100} fill={chart.color("green.subtle")} fillOpacity={0.5} ifOverflow="hidden" />
        <ReferenceArea y1={60} y2={80} fill={chart.color("orange.subtle")} fillOpacity={0.4} ifOverflow="hidden" />
        <ReferenceArea y1={0} y2={60} fill={chart.color("red.subtle")} fillOpacity={0.4} ifOverflow="hidden" />
        <CartesianGrid stroke={chart.color("border.muted")} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} interval="preserveStartEnd" minTickGap={32} />
        <YAxis domain={[lo, hi]} width={30} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} />
        <RTooltip animationDuration={0} content={<Chart.Tooltip />} />
        <Area isAnimationActive={false} type="monotone" dataKey={chart.key("score")} stroke={chart.color("brand.solid")} strokeWidth={2} fill="url(#score-fill)"
          activeDot={{ r: 4, stroke: chart.color("bg"), strokeWidth: 2 }} />
      </AreaChart>
    </Chart.Root>
  );
}

// Several series on one axis (issues by priority, category scores); a legend sits above
export function MultiTrend({ points, series, h = "56", stacked = false, domain }: {
  points: Point[]; series: { key: string; label: string; color: string; pick: (p: Point) => number }[]; h?: string; stacked?: boolean; domain?: [number, number];
}) {
  const data = points.map((p) => Object.fromEntries([["label", p.label], ...series.map((s) => [s.key, s.pick(p)])]));
  const chart = useChart({ data, series: series.map((s) => ({ name: s.key, color: s.color, label: s.label })) });
  return (
    <Stack gap="2">
      <HStack gap="4" wrap="wrap">
        {series.map((s) => (
          <HStack key={s.key} gap="1.5" textStyle="xs"><Box w="3" h="0.5" rounded="full" bg={s.color} /><Text color="fg.muted">{s.label}</Text></HStack>
        ))}
      </HStack>
      <Chart.Root chart={chart} h={h}>
        {stacked ? (
          <AreaChart responsive data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chart.color("border.muted")} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} interval="preserveStartEnd" minTickGap={32} />
            <YAxis width={44} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
            <RTooltip animationDuration={0} content={<Chart.Tooltip formatter={(v) => fmtInt(Number(v))} />} />
            {chart.series.map((s) => (
              <Area key={String(s.name)} isAnimationActive={false} type="monotone" stackId="a" dataKey={String(s.name)}
                stroke={chart.color("bg")} strokeWidth={1.5} fill={chart.color(s.color)} fillOpacity={0.85} />
            ))}
          </AreaChart>
        ) : (
          <LineChart responsive data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chart.color("border.muted")} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} interval="preserveStartEnd" minTickGap={32} />
            <YAxis width={30} domain={domain ?? ["auto", "auto"]} tickLine={false} axisLine={false} fontSize={11} stroke={chart.color("fg.muted")} />
            <RTooltip animationDuration={0} content={<Chart.Tooltip />} />
            {chart.series.map((s) => (
              <Line key={String(s.name)} isAnimationActive={false} type="monotone" dataKey={String(s.name)} stroke={chart.color(s.color)} strokeWidth={2} dot={false}
                activeDot={{ r: 4, stroke: chart.color("bg"), strokeWidth: 2 }} />
            ))}
          </LineChart>
        )}
      </Chart.Root>
    </Stack>
  );
}

// Horizontal bars for a ranked list, each row linking somewhere
export function BarRows({ rows, color = "brand.solid" }: { rows: { label: React.ReactNode; value: number; display?: React.ReactNode; to?: string; right?: React.ReactNode; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Stack gap="1">
      {rows.map((r, k) => {
        const body = (
          <Box position="relative" py="1.5" px="2" rounded="l1">
            <Box position="absolute" insetY="0.5" left="0" w={`${Math.max(1, (r.value / max) * 100)}%`} bg={r.color ?? color} opacity={0.14} rounded="l1" />
            <HStack position="relative" gap="3" textStyle="sm" fontVariantNumeric="tabular-nums">
              <Box flex="1" minW="0" truncate>{r.label}</Box>
              {r.right}
              <Box fontWeight="medium" minW="12" textAlign="right">{r.display ?? fmtInt(r.value)}</Box>
            </HStack>
          </Box>
        );
        return r.to
          ? <Box asChild key={k} display="block" rounded="l1" _hover={{ bg: "bg.muted" }}><RouterLink to={r.to}>{body}</RouterLink></Box>
          : <Box key={k}>{body}</Box>;
      })}
    </Stack>
  );
}
