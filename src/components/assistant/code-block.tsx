import { Box, HStack, Text } from "@chakra-ui/react";

import { CopyIconButton } from "./common";

// A fenced code block: language label, Copy on hover, scrolls sideways instead of wrapping
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const text = code.replace(/\n$/, "");
  return (
    <Box className="group" position="relative" borderWidth="1px" rounded="l3" bg="bg.subtle" overflow="hidden">
      <HStack justify="space-between" px="3" pt="1.5" minH="6">
        <Text textStyle="xs" color="fg.muted">{lang || ""}</Text>
        <CopyIconButton text={text} label="Copy code" opacity="0" transition="opacity 0.15s" _groupHover={{ opacity: 1 }} _focusVisible={{ opacity: 1 }} css={{ "@media (hover: none)": { opacity: 1 } }} />
      </HStack>
      <Box as="pre" overflowX="auto" px="3" pb="3" pt="1" m="0" fontFamily="mono" textStyle="xs" lineHeight="1.6" whiteSpace="pre" tabIndex={0}>{text}</Box>
    </Box>
  );
}
