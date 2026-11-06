// The look of a chip: a muted pill with the colour dot and priority of what it names, then its title. One component
// for the chips in the editor (resolved @references); the chat's chips (assistant/chips.tsx) share its look.
import { chakra, Text } from "@chakra-ui/react";

import { chipStyle, Dot } from "@/components/assistant/chips";
import type { Mark } from "@/lib/nav/search";

export function ChipPill({ label, mark, title, maxLabel = "180px" }: { label: string; mark?: Mark | null; title?: string; maxLabel?: string }) {
  return (
    <chakra.span
      className="tq-chip" title={title} {...chipStyle} cursor="default" userSelect="none"
    >
      {mark && <Dot color={mark.dot} />}
      {mark?.tag && <Text as="span" fontWeight="medium" color={mark.tagColor} flexShrink={0}>{mark.tag}</Text>}
      <Text as="span" truncate maxW={maxLabel}>{label}</Text>
    </chakra.span>
  );
}
