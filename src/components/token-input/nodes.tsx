import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { Suggestion } from "@/lib/nav/suggest";
import { ChipPill } from "./chip-pill";

function MentionView({ node }: ReactNodeViewProps) {
  return <NodeViewWrapper as="span" className="tq-atom" role="img" aria-label={`${node.attrs.id}: ${node.attrs.label}`}>
    <ChipPill label={node.attrs.label} mark={node.attrs.mark} title={`@${node.attrs.id}`} maxLabel="220px" />
  </NodeViewWrapper>;
}

export const TokenMention = Mention.extend<MentionOptions<Suggestion, Suggestion>>({
  priority: 200,
  selectable: true,
  addAttributes() { return { ...this.parent?.(), mark: { default: null, rendered: false } }; },
  addNodeView() { return ReactNodeViewRenderer(MentionView, { as: "span", className: "tq-host" }); },
  addKeyboardShortcuts() {
    // PM's native shift-selection is a text range; explicitly select the adjacent atom for this UX.
    const select = (left: boolean) => {
      const { state, view } = this.editor, { selection } = state;
      const node = left ? selection.$from.nodeBefore : selection.$from.nodeAfter;
      if (!selection.empty || node?.type.name !== this.name) return false;
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, left ? selection.from - node.nodeSize : selection.from)));
      return true;
    };
    return { ...this.parent?.(), "Shift-ArrowLeft": () => select(true), "Shift-ArrowRight": () => select(false) };
  },
}).configure({
  deleteTriggerWithBackspace: true,
  renderText: ({ node }) => `@${node.attrs.id}`,
  renderHTML: ({ node, options }) => ["span", options.HTMLAttributes, `@${node.attrs.id}`],
});
