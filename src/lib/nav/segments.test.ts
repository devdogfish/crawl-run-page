import { describe, expect, test } from "vitest";

import { parseSegs, resolveMention, serialize, type Line } from "./segments";

const ctx = { site: "rbccm", url: "/rbccm/crawls" };

describe("serialize", () => {
  test("chips are their tokens, in place, with a space where the text has none", () => {
    const line: Line = [
      { t: "text", text: "fix" },
      { t: "ref", kind: "issue", id: "461110000", label: "Image has no text alternative" },
      { t: "text", text: "now" },
      { t: "text", text: " p1" },
      { t: "ref", kind: "crawl", id: "811", label: "#811" },
    ];
    expect(serialize([line])).toBe("fix @issue:461110000 now p1 @crawl:811");
  });
  test("lines are joined by newlines; the ends are trimmed", () => {
    expect(serialize([[{ t: "text", text: "a  " }], [], [{ t: "text", text: "b " }]])).toBe("a\n\nb");
    expect(serialize([[]])).toBe("");
  });
});

describe("parseSegs", () => {
  test("@kind:id tokens that resolve become chips, with their data; the rest stays text", () => {
    const [line] = parseSegs("why @issue:461110000 and @rule:image-alt and @page:46111 and @crawl:811 but not @issue:99999999999 or @what:2", ctx, "chat");
    const refs = line.filter((s) => s.t === "ref");
    expect(refs.map((s) => s.t === "ref" && [s.kind, s.id])).toEqual([["issue", "461110000"], ["rule", "image-alt"], ["page", "46111"], ["crawl", "811"]]);
    expect(refs[0]).toMatchObject({ mark: { tag: expect.stringMatching(/^P[1-4]$/) } });
    expect(refs[1]).toMatchObject({ label: "Image has no text alternative" });
    expect(serialize([line])).toContain("but not @issue:99999999999 or @what:2");
  });
  test("the text of a chat keeps its lines; a search is one line", () => {
    expect(parseSegs("a\nb\n", ctx, "chat")).toHaveLength(3);
    expect(parseSegs("a\nb", ctx, "search")).toHaveLength(1);
  });
});

describe("resolution rules", () => {
  test("an exact id resolves, anything else does not", () => {
    expect(resolveMention("issue", "461110000", ctx)).toMatchObject({ t: "ref", kind: "issue", id: "461110000" });
    expect(resolveMention("rule", "image-alt", ctx)).toMatchObject({ id: "image-alt" });
    expect(resolveMention("rule", "IMAGE-ALT", ctx)).toMatchObject({ id: "image-alt" });
    expect(resolveMention("page", "46111", ctx)).toMatchObject({ kind: "page", id: "46111" });
    expect(resolveMention("crawl", "811", ctx)).toMatchObject({ label: "#811" });
    for (const [k, q] of [["issue", "abc"], ["issue", ""], ["rule", "image"], ["page", "99999999"], ["crawl", "1"], ["page", "two words"]] as const) expect(resolveMention(k, q, ctx), `${k}:${q}`).toBeNull();
  });
});
