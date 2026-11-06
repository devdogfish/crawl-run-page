// Splits a text into plain and matching parts, for marking what the query matched in a result row.
export type Segment = { text: string; hit: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function highlight(text: string, terms: string[]): Segment[] {
  const ts = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!text || !ts.length) return [{ text, hit: false }];
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(new RegExp(ts.map(escape).join("|"), "gi"))) {
    if (!m[0]) continue;
    if (m.index > at) out.push({ text: text.slice(at, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

// The words of the chips and the draft that are worth marking: 2+ characters, @references left out
export const highlightTerms = (texts: string[]): string[] =>
  texts.flatMap((t) => t.split(/\s+/)).filter((w) => w.length >= 2 && !w.startsWith("@"));
