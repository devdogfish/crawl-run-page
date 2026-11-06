// Official Mention atoms + one Suggestion plugin; React only presents its list.
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Box, VisuallyHidden } from "@chakra-ui/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import type { TokenMode } from "@/lib/nav/chips";
import type { SearchContext } from "@/lib/nav/search";
import { parseSegs, type RefKind } from "@/lib/nav/segments";
import { suggestFor, type Suggestion } from "@/lib/nav/suggest";
import { acceptFacet, lastWord, TokenBehavior } from "./behavior";
import { isEmptyDoc, linesToParagraphs } from "./doc";
import { MentionPopover } from "./mention-popover";
import { TokenMention } from "./nodes";

export type TokenEditorHandle = {
  focus(): void; clear(): void; setContent(text: string): void; getText(): string;
  accept(s: Suggestion): void; handleKeyDown(e: KeyboardEvent): boolean; dom(): HTMLElement | null;
};
export type SuggestView = { mention: { kind: RefKind | null; text: string } | null; items: Suggestion[]; hi: number; key: string };
type Props = {
  mode: TokenMode; ctx: SearchContext; placeholder: string; ariaLabel: string; autoFocus?: boolean;
  mentionUi?: "popover" | "external"; listId?: string; resultsId?: string; resultsActiveId?: string;
  onChange?: (v: { text: string; empty: boolean }) => void; onKeyDown?: (e: KeyboardEvent) => void;
  onSuggest?: (v: SuggestView | null) => void; ref?: React.Ref<TokenEditorHandle>;
};
type MentionProps = SuggestionProps<Suggestion, Suggestion>;
function queryInput(query: string) {
  const m = /^(issue|rule|page|crawl):(.*)$/i.exec(query);
  return m ? { kind: m[1].toLowerCase() as RefKind, text: m[2] } : { kind: null, text: query };
}

export function TokenEditor({ mode, ctx, placeholder, ariaLabel, autoFocus, mentionUi = "popover", listId = "token-suggest", resultsId, resultsActiveId, onChange, onKeyDown, onSuggest, ref }: Props) {
  const [mention, setMention] = useState<MentionProps | null>(null);
  const [hi, setHi] = useState(0);
  const [word, setWord] = useState("");
  const live = useRef({ ctx, onChange, onKeyDown });
  useEffect(() => { live.current = { ctx, onChange, onKeyDown }; });
  const extensions = useMemo(() => {
    // A renderer-local selection index belongs to this Suggestion instance, never to editor transactions.
    let current: MentionProps | null = null, index = 0;
    const update = (props: MentionProps) => {
      if (current?.query !== props.query) { index = 0; setHi(0); }
      current = props;
      setMention(props);
    };
    return [
      Document.extend({ content: mode === "search" ? "paragraph" : "paragraph+" }), Paragraph, Text, UndoRedo,
      Placeholder.configure({ placeholder }),
      TokenMention.configure({ suggestion: {
        char: "@", allowedPrefixes: [" ", "\n", "\t"], allowSpaces: false, startOfLine: false,
        decorationClass: "mention-query",
        items: ({ query }) => suggestFor(queryInput(query), live.current.ctx, mode),
        command: ({ editor, range, props: s }: { editor: MentionProps["editor"]; range: MentionProps["range"]; props: Suggestion }) => {
          editor.view.dispatch(closeHistory(editor.state.tr));
          editor.chain().focus().insertContentAt(range, s.kind === "stem" ? s.text : {
            type: "mention", attrs: { id: `${s.ref}:${s.value}`, label: s.label, mark: s.mark ?? null },
          }).run();
        },
        render: () => ({
          onStart: update, onUpdate: update,
          onExit: () => { current = null; setMention(null); },
          onKeyDown: ({ event: e }) => {
            if (e.isComposing || e.keyCode === 229) return false;
            if (e.key === "Escape") { e.stopPropagation(); return true; }
            if (!["ArrowDown", "ArrowUp", "Tab", "Enter"].includes(e.key)) return false;
            if (mentionUi === "external") live.current.onKeyDown?.(e);
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              const n = current?.items.length ?? 0;
              index = n ? (index + (e.key === "ArrowDown" ? 1 : -1) + n) % n : 0;
              setHi(index);
            } else if (current?.items[index]) current.command(current.items[index]);
            e.preventDefault();
            return true; // even an empty/loading list owns Enter
          },
        }),
      } }),
      TokenBehavior.configure({ mode, ctx: () => live.current.ctx, forward: (e) => live.current.onKeyDown?.(e), complete: (view) => {
        const s = mode === "search" && suggestFor({ word: lastWord(view.state) }, live.current.ctx, mode)[0];
        if (!s) return false;
        acceptFacet(view, s);
        return true;
      } }),
    ];
  }, [mode, placeholder, mentionUi]);
  const editor = useEditor({
    extensions, autofocus: autoFocus ? "end" : false,
    editorProps: { attributes: {
      role: "textbox", "aria-label": ariaLabel, "aria-multiline": String(mode === "chat"), "aria-autocomplete": "list",
      spellcheck: "false", autocomplete: "off", autocorrect: "off", autocapitalize: "off",
    } },
    onUpdate: ({ editor: e }) => live.current.onChange?.({ text: e.getText({ blockSeparator: "\n" }), empty: isEmptyDoc(e.state.doc) }),
    onTransaction: ({ editor: e }) => setWord(lastWord(e.state)),
  }, [extensions]);
  const accept = (s: Suggestion) => {
    if (mention) mention.command(s); else if (editor) acceptFacet(editor.view, s);
    editor?.view.focus();
  };
  useImperativeHandle(ref, () => ({
    focus: () => { editor?.commands.focus(); }, clear: () => { editor?.commands.clearContent(true); },
    setContent: (text) => {
      if (!editor) return;
      const paras = linesToParagraphs(editor.schema, parseSegs(text, live.current.ctx, mode));
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, paras);
      editor.view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)));
      editor.commands.focus();
    },
    handleKeyDown: (e) => editor?.view.someProp("handleKeyDown", (f) => f(editor.view, e)) ?? false,
    getText: () => editor?.getText({ blockSeparator: "\n" }) ?? "", accept, dom: () => editor?.view.dom ?? null,
  }));
  const items = useMemo(() => mention?.items ?? suggestFor({ word }, ctx, mode), [mention, word, ctx, mode]);
  const view = useMemo<SuggestView | null>(() => mention || items.length ? {
    mention: mention ? queryInput(mention.query) : null, items, hi,
    key: mention ? `${mention.range.from}|${mention.query}` : word,
  } : null, [mention, items, hi, word]);
  useEffect(() => { onSuggest?.(view); }, [onSuggest, view]);
  const own = (mentionUi === "popover" && !!mention) || (!mention && items.length > 0);
  useEffect(() => {
    const el = editor?.view.dom;
    if (!el) return;
    const controls = own ? listId : resultsId, active = own && items.length ? `${listId}-opt-${hi}` : resultsActiveId;
    if (controls) el.setAttribute("aria-controls", controls); else el.removeAttribute("aria-controls");
    if (active) el.setAttribute("aria-activedescendant", active); else el.removeAttribute("aria-activedescendant");
  }, [editor, own, listId, resultsId, resultsActiveId, hi, items.length]);
  return <Box css={editorCss(mode)} flex="1" minW="0" position="relative">
    <EditorContent editor={editor} />
    <VisuallyHidden role="status" aria-live="polite">{mention ? `${items.length} suggestions` : ""}</VisuallyHidden>
    {mentionUi === "popover" && <MentionPopover open={!!mention && !!editor?.isFocused} kind={view?.mention?.kind ?? null}
      items={items} hi={hi} listId={listId} anchor={mention?.clientRect ?? (() => null)} anchorKey={view?.key ?? ""} onPick={accept} onEscape={(e) => { editor?.view.someProp("handleKeyDown", (f) => f(editor.view, e)); }} />}
  </Box>;
}

function editorCss(mode: TokenMode) {
  const chat = mode === "chat";
  return {
    "& .tiptap": {
      outline: "none", whiteSpace: chat ? "pre-wrap" : "pre", wordBreak: "break-word", fontSize: "sm", lineHeight: "1.5", color: "fg",
      ...(chat ? { maxHeight: "calc(1.5em * 6)", overflowY: "auto", px: "0.5" }
        : { overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none", py: "1.5", minH: "9", display: "flex", alignItems: "center", "& > p": { flex: "1" } }),
    },
    "& .tiptap p": { margin: 0, minH: "1.5em" },
    "& .tiptap p.is-editor-empty:first-of-type::before": { content: "attr(data-placeholder)", color: "fg.subtle", float: "left", height: 0, pointerEvents: "none" },
    "& .tq-host": { display: "inline", verticalAlign: "baseline" },
    "& .tq-atom": { display: "inline-block", mx: "0.5", verticalAlign: "middle", cursor: "default" },
    "& .ProseMirror-selectednode .tq-chip": { boxShadow: "0 0 0 1.5px {colors.fg.muted}" },
    "& .mention-query": { bg: "bg.emphasized", rounded: "l1", py: "0.5" },
  };
}
