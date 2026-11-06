// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { loadRules, saveChatRule } from "./custom-rules";
const draft = { site: "rbccm", id: "custom-test", name: "Old links", pattern: "old\\.example", scope: "attributes", when: "found", regex: true, matchCase: false, description: "Old domain" };
beforeEach(() => localStorage.clear());
test("chat rule persists once and replay preserves saved edits", () => {
  saveChatRule(draft);
  saveChatRule({ ...draft, name: "Replay" });
  expect(loadRules("rbccm")).toHaveLength(1);
  expect(loadRules("rbccm")[0]).toMatchObject({ name: "Old links", howToFix: "Old domain" });
  expect(loadRules("rbcits")).toHaveLength(0);
});
test("invalid AI patterns or incomplete fields never persist", () => {
  expect(() => saveChatRule({ ...draft, pattern: "[" })).toThrow();
  expect(() => saveChatRule({ ...draft, scope: null })).toThrow();
  expect(loadRules("rbccm")).toHaveLength(0);
});
