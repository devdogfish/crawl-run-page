import { afterEach, describe, expect, test, vi } from "vitest";

import * as customRules from "@/lib/custom-rules";
import { refChip } from "./chips";
import { search } from "./search";
import { suggestFor } from "./suggest";

const ctx = { site: "rbccm", url: "/rbccm/crawls" };
const texts = (word: string, mode: "search" | "chat" = "search") =>
  suggestFor({ word }, ctx, mode).map((s) => s.text);

describe("facets", () => {
  test("'p' lists the priorities first, with hints", () => {
    expect(texts("p").slice(0, 4)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(suggestFor({ word: "p" }, ctx)[0]).toMatchObject({ label: "P1", hint: "Critical" });
    expect(texts("p").length).toBeLessThanOrEqual(6);
  });
  test("prefixes, case-insensitive; one letter is only enough for p", () => {
    expect(texts("acc")[0]).toBe("accessibility");
    expect(texts("ACC")[0]).toBe("accessibility");
    expect(texts("a")).toEqual([]);
    expect(texts("20")).toEqual(["2026", "2025", "2024", "2023", "2022", "2021"]);
    expect(texts("202")[0]).toBe("2026");
    expect(texts("sh")).toContain("shared markup");
    expect(texts("wo")).toEqual(["worst"]);
    expect(texts("ove")[0]).toBe("analytics"); // overview
    expect(texts("zzz")).toEqual([]);
  });
  test("chat mode suggests no facets", () => {
    for (const w of ["p", "acc", "20", "sh", "ne"]) expect(texts(w, "chat"), w).toEqual([]);
  });
});

describe("suggestFor: the kinds", () => {
  test("a chip without a kind lists the four kinds, filtered by what is typed", () => {
    const s = suggestFor({ kind: null, text: "" }, ctx, "chat");
    expect(s.map((x) => x.text)).toEqual(["@issue:", "@rule:", "@page:", "@crawl:"]);
    expect(s.every((x) => x.kind === "stem" && x.hint && x.ref)).toBe(true);
    expect(suggestFor({ kind: null, text: "iss" }, ctx, "chat").map((x) => x.ref)).toEqual(["issue"]);
    expect(suggestFor({ kind: null, text: "R" }, ctx, "search").map((x) => x.ref)).toEqual(["rule"]);
    expect(suggestFor({ kind: null, text: "zzz" }, ctx, "chat")).toEqual([]);
  });
  test("a plain word is never a mention; chat has no word suggestions", () => {
    expect(suggestFor({ word: "@rule" }, ctx, "search")).toEqual([]);
    expect(suggestFor({ word: "acc" }, ctx, "chat")).toEqual([]);
    expect(suggestFor({ word: "acc" }, ctx, "search")[0].text).toBe("accessibility");
  });
});

describe("suggestFor: saved rules", () => {
  afterEach(() => vi.restoreAllMocks());
  const rule: customRules.CustomRule = { id: "custom-brand", name: "Old brand", pattern: "LegacyCorp.*", regex: true,
    scope: "content", when: "found", matchCase: false, type: "all", priority: "P1", category: "seo", howToFix: "" };
  test("suggests saved names and patterns, never priorities or built-in checks", () => {
    vi.spyOn(customRules, "loadRules").mockImplementation((site) => site === "rbccm" ? [rule] : []);
    const rules = (text: string) => suggestFor({ kind: "rule", text }, ctx, "chat");
    expect(rules("")).toEqual([expect.objectContaining({ text: "@rule:custom-brand", label: "Old brand", hint: "LegacyCorp.*", mark: undefined })]);
    expect(rules("brand")).toHaveLength(1);
    expect(rules("legacy")).toHaveLength(1);
    expect(rules("P1")).toEqual([]);
    expect(rules("image-alt")).toEqual([]);
    expect(suggestFor({ kind: "rule", text: "" }, { site: "rbcits", url: "/rbcits/issues" })).toEqual([]);
    expect(refChip("@rule:custom-brand", ctx)).toMatchObject({ label: "Old brand", value: "custom-brand" });
    expect(search("@rule:custom-brand", ctx)[0]).toMatchObject({ title: "Old brand", url: "/rbccm/issues", kind: "rule" });
  });
  test("no saved rules means no rule suggestions", () => {
    vi.spyOn(customRules, "loadRules").mockReturnValue([]);
    expect(suggestFor({ kind: "rule", text: "" }, ctx)).toEqual([]);
  });
});

describe("suggestFor: crawls", () => {
  const crawls = (text: string, site = "rbccm") => suggestFor({ kind: "crawl", text }, { site, url: `/${site}/crawls` }, "chat");
  test("the 8 most recent crawls, then a prefix filter", () => {
    expect(crawls("").map((x) => x.text)).toEqual(["@crawl:812", "@crawl:811", "@crawl:810", "@crawl:809", "@crawl:808", "@crawl:807", "@crawl:806", "@crawl:805"]);
    expect(crawls("")[0]).toMatchObject({ label: "#812", mark: { dot: "blue.solid" } });
    expect(crawls("80")[0].text).toBe("@crawl:809");
    expect(crawls("x")).toEqual([]);
    expect(crawls("", "rbcits")[0].text).toBe("@crawl:431");
  });
});

describe("suggestFor: pages", () => {
  const pages = (text: string, url = ctx.url) => suggestFor({ kind: "page", text }, { ...ctx, url }, "chat");
  test("nothing typed: 12 pages with the most critical issues, with their path", () => {
    const r = pages("");
    expect(r).toHaveLength(12);
    expect(r.every((x) => x.kind === "ref" && /^@page:\d+$/.test(x.text) && x.hint?.startsWith("/"))).toBe(true);
  });
  test("filters by title, path or id", () => {
    const r = pages("data");
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(30);
    expect(r.every((x) => x.label.toLowerCase().includes("data") || x.hint!.toLowerCase().includes("data"))).toBe(true);
    expect(pages("46111").map((x) => x.value)).toContain("46111");
    expect(pages("zzzzzzzz")).toEqual([]);
  });
});

describe("suggestFor: issues", () => {
  const issues = (text: string, url = ctx.url) => suggestFor({ kind: "issue", text }, { ...ctx, url }, "chat");
  test("on a page: all of its issues, with the element", () => {
    const s = issues("", "/rbccm/pages/46111?crawl=811");
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => /^@issue:\d+$/.test(x.text) && x.mark?.tag)).toBe(true);
    expect(s.map((x) => x.text)).toContain("@issue:461110000");
    expect(issues("4611100", "/rbccm/pages/46111").every((x) => x.text.startsWith("@issue:4611100"))).toBe(true);
  });
  test("elsewhere: up to 12 of the site's issues, P1 first, at most 3 per rule, each with its page path", () => {
    const r = issues("");
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(12);
    const tags = r.map((x) => x.mark?.tag ?? "");
    expect(tags).toEqual([...tags].sort());
    expect(tags[0]).toBe("P1");
    expect(r.every((x) => x.kind === "ref" && x.hint?.startsWith("/"))).toBe(true);
    const perRule = new Map<string, number>();
    for (const x of r) perRule.set(x.label, (perRule.get(x.label) ?? 0) + 1);
    expect(Math.max(...perRule.values())).toBeLessThanOrEqual(3);
    expect(new Set(r.map((x) => x.text)).size).toBe(r.length);
  });
  test("filters by title, path and id; a typed real id comes first", () => {
    const r = issues("heading");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.label.toLowerCase().includes("heading") || x.hint!.toLowerCase().includes("heading"))).toBe(true);
    expect(issues("461110000")[0].text).toBe("@issue:461110000");
    expect(issues("qqqqqqq")).toEqual([]);
  });
});
