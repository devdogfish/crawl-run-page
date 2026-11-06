import { describe, expect, test } from "vitest";
import { highlight, highlightTerms } from "./highlight";

describe("highlight", () => {
  test("marks case-insensitive matches and keeps the rest", () => {
    expect(highlight("Image has no text alternative", ["image", "TEXT"])).toEqual([
      { text: "Image", hit: true }, { text: " has no ", hit: false }, { text: "text", hit: true }, { text: " alternative", hit: false },
    ]);
  });
  test("no terms, no match, short terms", () => {
    expect(highlight("Pages", [])).toEqual([{ text: "Pages", hit: false }]);
    expect(highlight("Pages", ["zz"])).toEqual([{ text: "Pages", hit: false }]);
    expect(highlight("Pages", ["p"])).toEqual([{ text: "Pages", hit: false }]);
    expect(highlight("", ["ab"])).toEqual([{ text: "", hit: false }]);
  });
  test("longest term wins and special characters are literal", () => {
    expect(highlight("color-contrast (AA)", ["color", "color-contrast", "(aa)"]).filter((s) => s.hit).map((s) => s.text)).toEqual(["color-contrast", "(AA)"]);
  });
  test("segments join back to the text", () => {
    const t = "Podcasts · 2024 · RBC CM";
    expect(highlight(t, ["pod", "2024", "rbc"]).map((s) => s.text).join("")).toBe(t);
  });
  test("terms come from words of 2+ characters, never @ stems", () => {
    expect(highlightTerms(["new", "@rule:image-alt", "p1 acc", "a"])).toEqual(["new", "p1", "acc"]);
  });
});
