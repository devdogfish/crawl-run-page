"use client";

// Log viewer for long logs (tens of thousands of lines).
// - Virtualised with react-virtuoso: only the visible lines are in the DOM.
// - Follows new output while you're at the bottom; scroll up to pause, "Jump to latest" to resume.
// - Click a line number to select it, shift-click to extend; copy the selection or download everything.
// In production, search/level filtering and "load older" would be query params on the logs endpoint.
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Flex, Highlight, Text } from "@chakra-ui/react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { LuArrowDown } from "react-icons/lu";

import { DataToolbar, downloadText } from "@/components/data-toolbar";
import { fmtClock, type LogLine } from "@/lib/types";

type Row = LogLine & { n: number };
// Severity is colour only (no level column): errors red, warnings yellow, lifecycle events muted.
const LEVEL_COLOR: Record<LogLine["level"], string> = { info: "gray.300", cmd: "white", event: "gray.500", warn: "orange.300", error: "red.300" };

export function LogViewer({ lines, running, fileName, h = "560px" }: { lines: LogLine[]; running: boolean; fileName: string; h?: string }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"all" | "problems">("all");
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [seenAt, setSeenAt] = useState(0);
  const ref = useRef<VirtuosoHandle>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const all = lines.map((l, i) => ({ ...l, n: i + 1 }));
    return all.filter((l) => (level === "all" || l.level === "warn" || l.level === "error") && (!q || l.msg.toLowerCase().includes(q)));
  }, [lines, query, level]);

  // Remember how many lines there were when the user scrolled away from the bottom
  useEffect(() => { if (atBottom) setSeenAt(rows.length); }, [atBottom, rows.length]);
  const unseen = Math.max(0, rows.length - seenAt);

  const selected = sel ? lines.slice(Math.min(sel.a, sel.b) - 1, Math.max(sel.a, sel.b)) : [];
  const asText = (ls: LogLine[]) => ls.map((l) => `${fmtClock(l.t)}  ${l.msg}`).join("\n");

  const copy = () => navigator.clipboard.writeText(asText(selected.length ? selected : rows));
  const pick = (n: number, shift: boolean) =>
    setSel((s) => (shift && s ? { a: s.a, b: n } : s && s.a === n && s.b === n ? null : { a: n, b: n }));
  // Gutter fits the largest line number (5+ digits once every request is logged)
  const gutter = `calc(${String(lines.length).length}ch + 0.75rem)`;
  const isSel = (n: number) => !!sel && n >= Math.min(sel.a, sel.b) && n <= Math.max(sel.a, sel.b);

  return (
    <Flex direction="column" borderWidth="1px" rounded="l2" overflow="hidden" h={h}>
      <DataToolbar
        query={query} onQuery={setQuery} placeholder="Search log"
        segments={[{ value: "all", label: "All" }, { value: "problems", label: "Warnings & errors" }]}
        value={level} onValue={setLevel}
        count={`${sel ? `${selected.length} selected · ` : ""}${rows.length.toLocaleString("en-US")}${rows.length !== lines.length ? ` of ${lines.length.toLocaleString("en-US")}` : ""} lines`}
        copyLabel={sel ? "Copy selected lines" : "Copy visible lines"} onCopy={copy}
        downloadLabel="Download full log (.txt)" onDownload={() => downloadText(asText(lines), fileName)}
      />

      {/* Lines */}
      <Box position="relative" flex="1" minH="0" bg="gray.950" color="gray.300" fontFamily="mono" fontSize="12px" lineHeight="20px">
        {rows.length === 0 ? (
          <Text p="3" color="gray.500">{lines.length ? "No lines match." : "Waiting for output…"}</Text>
        ) : (
          <Virtuoso
            ref={ref}
            style={{ position: "absolute", inset: 0 }}
            data={rows}
            initialTopMostItemIndex={rows.length - 1}
            followOutput={(bottom) => (bottom ? "auto" : false)}
            atBottomThreshold={40}
            atBottomStateChange={setAtBottom}
            increaseViewportBy={200}
            itemContent={(_, l) => (
              <Flex
                px="2"
                bg={isSel(l.n) ? "blue.900/60" : l.level === "error" ? "red.950/40" : undefined}
                _hover={{ bg: isSel(l.n) ? "blue.900/60" : "whiteAlpha.50" }}
                color={LEVEL_COLOR[l.level]}
                fontWeight={l.level === "cmd" ? "semibold" : undefined}
              >
                <Box
                  as="button"
                  w={gutter} flexShrink={0} textAlign="right" pe="3" whiteSpace="nowrap" color={isSel(l.n) ? "blue.300" : "gray.600"} userSelect="none"
                  cursor="pointer" _hover={{ color: "gray.300" }}
                  onClick={(e: React.MouseEvent) => pick(l.n, e.shiftKey)}
                  aria-label={`Select line ${l.n}`}
                >
                  {l.n}
                </Box>
                <Box as="span" color="gray.500" flexShrink={0} pe="3" userSelect="none">{fmtClock(l.t)}</Box>
                <Box as="span" whiteSpace="pre-wrap" wordBreak="break-word" minW="0">
                  {query ? <Highlight query={query} ignoreCase styles={{ bg: "yellow.500/40", color: "inherit" }}>{l.msg}</Highlight> : l.msg}
                </Box>
              </Flex>
            )}
          />
        )}
        {!atBottom && (
          <Button
            size="xs" position="absolute" bottom="3" left="50%" transform="translateX(-50%)" rounded="full" shadow="md"
            onClick={() => ref.current?.scrollToIndex({ index: rows.length - 1, behavior: "auto" })}
          >
            <LuArrowDown />{running && unseen > 0 ? `${unseen.toLocaleString("en-US")} new lines` : "Jump to latest"}
          </Button>
        )}
      </Box>
    </Flex>
  );
}
