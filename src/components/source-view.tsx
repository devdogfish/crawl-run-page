import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Box, Button, Flex, HStack, IconButton, Popover, Portal, Text, type SystemStyleObject, usePopoverContext } from "@chakra-ui/react";
import { LuCheck, LuChevronLeft, LuChevronRight, LuCopy, LuWrapText } from "react-icons/lu";
import { RULE_CATALOG, SEVERITIES, sourceLines, type Instance } from "@/lib/page-issues";
import { useCopy } from "./assistant/common";
import { Tooltip } from "./ui/tooltip";

const scrollbarCss = {
  "&::-webkit-scrollbar": { width: "10px", height: "10px" },
  "&::-webkit-scrollbar-track, &::-webkit-scrollbar-corner": { bg: "bg.subtle" },
  "&::-webkit-scrollbar-thumb": { bg: "fg.subtle", border: "3px solid", borderColor: "bg.subtle", borderRadius: "full" },
  "&::-webkit-scrollbar-thumb:hover": { bg: "fg.muted" },
  "@supports (-moz-appearance: none)": { scrollbarWidth: "thin", scrollbarColor: "var(--chakra-colors-fg-subtle) var(--chakra-colors-bg-subtle)" },
} satisfies SystemStyleObject;

// Tokenize only for display. React escapes every token; source is never injected as HTML.
function Highlight({ line }: { line: string }) {
  return line.split(/(<!--[\s\S]*?-->|<![^>]*>|<\/?[\w:-]+(?:[^>"']|"[^"]*"|'[^']*')*>)/g).map((part, index) => {
    if (!part.startsWith("<")) return part;
    if (part.startsWith("<!")) return <Box as="span" key={index} color="fg.subtle">{part}</Box>;
    return <Box as="span" key={index}>{part.split(/("[^"]*"|'[^']*'|<\/?[\w:-]+|[\w:-]+(?=\s*=)|\/?>)/g).map((token, n) =>
      <Box as="span" key={n} color={/^["']/.test(token) ? "green.fg" : /^<\/?\w/.test(token) ? "purple.fg" : /^[\w:-]+$/.test(token) ? "blue.fg" : "fg.muted"}>{token}</Box>
    )}</Box>;
  });
}

export function SourceView({ html, instances, selected, onSelect, card, active = true }: { html: string; instances: Instance[]; selected: number | null; onSelect: (k: number) => void; card?: ReactNode; active?: boolean }) {
  const { lines, lineOf } = useMemo(() => sourceLines(html), [html]);
  const [open, setOpen] = useState(false);
  const select = (k: number) => { onSelect(k); setOpen(true); };
  const [wrap, setWrap] = useState(true);
  const [copied, copy] = useCopy(html.replace(/ data-ix="\d+"/g, ""));
  const marks = new Map<number, Instance[]>();
  for (const it of instances) { const line = lineOf.get(it.k); if (line != null) marks.set(line, [...(marks.get(line) ?? []), it]); }
  const ordered = instances.filter(it => lineOf.has(it.k)).sort((a, b) => lineOf.get(a.k)! - lineOf.get(b.k)!);
  const index = ordered.findIndex(it => it.k === selected);
  const selLine = selected != null ? lineOf.get(selected) : undefined;
  const row = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const horizontal = useRef<HTMLDivElement>(null);
  const codeContent = useRef<HTMLDivElement>(null);
  const [sourceWidth, setSourceWidth] = useState(0);
  useEffect(() => {
    const container = scroll.current;
    const content = codeContent.current;
    if (!container || !content) return;
    if (wrap) container.scrollLeft = 0;
    const measure = () => setSourceWidth(container.scrollWidth + (horizontal.current?.clientWidth ?? container.clientWidth) - container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [wrap, html]);
  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const reveal = () => {
      const target = row.current;
      if (!target || !container.clientHeight) return;
      if (target.offsetTop < container.scrollTop || target.offsetTop + target.offsetHeight > container.scrollTop + container.clientHeight) {
        container.scrollTo({ top: Math.max(0, target.offsetTop - container.clientHeight / 3), behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selLine, wrap]);
  return <Popover.Root open={open && active && !!card} onOpenChange={(event) => setOpen(event.open)} autoFocus={false} onInteractOutside={(event) => {
      const target = event.detail.originalEvent.target;
      if (target instanceof Element && target.closest("[data-source-select]")) event.preventDefault();
    }} positioning={{ placement: "bottom-start", gutter: 6, strategy: "fixed", hideWhenDetached: true, fitViewport: true, overflowPadding: 12, getAnchorElement: () => sourceCardAnchor(row, scroll), listeners: { animationFrame: true } }}>
    <SourceCardAnchor anchor={row} viewport={scroll} selected={selected} open={open && active} wrap={wrap} />
    <Box borderWidth="1px" rounded="l2" overflow="hidden" minW="0" colorPalette="gray">
    <HStack px="3" py="2" gap="2" wrap="wrap" bg="bg.subtle" borderBottomWidth="1px">
      <Text textStyle="xs" fontWeight="medium">HTML</Text>
      <Text textStyle="xs" color="fg.muted">{lines.length} lines</Text>
      <HStack ms="auto" gap="1" flexWrap="wrap">
        {ordered.length > 0 && <HStack gap="0" color="fg.muted">
          <IconButton size="2xs" variant="ghost" data-source-select aria-label="Previous source issue" disabled={index <= 0} onClick={() => select(ordered[index - 1].k)}><LuChevronLeft /></IconButton>
          <Text textStyle="xs" fontVariantNumeric="tabular-nums">{index + 1} / {ordered.length}</Text>
          <IconButton size="2xs" variant="ghost" data-source-select aria-label="Next source issue" disabled={index >= ordered.length - 1} onClick={() => select(ordered[index + 1].k)}><LuChevronRight /></IconButton>
        </HStack>}
        <Button size="2xs" variant={wrap ? "subtle" : "ghost"} aria-pressed={wrap} onClick={() => setWrap(!wrap)}><LuWrapText />Wrap</Button>
        <Button size="2xs" variant="ghost" onClick={copy} aria-label={copied ? "Source copied" : "Copy source"}>{copied ? <LuCheck /> : <LuCopy />}{copied ? "Copied" : "Copy"}</Button>
      </HStack>
    </HStack>
    <Box position="relative">
    <Box pointerEvents="none" position="absolute" top="0" bottom="0" left="calc(4rem + 1px)" borderRightWidth="1px" borderRightColor="border" zIndex="2" />
    <Box ref={scroll} overflowX="hidden" overflowY="auto" maxH="min(720px, 65dvh)" overscrollBehavior="contain" position="relative" aria-label="Page HTML source" tabIndex={0}
      onScroll={(event) => { if (horizontal.current) horizontal.current.scrollLeft = event.currentTarget.scrollLeft; }}
      onWheel={(event) => { if (!wrap && horizontal.current && (event.deltaX || event.shiftKey)) { horizontal.current.scrollLeft += event.deltaX || event.deltaY; } }}
      css={scrollbarCss}>
      <Box ref={codeContent} pb={wrap ? "0" : "14px"} minW={wrap ? "0" : "max-content"} position="relative" fontFamily="mono" textStyle="xs" lineHeight="1.8">
        {lines.map((line, n) => {
          const issues = marks.get(n) ?? [];
          const active = n === selLine;
          const issue = issues.find(it => it.k === selected) ?? issues[0];
          const color = issue ? SEVERITIES.find(sev => sev.id === RULE_CATALOG[issue.rule].severity)!.color : "gray";
          const element = <Flex key={n} ref={active ? row : undefined} bg={active ? `${color}.subtle` : undefined}>
            <HStack gap="1" w="calc(4rem + 2px)" minW="calc(4rem + 2px)" borderLeftWidth="2px" borderLeftColor={active ? `${color}.solid` : "transparent"} pe="2" align="start" position="sticky" left="0" zIndex="1" borderRightWidth="1px" borderRightColor="border" bg={active ? `${color}.subtle` : "bg"} userSelect="none">
              <Text w="8" textAlign="right" color={active ? "fg" : "fg.subtle"}>{n + 1}</Text>
              <HStack gap="0.5" pt="1.5" flexWrap="wrap">
                {issues.map(it => <Tooltip key={it.k} content={RULE_CATALOG[it.rule].title}>
                  <Box as="button" boxSize="2" rounded="full" bg={`${SEVERITIES.find(sev => sev.id === RULE_CATALOG[it.rule].severity)!.color}.solid`}
                    cursor="pointer" transition="transform 0.12s, box-shadow 0.12s"
                    _hover={{ transform: "scale(1.3)", boxShadow: "0 0 0 3px var(--chakra-colors-bg-emphasized)" }}
                    _active={{ transform: "scale(1.1)" }}
                    _focusVisible={{ outline: "2px solid", outlineColor: "fg.muted", outlineOffset: "3px" }}
                    _motionReduce={{ transition: "none" }} data-source-select aria-label={`Line ${n + 1}: ${RULE_CATALOG[it.rule].title}`} onClick={() => select(it.k)} />
                </Tooltip>)}
              </HStack>
            </HStack>
            <Box as="code" minW="0" flex="1" ps="3" whiteSpace={wrap ? "pre-wrap" : "pre"} overflowWrap={wrap ? "anywhere" : undefined} pe="4"><Highlight line={line} /></Box>
          </Flex>;
          return element;
        })}
      </Box>
    </Box>
    {!wrap && <Box ref={horizontal} aria-label="Scroll source horizontally" tabIndex={0} position="absolute" bottom="0" left="calc(4rem + 2px)" right="10px" zIndex="3" minW="0" h="14px" overflowX="auto" overflowY="hidden" bg="bg.subtle" css={scrollbarCss}
        onScroll={(event) => { if (scroll.current) scroll.current.scrollLeft = event.currentTarget.scrollLeft; }}>
        <Box w={`${sourceWidth}px`} h="1px" />
      </Box>}
    </Box>
  </Box>
    <Portal><Popover.Positioner><Popover.Content p="0" borderWidth="0" rounded="0" bg="transparent" shadow="none" w="auto" maxW="calc(100vw - 24px)" overflow="visible" aria-label="Source issue details">{card}</Popover.Content></Popover.Positioner></Portal>
  </Popover.Root>;
}

// Rebind after React commits the newly selected row. Changing Anchor wrappers could
// unregister the old anchor after the new one mounted, briefly positioning at (0, 0).
function SourceCardAnchor({ anchor, viewport, selected, open, wrap }: { anchor: RefObject<HTMLDivElement | null>; viewport: RefObject<HTMLDivElement | null>; selected: number | null; open: boolean; wrap: boolean }) {
  const { reposition } = usePopoverContext();
  useEffect(() => {
    if (open && anchor.current) reposition({ getAnchorElement: () => sourceCardAnchor(anchor, viewport), listeners: { animationFrame: true } });
  }, [anchor, viewport, selected, open, wrap, reposition]);
  return null;
}

function sourceCardAnchor(row: RefObject<HTMLDivElement | null>, viewport: RefObject<HTMLDivElement | null>) {
  if (!row.current || !viewport.current) return null;
  return {
    contextElement: row.current,
    getBoundingClientRect: () => {
      const line = row.current!.getBoundingClientRect();
      const panel = viewport.current!.getBoundingClientRect();
      const gutter = row.current!.firstElementChild?.getBoundingClientRect().width ?? 66;
      let left = panel.left + gutter;
      const code = row.current!.querySelector("code");
      if (code) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const start = node.textContent?.search(/\S/) ?? -1;
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + 1);
          left = Math.max(left, range.getBoundingClientRect().left);
          break;
        }
      }
      return new DOMRect(left, line.top, Math.max(0, panel.left + viewport.current!.clientWidth - left), line.height);
    },
  };
}
