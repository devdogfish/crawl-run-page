// The editor's document ↔ the plain data of src/lib/nav/segments.ts. A document is paragraphs of inline nodes: text
// and mention chips (a resolved @reference; attrs: id "issue:220003", label, mark).
import type { Node as PMNode, Schema } from "@tiptap/pm/model";

import { type Line, type Seg } from "@/lib/nav/segments";

export const MENTION = "mention";

// Nothing in it at all
export const isEmptyDoc = (doc: PMNode) => doc.textContent === "" && doc.childCount === 1 && doc.firstChild!.childCount === 0;

export const segToNode = (schema: Schema, s: Seg): PMNode | null =>
  s.t === "text" ? (s.text ? schema.text(s.text) : null) : schema.nodes[MENTION].create({ id: `${s.kind}:${s.id}`, label: s.label, mark: s.mark ?? null });

const paragraph = (schema: Schema, line: Line) => schema.nodes.paragraph.create(null, line.map((s) => segToNode(schema, s)).filter((n): n is PMNode => !!n));

export const linesToParagraphs = (schema: Schema, lines: Line[]): PMNode[] => (lines.length ? lines : [[]]).map((l) => paragraph(schema, l));
