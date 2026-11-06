// The input's content as plain data, and how it reads as text. Pure: no React, no editor.
//
//   A line is a list of segments: plain text and resolved references (@issue:220003). serialize() is the string the
//   matcher and the chat get: references as their tokens, in the order they sit in the text.
//
//   parseSegs("fix @issue:220003 now")  → text "fix ", ref issue 220003, text " now"
//   serialize(parseSegs(x))             → x (whitespace aside), so a chip never changes what search() understands
import { refChip, type TokenMode } from "./chips";
import type { Mark, SearchContext } from "./search";

export type RefKind = "issue" | "rule" | "page" | "crawl";

export type Seg =
  | { t: "text"; text: string }
  | { t: "ref"; kind: RefKind; id: string; label: string; mark?: Mark | null };

export type Line = Seg[];

export const refToken = (kind: RefKind, id: string) => `@${kind}:${id}`;

export const segText = (s: Seg): string => (s.t === "text" ? s.text : refToken(s.kind, s.id));

// One line: chips get a single space between them and their neighbours when the text has none
export function serializeLine(line: Line): string {
  let out = "", prevChip = false;
  for (const s of line) {
    const text = segText(s);
    if (!text) continue;
    const chip = s.t !== "text";
    if (out && !/\s$/.test(out) && !/^\s/.test(text) && (chip || (prevChip && !/^[.,;:!?)\]]/.test(text)))) out += " ";
    out += text;
    prevChip = chip;
  }
  return out;
}

// Lines are joined by a newline; spaces at the end of a line and blank lines at the ends are dropped
export const serialize = (lines: Line[]): string => lines.map((l) => serializeLine(l).replace(/[ \t]+$/, "")).join("\n").trim();

// ───────── Text → segments ─────────
const TRAILING_PUNCT = /^(.*?)([.,;:!?)\]]+)$/;

// The reference a "@kind:id" word names (an issue / page / crawl that exists, a rule id), or null
export function resolveMention(kind: RefKind, id: string, ctx: SearchContext): (Seg & { t: "ref" }) | null {
  const q = id.trim();
  const m = q && !/\s/.test(q) ? refChip(refToken(kind, q), ctx) : null;
  return m ? { t: "ref", kind, id: m.value, label: m.label, mark: m.mark ?? null } : null;
}

// A text → lines of segments. References that resolve become chips; everything else stays text. In "search" mode a
// line break is just a space.
export function parseSegs(text: string, ctx: SearchContext, mode: TokenMode): Line[] {
  const raw = mode === "search" ? [text.replace(/\s*\n\s*/g, " ")] : text.replace(/\r\n?/g, "\n").split("\n");
  const ref = (word: string) => {
    const m = /^@(issue|rule|page|crawl):(.+)$/i.exec(word);
    return m ? resolveMention(m[1].toLowerCase() as RefKind, m[2], ctx) : null;
  };
  return raw.map((line) => {
    const out: Line = [];
    const push = (s: Seg) => {
      const last = out[out.length - 1];
      if (s.t === "text" && last?.t === "text") last.text += s.text; else out.push(s);
    };
    for (const m of line.matchAll(/(\s+)|(\S+)/g)) {
      const word = m[0];
      if (m[1] || !word.startsWith("@")) { push({ t: "text", text: word }); continue; }
      const p = TRAILING_PUNCT.exec(word);
      const tail = p && ref(p[1]) ? p[2] : "";
      const seg = ref(tail ? p![1] : word);
      if (seg) { push(seg); if (tail) push({ t: "text", text: tail }); } else push({ t: "text", text: word });
    }
    return out;
  });
}
