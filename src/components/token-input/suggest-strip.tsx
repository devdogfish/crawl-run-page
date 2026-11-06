// The filter suggestions under the palette's input: small outlined pills, the highlighted one with a "Tab" hint. A
// click completes the word as plain text (the pills never take focus from the editor). Also the polite live region that says
// how many there are.
import { Box, Button, Flex, HStack, Text, VisuallyHidden } from "@chakra-ui/react";

import { Dot } from "@/components/assistant/chips";
import type { Suggestion } from "@/lib/nav/suggest";

const Tab = () => (
  <Box as="kbd" aria-hidden fontFamily="body" textStyle="2xs" color="fg.subtle" borderWidth="1px" borderColor="border" rounded="l1" px="1" lineHeight="1.25">Tab</Box>
);

export function SuggestStrip({ suggestions, active = 0, listId, onPick, px = "4", py = "2", ...rest }: {
  suggestions: Suggestion[]; active?: number; listId: string; onPick: (s: Suggestion) => void;
} & Omit<React.ComponentProps<typeof Flex>, "onPick">) {
  const n = suggestions.length;
  return (
    <>
      <VisuallyHidden role="status" aria-live="polite">{n ? `${n} suggestion${n === 1 ? "" : "s"}` : ""}</VisuallyHidden>
      {n > 0 && (
        <Flex wrap="wrap" gap="1.5" px={px} py={py} {...rest} role="listbox" id={listId} aria-label="Suggestions">
          {suggestions.map((s, k) => (
            <Button
              key={s.text} id={`${listId}-opt-${k}`} role="option" aria-selected={k === active} type="button" variant="outline" size="xs" h="6" px="2" rounded="l2" gap="1.5" fontWeight="normal" textStyle="xs" color="fg" bg={k === active ? "bg.muted" : "transparent"}
              borderColor="border" maxW="full" _hover={{ bg: "bg.muted" }} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(s)}
            >
              {s.mark && <Dot color={s.mark.dot} />}
              {s.mark?.tag && <Text as="span" fontWeight="medium" color={s.mark.tagColor}>{s.mark.tag}</Text>}
              <Text as="span" truncate maxW="260px">{s.label}</Text>
              {s.hint && <Text as="span" color="fg.muted" truncate maxW="160px">{s.hint}</Text>}
              {k === active && <HStack as="span" ms="0.5"><Tab /></HStack>}
            </Button>
          ))}
        </Flex>
      )}
    </>
  );
}
