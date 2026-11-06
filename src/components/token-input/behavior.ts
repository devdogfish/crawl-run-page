// Only app-specific editing: plain-text paste, exact-id space completion and Enter forwarding.
import { Extension } from "@tiptap/core";
import { splitBlock } from "@tiptap/pm/commands";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { TokenMode } from "@/lib/nav/chips";
import type { SearchContext } from "@/lib/nav/search";
import { parseSegs, resolveMention, type RefKind } from "@/lib/nav/segments";
import type { Suggestion } from "@/lib/nav/suggest";
import { linesToParagraphs, segToNode } from "./doc";

export function lastWord(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || ($from.nodeAfter?.isText && !/^\s/.test($from.nodeAfter.text!))) return "";
  return /\S*$/.exec($from.parent.textBetween(0, $from.parentOffset, "", " "))?.[0] ?? "";
}

export function acceptFacet(view: EditorView, s: Suggestion) {
  const { state } = view;
  view.dispatch(state.tr.insertText(`${s.text} `, state.selection.from - lastWord(state).length, state.selection.to));
}

export const TokenBehavior = Extension.create<{
  mode: TokenMode; ctx: () => SearchContext; forward: (e: KeyboardEvent) => void; complete: (view: EditorView) => boolean;
}>({
  name: "tokenBehavior",
  // Mention/Suggestion must get keys before the parent (especially Enter and Escape).
  priority: 150,
  addProseMirrorPlugins() {
    const c = this.options;
    return [new Plugin({ props: {
      handleTextInput(view, from, to, text) {
        if (view.composing || text !== " ") return false;
        const word = lastWord(view.state), m = /^@(issue|rule|page|crawl):(.+)$/.exec(word);
        const seg = m && resolveMention(m[1] as RefKind, m[2], c.ctx());
        if (!seg) return false;
        const start = from - word.length;
        const tr = closeHistory(view.state.tr).replaceWith(start, to, segToNode(view.state.schema, seg)!);
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)));
        return true;
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        const paras = linesToParagraphs(view.state.schema, parseSegs(text, c.ctx(), c.mode));
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(paras), 1, 1)).setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
        return true;
      },
      handleKeyDown(view, e) {
        if (e.isComposing || e.keyCode === 229) return false;
        if (e.key === "Tab" && !e.shiftKey && c.complete(view)) return true;
        if (e.key === "Enter") {
          if (e.shiftKey) { if (c.mode === "chat") splitBlock(view.state, view.dispatch); }
          else c.forward(e);
          e.preventDefault();
          return true;
        }
        c.forward(e);
        return e.defaultPrevented;
      },
    } })];
  },
});
