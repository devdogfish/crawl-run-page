import { NavAction } from "@/components/nav-action";
// Cmd+K search: a palette over the whole app. Type or paste anything (a page URL, an issue id, "p1 accessibility",
// "crawl 806", a rule name) and Enter goes there. Results come from src/lib/nav/search.ts instantly. When Enter is
// pressed on a query the matcher isn't sure about (nothing matched well, or a sentence wasn't matched almost exactly),
// the AI is asked for the one right destination (src/lib/nav/ai.ts) and the palette goes there and closes by itself:
// no suggestion to confirm. If the AI has nothing, the best instant match is used.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Box, Button, Dialog, Flex, HStack, Icon, IconButton, Kbd, Portal, Progress, Spinner, Text, VisuallyHidden } from "@chakra-ui/react";
import { LuCircleAlert, LuFileText, LuGlobe, LuHistory, LuLayoutDashboard, LuList, LuListChecks, LuSearch, LuSlidersHorizontal, LuX } from "react-icons/lu";

import { Dot } from "@/components/assistant/chips";
import { Highlight, SuggestStrip, TokenEditor, type SuggestView, type TokenEditorHandle } from "@/components/token-input";
import { aiNavigate } from "@/lib/nav/ai";
import { highlightTerms } from "@/lib/nav/highlight";
import { isWeak, preload, UNSURE, saveRecent, search, type Kind, type Result } from "@/lib/nav/search";
import type { Suggestion } from "@/lib/nav/suggest";
import { DEFAULT_SITE, SITES, SITE_IDS, type SiteId } from "@/lib/sites";

type Palette = { open: boolean; setOpen: (v: boolean) => void };
const Ctx = createContext<Palette>({ open: false, setOpen: () => {} });
export const usePalette = () => useContext(Ctx);

// A keyboard key: outlined and quiet, never the accent colour
export const Key = (p: React.ComponentProps<typeof Kbd>) => (
  <Kbd variant="outline" colorPalette="gray" size="sm" bg="transparent" color="fg.muted" borderColor="border" shadow="none" fontFamily="body" fontWeight="normal" {...p} />
);

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Ctx.Provider value={{ open, setOpen }}>
      {children}
      <CommandPalette open={open} setOpen={setOpen} />
    </Ctx.Provider>
  );
}

// The button in the navbar: icon + "Search…" + shortcut hint (icon only on a phone)
export function SearchButton({ full = false }: { full?: boolean }) {
  const { setOpen } = usePalette();
  return (
    <NavAction onClick={() => setOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K Meta+K"
      w={full ? "full" : undefined} justifyContent={full ? "flex-start" : undefined} >
      <LuSearch />
      <Text as="span" display={{ base: full ? "inline" : "none", md: "inline" }}>Search…</Text>
      <Key display={{ base: full ? "inline-flex" : "none", md: "inline-flex" }} ms={full ? "auto" : "2"}>{isMac() ? "⌘K" : "Ctrl K"}</Key>
    </NavAction>
  );
}

const KIND_ICON: Record<Kind, React.ElementType> = {
  page: LuFileText, issue: LuCircleAlert, rule: LuListChecks, crawl: LuList, section: LuLayoutDashboard, site: LuGlobe, filter: LuSlidersHorizontal, recent: LuHistory,
};
// Results are grouped by what they are; groups keep the order of their best match
const GROUP: Record<Kind, string> = { page: "Pages", issue: "Issues", rule: "Rules", crawl: "Crawls", section: "Go to", site: "Go to", filter: "Views", recent: "Recent" };
// A row is a result, or (while the caret is in a mention chip) one of that chip's entities: sg is then what picking it does
type Row = Result & { ai?: boolean; sg?: Suggestion };
const sgRow = (s: Suggestion): Row => ({ url: "", title: s.label, subtitle: s.hint, kind: s.ref ?? "section", score: 1, chips: [], mark: s.mark, sg: s });
const TYPE_LABEL: Partial<Record<Kind, string>> = { page: "Page", issue: "Issue", rule: "Rule", crawl: "Crawl", section: "Section", site: "Site", filter: "View" };

// Examples under an empty input: a click fills them in, their resolved @tokens turning into chips
const TRY = ["new P1 accessibility issues", "@rule:image-alt", "crawl 812"];

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const first = loc.pathname.split("/")[1];
  const site = (SITE_IDS as string[]).includes(first) ? first : (() => { try { return localStorage.getItem("crawler.site") ?? DEFAULT_SITE; } catch { return DEFAULT_SITE; } })();
  const where = loc.pathname + loc.search;

  const ctx = useMemo(() => ({ site, url: where }), [site, where]);
  const ed = useRef<TokenEditorHandle>(null);
  const [query, setQuery] = useState(""); // the text with the chips as their tokens: what the matcher sees
  const [typed, setTyped] = useState(false);
  const [sg, setSg] = useState<SuggestView | null>(null); // what the editor suggests: a mention chip's entities, or filter pills
  const mention = sg?.mention ?? null;
  const [active, setActive] = useState(0);
  const [finding, setFinding] = useState(false); // waiting for the AI after Enter
  const aiCtl = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Result | null>());
  const listRef = useRef<HTMLDivElement>(null);
  const [slow, setSlow] = useState(false);

  const cancelFinding = () => { aiCtl.current?.abort(); aiCtl.current = null; setFinding(false); };
  useEffect(() => {
    if (open) { ed.current?.clear(); setActive(0); preload(site); }
    else { cancelFinding(); setQuery(""); setTyped(false); setSg(null); }
  }, [open, site]);

  const results = useMemo(() => (open ? search(query, ctx) : []), [open, query, ctx]);
  const q = query.trim();
  // Not sure: nothing matched well, or a sentence (3+ words) wasn't matched almost exactly
  const unsure = q.length >= 3 && (isWeak(results) || (q.split(/\s+/).length >= 3 && results[0].score < UNSURE));
  const terms = useMemo(() => (mention ? highlightTerms([mention.text]) : q ? highlightTerms([query]) : []), [mention, q, query]);

  useEffect(() => {
    if (!finding) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [finding]);

  const groups = useMemo(() => {
    const out: { name: string; rows: Row[] }[] = [];
    if (mention) return sg!.items.length ? [{ name: "", rows: sg!.items.map(sgRow) }] : out; // the chip's entities replace the results
    for (const r of results) {
      const name = q ? GROUP[r.kind] : r.kind === "recent" ? "Recent" : "Go to";
      const g = out.find((x) => x.name === name) ?? (out.push({ name, rows: [] }), out[out.length - 1]);
      g.rows.push(r);
    }
    return out;
  }, [results, q, mention, sg]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const idx = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => { setActive(0); cancelFinding(); }, [query, sg?.key]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" }); }, [idx, rows.length]);

  const go = (r: Row | undefined) => {
    if (!r) return;
    if (r.sg) { // an entity of the mention chip: a kind is chosen, anything else is opened
      if (r.sg.kind === "stem") { ed.current?.accept(r.sg); return; }
      const hit = search(r.sg.text, ctx)[0];
      if (hit) go(hit);
      return;
    }
    saveRecent(r);
    setOpen(false);
    navigate(r.url);
  };

  // Enter on the top row of an unsure query: let the AI decide, then go (falling back to the best instant match)
  const ask = async () => {
    const best = rows[0];
    const ctl = new AbortController();
    aiCtl.current = ctl;
    setFinding(true);
    let result: Result | null;
    if (cache.current.has(q)) result = cache.current.get(q) ?? null;
    else {
      const timeout = setTimeout(() => ctl.abort(), 16_000); // the server gives up first (AI_NAV_TIMEOUT)
      result = await aiNavigate(q, ctx, ctl.signal);
      clearTimeout(timeout);
      if (!ctl.signal.aborted || result) cache.current.set(q, result);
    }
    if (aiCtl.current !== ctl) return; // cancelled (the query changed or the palette closed)
    aiCtl.current = null;
    setFinding(false);
    go(result ?? best);
  };

  // The keys the editor didn't use (it forwards the arrows and Enter, and Tab inside a mention chip)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) { e.preventDefault(); setActive((idx + 1) % Math.max(rows.length, 1)); }
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) { e.preventDefault(); setActive((idx - 1 + rows.length) % Math.max(rows.length, 1)); }
    else if (e.key === "Tab" && mention) { // the highlighted entity becomes a chip in the input
      e.preventDefault();
      const sgr = rows[idx]?.sg;
      if (sgr) ed.current?.accept(sgr);
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (finding) return;
      if (mention) go(rows[idx]);
      else if (unsure && idx === 0) void ask(); else go(rows[idx]);
    }
  };
  // Esc clears what was typed first; a second Esc closes (Dialog's own Esc is off)
  const onDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
    e.preventDefault(); e.stopPropagation();
    if (typed) { ed.current?.clear(); ed.current?.focus(); } else setOpen(false);
  };
  const filterPills = !!sg && !mention && sg.items.length > 0 && !finding;
  const onRow = rows[idx]?.sg;

  let n = -1;
  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="top" size="lg" motionPreset="slide-in-top" preventScroll={false} closeOnEscape={false} onEscapeKeyDown={(e) => {
      // Chakra handles Escape in document capture, before ProseMirror's bubbling listener.
      if (!ed.current?.handleKeyDown(e)) {
        if (typed) { ed.current?.clear(); ed.current?.focus(); } else setOpen(false);
      }
      e.preventDefault(); e.stopPropagation();
    }} initialFocusEl={() => ed.current?.dom() ?? null} lazyMount unmountOnExit>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner pt={{ base: "4", md: "14vh" }} px={{ base: "3", md: "0" }}>
          <Dialog.Content p="0" overflow="hidden" maxW="2xl" rounded="l3" shadow="lg" onKeyDown={onDialogKeyDown}>
            <VisuallyHidden><Dialog.Title>Search</Dialog.Title></VisuallyHidden>
            <Flex align="center" gap="3" px="4" minH="12" py="1.5" borderBottomWidth="1px" position="relative" onClick={(e) => { if (!(e.target as Element).closest(".tiptap")) ed.current?.focus(); }}>
              {finding ? <Spinner size="sm" color="fg.muted" flexShrink={0} /> : <Icon as={LuSearch} boxSize="4" color="fg.muted" flexShrink={0} />}
              <TokenEditor
                ref={ed} mode="search" ctx={ctx} autoFocus mentionUi="external" listId="palette-suggest" resultsId="palette-list" resultsActiveId={rows.length ? `palette-opt-${idx}` : undefined}
                placeholder="Search pages, issues and crawls, or paste a URL" ariaLabel="Search"
                onChange={(v) => { setQuery(v.text); setTyped(!v.empty); }} onKeyDown={onKeyDown} onSuggest={setSg}
              />
              {typed && (
                <IconButton aria-label="Clear" size="2xs" variant="ghost" color="fg.muted" flexShrink={0} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); ed.current?.clear(); ed.current?.focus(); }}>
                  <LuX />
                </IconButton>
              )}
              <Text textStyle="xs" color="fg.muted" flexShrink={0} display={{ base: "none", md: "block" }}>{SITES[site as SiteId]?.short}</Text>
              {finding && (
                <Progress.Root value={null} size="xs" position="absolute" insetX="0" bottom="-1px" aria-hidden>
                  <Progress.Track rounded="0" bg="transparent"><Progress.Range /></Progress.Track>
                </Progress.Root>
              )}
            </Flex>

            {filterPills && <SuggestStrip suggestions={sg.items} active={sg.hi} listId="palette-suggest" onPick={(s) => ed.current?.accept(s)} borderBottomWidth="1px" />}
            {!typed && !finding && (
              <Flex wrap="wrap" align="center" gap="1.5" px="4" py="2" borderBottomWidth="1px">
                <Text textStyle="xs" color="fg.muted" me="0.5">Try</Text>
                {TRY.map((ex) => (
                  <Button
                    key={ex} type="button" variant="outline" size="xs" h="6" px="2" rounded="l2" fontWeight="normal" textStyle="xs" color="fg" bg="transparent" borderColor="border" maxW="full"
                    _hover={{ bg: "bg.muted" }} onMouseDown={(e) => e.preventDefault()} onClick={() => ed.current?.setContent(ex)}
                  >
                    <Text as="span" truncate>{ex}</Text>
                  </Button>
                ))}
              </Flex>
            )}

            <Box ref={listRef} id="palette-list" role="listbox" aria-label="Results" aria-busy={finding} opacity={finding ? 0.45 : 1} pointerEvents={finding ? "none" : undefined} maxH={{ base: "60vh", md: "52vh" }} overflowY="auto" p="1.5">
              {finding && (
                <HStack gap="3" px="2.5" h="10" color="fg.muted" role="status">
                  <Spinner size="xs" />
                  <Text textStyle="sm">{slow ? "Still looking, this one is taking a moment…" : "Finding the right view…"}</Text>
                </HStack>
              )}
              {groups.map((g) => (
                <Box key={g.name} role="group" aria-label={g.name}>
                  {g.name && <GroupLabel>{g.name}</GroupLabel>}
                  {g.rows.map((r) => {
                    const k = ++n, on = k === idx;
                    return (
                      <Flex
                        key={r.url + k} id={`palette-opt-${k}`} data-idx={k} role="option" aria-selected={on} align="center" gap="3" px="2.5" h="10" rounded="l2" cursor="pointer"
                        bg={on ? "bg.muted" : undefined} onMouseMove={() => k !== idx && setActive(k)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(r)}
                      >
                        {r.mark ? (
                          <HStack gap="1.5" flexShrink={0} minW="4" justify="center" aria-hidden>
                            <Dot color={r.mark.dot} />
                            {r.mark.tag && <Text textStyle="xs" fontWeight="medium" color={r.mark.tagColor}>{r.mark.tag}</Text>}
                          </HStack>
                        ) : <Icon as={KIND_ICON[r.kind]} boxSize="4" color={on ? "fg" : "fg.muted"} flexShrink={0} />}
                        <Text textStyle="sm" fontWeight="medium" truncate minW="0" flexShrink={r.chips.length ? 0 : 1} maxW={r.chips.length ? "50%" : "full"}><Highlight text={r.title} terms={terms} /></Text>
                        {r.chips.length > 0 ? (
                          <Text textStyle="xs" color="fg.muted" truncate minW="0">{r.chips.map((c) => c.label).join("  ·  ")}</Text>
                        ) : r.subtitle ? (
                          <Text textStyle="xs" color="fg.muted" truncate minW="0"><Highlight text={r.subtitle} terms={terms} /></Text>
                        ) : null}
                        <Box flex="1" />
                        {groups.length > 1 && TYPE_LABEL[r.kind] && <Text textStyle="xs" color="fg.subtle" flexShrink={0}>{TYPE_LABEL[r.kind]}</Text>}
                      </Flex>
                    );
                  })}
                </Box>
              ))}
              {mention && !rows.length && <Text textStyle="sm" color="fg.muted" px="2.5" h="10" display="flex" alignItems="center">No matches</Text>}
              {!mention && !rows.length && !finding && q && <Text textStyle="sm" color="fg.muted" px="3" py="8" textAlign="center">No results for “{q}”</Text>}
            </Box>

            <HStack px="4" h="9" borderTopWidth="1px" gap="4" textStyle="xs" color="fg.muted" bg="bg.subtle" display={{ base: "none", md: "flex" }}>
              <HStack gap="1.5"><Key>↑</Key><Key>↓</Key>Navigate</HStack>
              <HStack gap="1.5"><Key>↵</Key>{mention ? (onRow?.kind === "stem" ? "Choose" : "Open") : unsure && idx === 0 ? "Find the right view" : "Open"}</HStack>
              {mention ? <HStack gap="1.5"><Key>Tab</Key>{onRow?.kind === "stem" ? "Choose" : "Add as chip"}</HStack> : filterPills && <HStack gap="1.5"><Key>Tab</Key>Accept</HStack>}
              <HStack gap="1.5" ms="auto"><Key>esc</Key>{finding ? "Cancel" : typed ? "Clear" : "Close"}</HStack>
            </HStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <Text textStyle="xs" fontWeight="medium" color="fg.muted" px="2.5" pt="2" pb="1">{children}</Text>;
}
