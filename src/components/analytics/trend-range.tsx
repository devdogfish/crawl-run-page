import { createContext, useContext } from "react";
import { SegmentGroup } from "@chakra-ui/react";
import { RANGES, type Range } from "@/lib/analytics";

export const TrendRangeContext = createContext<{ range: Range; setRange: (range: Range) => void } | null>(null);

export function TrendRange() {
  const state = useContext(TrendRangeContext);
  if (!state) return null;
  return (
    <SegmentGroup.Root size="sm" aria-label="Trend date range" flexShrink={0} value={state.range} onValueChange={(e) => e.value && state.setRange(e.value as Range)}>
      <SegmentGroup.Indicator bg="bg" />
      <SegmentGroup.Items items={RANGES} />
    </SegmentGroup.Root>
  );
}
