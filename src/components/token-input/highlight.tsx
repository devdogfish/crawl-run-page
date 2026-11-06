// A text with the parts the query matched marked: a neutral background and semibold, no colour.
import { Box } from "@chakra-ui/react";

import { highlight } from "@/lib/nav/highlight";

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  return (
    <>
      {highlight(text, terms).map((s, k) =>
        s.hit ? <Box key={k} as="mark" bg="bg.emphasized" color="inherit" rounded="l1" fontWeight="semibold">{s.text}</Box> : s.text,
      )}
    </>
  );
}
