import { describe, expect, test } from "vitest";

import flows from "./flows.fixture.json";
import { search } from "./search";
import { parseSegs, serialize } from "./segments";

const ctx = { site: "rbccm", url: "/rbccm/crawls" };

// A chip sits where its word was, so the text the matcher sees is the text that was typed
describe("serialize(parseSegs(text))", () => {
  const through = (q: string, mode: "search" | "chat" = "search") => serialize(parseSegs(q, ctx, mode));
  test("a filter phrase stays text and reads back the same", () => {
    const [line] = parseSegs("new p1 accessibility issues", ctx, "search");
    expect(line).toEqual([{ t: "text", text: "new p1 accessibility issues" }]);
    expect(serialize([line])).toBe("new p1 accessibility issues");
    expect(search(serialize([line]), ctx)[0].url).toBe("/rbccm/issues?cat=accessibility&pri=P1&seg=new");
  });
  test("chat mode only converts references", () => {
    const [line] = parseSegs("is @rule:image-alt new p1 in @crawl:812 ok", ctx, "chat");
    expect(line.filter((s) => s.t === "ref").map((s) => s.t === "ref" && `${s.kind}:${s.id}`)).toEqual(["rule:image-alt", "crawl:812"]);
    expect(line.filter((s) => s.t === "ref")).toHaveLength(2);
    expect(serialize([line])).toBe("is @rule:image-alt new p1 in @crawl:812 ok");
  });
  test("without facets (a paste) only references convert", () => {
    const [line] = parseSegs("new p1 @rule:image-alt", ctx, "search");
    expect(line.map((s) => s.t)).toEqual(["text", "ref"]);
  });
  test("phrases whose meaning depends on word order are unchanged", () => {
    for (const q of ["since last crawl", "shared markup", "image alt", "pages that changed since last crawl", "new P1 accessibility issues", "@rule:image-alt", "crawl 812"]) {
      expect(through(q), q).toBe(q);
      expect(search(through(q), ctx)[0].url, q).toBe(search(q, ctx)[0].url);
    }
  });
  test("a reference followed by punctuation still resolves; unresolved ones stay text", () => {
    const [line] = parseSegs("see @issue:220003, and @issue:abc", ctx, "chat");
    expect(line.filter((s) => s.t === "ref")).toHaveLength(1);
    expect(serialize([line])).toBe("see @issue:220003, and @issue:abc");
  });
  test("lines: chat keeps them, search flattens them", () => {
    expect(through("a\nb", "chat")).toBe("a\nb");
    expect(through("a\nb", "search")).toBe("a b");
  });
});

describe("safety net over every deterministic flow", () => {
  type Flow = { query: string; context: { site: string; url: string }; kind: string };
  const det = (flows as Flow[]).filter((f) => f.kind === "deterministic");
  test.each(det.map((f) => [f.query + " @" + f.context.url, f] as const))("%s", (_n, f) => {
    for (const mode of ["search", "chat"] as const) {
      const text = serialize(parseSegs(f.query, f.context, mode));
      expect(search(text, f.context)[0]?.url).toBe(search(f.query, f.context)[0]?.url);
    }
  });
});
