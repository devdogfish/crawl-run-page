// Pure text helpers for the assistant's markdown: no React, so they're easy to test.

// What the model writes in running text: `code` (left alone) and references that become chips.
const TOKEN = /(`[^`\n]*`|@issue:\d+|@rule:[a-z0-9-]+|@page:\d+|@crawl:\d+)/g;

export type RefKind = "issue" | "rule" | "page" | "crawl";
export type Part = { kind: "text" | "code"; text: string } | { kind: RefKind; id: string };

export function splitRefs(text: string): Part[] {
  const out: Part[] = [];
  text.split(TOKEN).forEach((s, n) => {
    if (n % 2 === 0) { if (s) out.push({ kind: "text", text: s }); return; }
    if (s.startsWith("`")) { out.push({ kind: "code", text: s }); return; }
    const m = s.match(/^@(issue|rule|page|crawl):(.+)$/)!;
    out.push({ kind: m[1] as RefKind, id: m[2] });
  });
  return out;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

// Top-level markdown blocks (split on blank lines outside code fences). The finished ones never change while the
// answer streams, so each can be rendered once and left alone. Items of one list and indented continuations stay together.
export function splitBlocks(text: string): string[] {
  const raw: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null; // the opening fence while inside one
  for (const line of text.split("\n")) {
    const f = line.match(FENCE);
    if (fence === null) { if (f) fence = f[1]; }
    else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
    if (fence === null && !line.trim()) {
      if (cur.length) { raw.push(cur.join("\n")); cur = []; }
    } else cur.push(line);
  }
  if (cur.length) raw.push(cur.join("\n"));

  const out: string[] = [];
  for (const b of raw) {
    const prev = out[out.length - 1];
    const first = b.split("\n")[0];
    const joins = prev !== undefined && !FENCE.test(prev) && !FENCE.test(b) && (/^\s+\S/.test(first) || (LIST_ITEM.test(first) && LIST_ITEM.test(prev.split("\n")[0])));
    if (joins) out[out.length - 1] = prev + "\n\n" + b;
    else out.push(b);
  }
  return out;
}

// The fence a block starts with: its language, and whether it's still open (no closing fence yet)
export function fenceOf(block: string): { lang: string; open: boolean } | null {
  const lines = block.split("\n");
  const f = lines[0].match(/^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/);
  if (!f) return null;
  const close = lines.slice(1).some((l) => { const c = l.match(FENCE); return !!c && c[1][0] === f[1][0] && c[1].length >= f[1].length && l.trim() === c[1]; });
  return { lang: f[2], open: !close };
}
