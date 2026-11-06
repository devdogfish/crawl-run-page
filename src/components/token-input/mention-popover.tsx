// The suggestions of a mention chip in the chat: a popover anchored to the chip, above it (the composer is at the
// bottom of the screen), flipped / shifted by Chakra's (Ark's) positioning so it stays inside the viewport. It never
// takes focus from the editor: the editor owns the keys, a click on a row is a mousedown that is cancelled.
import { useEffect, useMemo, useRef } from "react";
import { Box, chakra, Popover, Portal, Text } from "@chakra-ui/react";

import { Dot } from "@/components/assistant/chips";
import type { RefKind } from "@/lib/nav/segments";
import type { Suggestion } from "@/lib/nav/suggest";

const TITLE: Record<RefKind, string> = { issue: "Issues", rule: "Rules", page: "Pages", crawl: "Crawls" };

export function MentionPopover({ open, kind: kindNow, items: itemsNow, hi: hiNow, listId, anchor, anchorKey, onPick, onEscape }: {
  open: boolean; kind: RefKind | null; items: Suggestion[]; hi: number; listId: string;
  anchor: () => DOMRect | null; anchorKey: string; onEscape: (e: KeyboardEvent) => void; onPick: (s: Suggestion) => void;
}) {
  // while it fades out it keeps showing what it showed
  const shown = useRef({ kind: kindNow, items: itemsNow, hi: hiNow });
  if (open) shown.current = { kind: kindNow, items: itemsNow, hi: hiNow };
  const { kind, items, hi } = shown.current;

  // a new positioning object makes the popover measure again (the chip moved, grew, or the page scrolled under it)
  const positioning = useMemo(() => ({
    placement: "top-start" as const, gutter: 6, flip: true, overflowPadding: 8, fitViewport: true,
    getAnchorRect: () => { const r = anchor(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; },
  }), [anchorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) document.getElementById(`${listId}-opt-${hi}`)?.scrollIntoView({ block: "nearest" });
  }, [open, hi, listId, items]);

  return (
    <Popover.Root open={open} positioning={positioning} autoFocus={false} modal={false} closeOnInteractOutside={false} closeOnEscape={false} onEscapeKeyDown={onEscape} lazyMount unmountOnExit>
      <Portal>
        <Popover.Positioner>
          <Popover.Content
            w="360px" maxW="calc(100vw - 16px)" p="0" rounded="l3" shadow="lg" overflow="hidden" tabIndex={-1} outline="none"
            onMouseDown={(e) => e.preventDefault()} aria-label={kind ? TITLE[kind] : "Mention"}
          >
            <Text textStyle="xs" fontWeight="medium" color="fg.muted" px="3" pt="2" pb="1">{kind ? TITLE[kind] : "Mention"}</Text>
            <Box id={listId} role="listbox" aria-label={kind ? TITLE[kind] : "Mention"} maxH="min(280px, var(--available-height, 280px))" overflowY="auto" p="1" pt="0">
              {items.map((s, k) => (
                <chakra.div
                  key={s.text} id={`${listId}-opt-${k}`} role="option" aria-selected={k === hi} display="flex" alignItems="center" gap="2" h="8" px="2" rounded="l2" cursor="pointer" textStyle="xs"
                  bg={k === hi ? "bg.muted" : undefined} _hover={{ bg: "bg.muted" }} onClick={() => onPick(s)}
                >
                  {s.mark && <Dot color={s.mark.dot} />}
                  {s.mark?.tag && <Text as="span" fontWeight="medium" color={s.mark.tagColor} flexShrink={0}>{s.mark.tag}</Text>}
                  <Text as="span" truncate flexShrink={s.hint ? 0 : 1} minW="0" maxW={s.hint ? "60%" : "full"} color="fg">{s.label}</Text>
                  {s.hint && <Text as="span" truncate minW="0" color="fg.muted" flex="1" textAlign="end">{s.hint}</Text>}
                </chakra.div>
              ))}
            </Box>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
