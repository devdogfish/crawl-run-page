import { describe, expect, it } from "vitest";
import { fenceOf, splitBlocks, splitRefs } from "./tokens";

describe("splitRefs", () => {
  it("finds every kind of reference", () => {
    expect(splitRefs("See @issue:91550003 and @rule:image-alt, @page:12 / @crawl:811.")).toEqual([
      { kind: "text", text: "See " }, { kind: "issue", id: "91550003" },
      { kind: "text", text: " and " }, { kind: "rule", id: "image-alt" },
      { kind: "text", text: ", " }, { kind: "page", id: "12" },
      { kind: "text", text: " / " }, { kind: "crawl", id: "811" },
      { kind: "text", text: "." },
    ]);
  });
  it("leaves code spans untouched", () => {
    expect(splitRefs("use `@issue:1` here")).toEqual([
      { kind: "text", text: "use " }, { kind: "code", text: "`@issue:1`" }, { kind: "text", text: " here" },
    ]);
  });
  it("returns plain text as one part and nothing for empty text", () => {
    expect(splitRefs("nothing to see")).toEqual([{ kind: "text", text: "nothing to see" }]);
    expect(splitRefs("")).toEqual([]);
  });
  it("keeps unknown-looking ids as references (the chip decides)", () => {
    expect(splitRefs("@issue:999999999999")).toEqual([{ kind: "issue", id: "999999999999" }]);
    expect(splitRefs("@issue:abc @rule:")).toEqual([{ kind: "text", text: "@issue:abc @rule:" }]);
  });
});

describe("splitBlocks", () => {
  it("splits on blank lines", () => {
    expect(splitBlocks("one\ntwo\n\nthree\n\n\nfour")).toEqual(["one\ntwo", "three", "four"]);
  });
  it("never splits inside a code fence, closed or open", () => {
    const closed = "intro\n\n```js\na\n\nb\n```\n\nafter";
    expect(splitBlocks(closed)).toEqual(["intro", "```js\na\n\nb\n```", "after"]);
    expect(splitBlocks("intro\n\n```ui\n{\"type\": \"fix\",\n\n\"html\": \"<img\"")).toEqual(["intro", "```ui\n{\"type\": \"fix\",\n\n\"html\": \"<img\""]);
  });
  it("keeps a loose list and indented continuations together", () => {
    expect(splitBlocks("1. a\n\n2. b\n\npara")).toEqual(["1. a\n\n2. b", "para"]);
    expect(splitBlocks("- a\n\n  more of a\n\nnext")).toEqual(["- a\n\n  more of a", "next"]);
  });
  it("does not merge a list into the paragraph before it", () => {
    expect(splitBlocks("Intro:\n\n- a\n- b")).toEqual(["Intro:", "- a\n- b"]);
  });
  it("keeps finished blocks identical while the tail grows", () => {
    const a = splitBlocks("first\n\nsecond par");
    const b = splitBlocks("first\n\nsecond paragraph\n\nthi");
    expect(b.slice(0, 1)).toEqual(a.slice(0, 1));
    expect(b).toHaveLength(3);
  });
});

describe("fenceOf", () => {
  it("reports language and whether the fence is still open", () => {
    expect(fenceOf("```ui\n{\"a\":1}")).toEqual({ lang: "ui", open: true });
    expect(fenceOf("```ui\n{\"a\":1}\n```")).toEqual({ lang: "ui", open: false });
    expect(fenceOf("plain text")).toBeNull();
  });
});
