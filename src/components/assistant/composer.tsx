// The input: one calm card. The text with @references as chips right where they were typed (the editor and the
// mention popover are src/components/token-input; here only @issue/@rule/@page/@crawl, since this is prose).
// Underneath, where the user is (sent with every message) on the left and Send / Stop on the right. A message is
// sent as the text with the chips as their @tokens.
import { useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { LuArrowUp, LuSquare } from "react-icons/lu";

import { TokenEditor, type TokenEditorHandle } from "@/components/token-input";
import { DEFAULT_SITE } from "@/lib/sites";
import { contextLabel, siteIn } from "./route";

export function Composer({ where, busy, onSend, onStop }: { where: string; busy: boolean; onSend: (q: string) => void; onStop: () => void }) {
  const editor = useRef<TokenEditorHandle>(null);
  const { pathname } = useLocation();
  const ctx = useMemo(() => ({ site: siteIn(pathname) || DEFAULT_SITE, url: where }), [pathname, where]);
  const [empty, setEmpty] = useState(true);
  const label = contextLabel(where);
  const ready = !empty && !busy;
  const submit = () => {
    const text = editor.current?.getText() ?? "";
    if (!busy && text.trim()) { onSend(text); editor.current?.clear(); }
  };

  return (
    <Box p="3" pt="1" flexShrink={0}>
      <Flex direction="column" borderWidth="1px" rounded="l3" bg="bg.subtle" p="2.5" gap="2"
        transition="border-color 0.15s"
        _focusWithin={{ borderColor: "border.emphasized" }}
        onClick={(e) => { if (!(e.target as Element).closest(".tiptap, button")) editor.current?.focus(); }}>
        <TokenEditor
          ref={editor} mode="chat" ctx={ctx} autoFocus mentionUi="popover" listId="composer-mention"
          placeholder="Ask anything, or type @ to mention an issue, rule, page or crawl" ariaLabel="Message to Ask AI"
          onChange={(v) => setEmpty(v.text.trim() === "")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } }}
        />
        <Flex align="center" gap="3" minH="7">
          <Text textStyle="xs" color="fg.subtle" truncate flex="1" minW="0" title={where}>{label}</Text>
          {busy ? (
            <IconButton type="button" size="2xs" rounded="l2" w="7" h="7" minW="7" bg="fg" color="bg" _hover={{ bg: "fg.muted" }} aria-label="Stop" onClick={onStop}><LuSquare fill="currentColor" size={12} /></IconButton>
          ) : (
            <IconButton type="button" size="2xs" rounded="l2" w="7" h="7" minW="7" aria-label="Send" disabled={!ready} onClick={submit}
              bg={ready ? "fg" : "bg.emphasized"} color={ready ? "bg" : "fg.subtle"} _hover={{ bg: ready ? "fg.muted" : "bg.emphasized" }} _disabled={{ opacity: 1, cursor: "default" }}><LuArrowUp size={14} /></IconButton>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}
