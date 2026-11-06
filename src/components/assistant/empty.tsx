// The empty conversation: a line about what to ask, prompts that fit the screen, and what the model is told.
import { useEffect, useState } from "react";
import { Box, Button, Code, Stack, Text } from "@chakra-ui/react";

import { fetchSystemPrompt } from "@/lib/ai";
import { SYSTEM_PROMPT } from "@/lib/refs";
import { Folded } from "./common";
import { suggestionsFor } from "./route";

export function EmptyState({ where, onSend }: { where: string; onSend: (q: string) => void }) {
  return (
    <Stack gap="4">
      <Text textStyle="sm" color="fg.muted">Ask about the issues, pages and crawls of this site, or ask me to take you somewhere.</Text>
      <Stack gap="1">
        {suggestionsFor(where).map((q) => (
          <Button key={q} variant="ghost" size="sm" justifyContent="flex-start" h="auto" py="2" px="3" whiteSpace="normal" textAlign="start" fontWeight="normal" color="fg"
            borderWidth="1px" borderColor="transparent" _hover={{ borderColor: "border", bg: "bg.subtle" }} onClick={() => onSend(q)}>
            {q}
          </Button>
        ))}
      </Stack>
      <Folded label="What the AI is told before every conversation"><SystemPrompt /></Folded>
    </Stack>
  );
}

// The backend's prompt, or the local copy when there's no backend
function SystemPrompt() {
  const [prompt, setPrompt] = useState(SYSTEM_PROMPT);
  useEffect(() => { fetchSystemPrompt().then(setPrompt); }, []);
  return <Box borderWidth="1px" rounded="l3" bg="bg.subtle"><Code display="block" bg="transparent" whiteSpace="pre-wrap" textStyle="xs" p="3">{prompt}</Code></Box>;
}
