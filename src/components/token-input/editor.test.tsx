// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { system } from "@/components/ui/system";
import { TokenEditor, type SuggestView, type TokenEditorHandle } from "./editor";

vi.mock("@/lib/custom-rules", () => ({ loadRules: () => [
  { id: "custom-image", name: "Image policy", pattern: "<img", regex: true },
] }));

const ctx = { site: "rbccm", url: "/rbccm/crawls" };

// jsdom has no layout: ProseMirror asks for rects when it scrolls the caret into view
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => null;
});
afterEach(cleanup);

function setup(mode: "search" | "chat" = "chat", extra: { onKeyDown?: (e: KeyboardEvent) => void; external?: boolean } = {}) {
  const ref = createRef<TokenEditorHandle>();
  const changes: { text: string; empty: boolean }[] = [];
  let sg: SuggestView | null = null;
  const ui = render(
    <ChakraProvider value={system}>
      <TokenEditor ref={ref} mode={mode} ctx={ctx} placeholder="Type" ariaLabel="Test input" mentionUi={extra.external ? "external" : "popover"} onChange={(v) => changes.push(v)} onSuggest={(v) => { sg = v; }} onKeyDown={extra.onKeyDown} />
    </ChakraProvider>,
  );
  const dom = ui.container.querySelector(".tiptap") as HTMLElement & { editor: Editor };
  const editor = dom.editor;
  const view = editor.view;
  // typed one character at a time, the way ProseMirror hands text to handleTextInput
  const type = (text: string) => act(() => {
    for (const ch of text) {
      const { from, to } = view.state.selection;
      if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  });
  const key = (k: string, mods: { shiftKey?: boolean } = {}) => act(() => { fireEvent.keyDown(view.dom, { key: k, ...mods }); });
  const names = () => { const out: string[] = []; view.state.doc.descendants((n) => { if (!n.isText) out.push(n.type.name); }); return out; };
  const count = (name: string) => names().filter((n) => n === name).length;
  return { ref, ui, dom, editor, view, type, key, names, count, changes, sg: () => sg, text: () => ref.current!.getText() };

}

async function suggestions(t: ReturnType<typeof setup>, text: string) {
  t.type(text);
  await waitFor(() => expect(t.sg()?.items.length).toBeGreaterThan(0));
}

describe("official Mention + Suggestion", () => {
  test("@ shows kinds; choosing Issue keeps plain @issue: and shows entities", async () => {
    const t = setup();
    await suggestions(t, "@");
    expect(t.sg()?.items.map((s) => s.ref)).toEqual(["issue", "rule", "page", "crawl"]);
    expect(t.count("mention")).toBe(0);
    expect(t.dom.querySelector(".mention-query")?.textContent).toBe("@");
    t.type("iss");
    await waitFor(() => expect(t.sg()?.items.map((s) => s.ref)).toEqual(["issue"]));
    t.key("Enter");
    await waitFor(() => expect(t.sg()?.items[0].kind).toBe("ref"));
    expect(t.text()).toBe("@issue:");
  });
  test("entity selection inserts an atom, serializes with renderText, survives blur", async () => {
    const t = setup();
    await suggestions(t, "fix @issue:");
    const s = t.sg()!.items[0];
    act(() => t.ref.current!.accept(s));
    expect(t.count("mention")).toBe(1);
    expect(t.text()).toBe(`fix ${s.text}`);
    expect(t.editor.getText()).toBe(`fix ${s.text}`);
    expect(t.view.state.selection.$from.nodeBefore?.isAtom).toBe(true);
    act(() => { t.editor.commands.blur(); });
    expect(t.count("mention")).toBe(1);
    await waitFor(() => expect(t.dom.querySelector(".tq-chip")?.textContent).toContain(s.label));
    t.type(" please");
    expect(t.text()).toBe(`fix ${s.text} please`);
  });
  test("one Backspace removes the entire chip, without leaving @", async () => {
    const t = setup();
    await suggestions(t, "@rule:ima");
    t.key("Tab");
    expect(t.count("mention")).toBe(1);
    t.key("Backspace");
    expect(t.text()).toBe("");
    expect(t.count("mention")).toBe(0);
  });
  test("Shift+ArrowLeft selects one atom as a NodeSelection", () => {
    const t = setup();
    act(() => t.ref.current!.setContent("a @crawl:811"));
    t.key("ArrowLeft", { shiftKey: true });
    expect(t.view.state.selection.constructor.name).toBe("NodeSelection");
    expect(t.view.state.selection.to - t.view.state.selection.from).toBe(1);
    t.key("Backspace");
    expect(t.text()).toBe("a ");
  });
  test("paste resolves valid tokens; unknown tokens stay text; search flattens newlines", () => {
    const t = setup("search");
    act(() => { t.view.someProp("handlePaste", (f) => f(t.view, { clipboardData: { getData: () => "look @crawl:811\nand @issue:nope" } } as unknown as ClipboardEvent, null as never)); });
    expect(t.count("mention")).toBe(1);
    expect(t.text()).toBe("look @crawl:811 and @issue:nope");
  });
  test("space resolves an exact ID; invalid IDs remain text", () => {
    const t = setup();
    t.type("@issue:461110000 ");
    expect(t.count("mention")).toBe(1);
    expect(t.text()).toBe("@issue:461110000");
    t.type(" @issue:nope ");
    expect(t.count("mention")).toBe(1);
    expect(t.text()).toBe("@issue:461110000 @issue:nope ");
  });
  test("Enter with suggestions never forwards; Escape dismisses first; ordinary Enter forwards", async () => {
    const onKeyDown = vi.fn(), t = setup("chat", { onKeyDown });
    await suggestions(t, "@iss");
    t.key("Enter");
    expect(onKeyDown).not.toHaveBeenCalled();
    t.key("Escape");
    await waitFor(() => expect(t.sg()).toBeNull());
    expect(t.text()).toBe("@issue:");
    expect(t.dom.querySelector(".mention-query")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    t.key("Enter");
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
  test("Chakra capture-phase Escape reaches Suggestion and preserves the query", async () => {
    const t = setup();
    act(() => { t.view.focus(); });
    await suggestions(t, "@rule:ima");
    await waitFor(() => expect(document.querySelector('[data-scope="popover"][data-part="content"]')).not.toBeNull());
    // Let Chakra install its document capture handler, as in the real browser.
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    t.key("Escape");
    await waitFor(() => expect(t.sg()).toBeNull());
    expect(t.text()).toBe("@rule:ima");
  });
  test("an empty suggestion list also owns Enter", async () => {
    const onKeyDown = vi.fn(), t = setup("chat", { onKeyDown });
    t.type("@zzzz");
    await waitFor(() => expect(t.sg()?.mention?.text).toBe("zzzz"));
    t.key("Enter");
    expect(onKeyDown).not.toHaveBeenCalled();
  });
  test("external list receives navigation, Enter and Tab but not Escape", async () => {
    const onKeyDown = vi.fn(), t = setup("search", { onKeyDown, external: true });
    await suggestions(t, "@rule:ima");
    for (const key of ["ArrowDown", "Enter", "Tab"]) t.key(key);
    expect(onKeyDown.mock.calls.map(([e]) => e.key)).toEqual(["ArrowDown", "Enter", "Tab"]);
    t.key("Escape");
    expect(onKeyDown).toHaveBeenCalledTimes(3);
    expect(t.sg()).toBeNull();
  });
  test("one undo removes the inserted chip and restores its typed query", async () => {
    const t = setup();
    await suggestions(t, "fix @rule:ima");
    t.key("Tab");
    expect(t.count("mention")).toBe(1);
    act(() => { t.editor.commands.undo(); });
    expect(t.count("mention")).toBe(0);
    expect(t.text()).toBe("fix @rule:ima");
  });
  test("Tab completes a facet as plain text plus a space", () => {
    const t = setup("search");
    t.type("new p1 acc");
    expect(t.sg()?.items[0].text).toBe("accessibility");
    t.key("Tab");
    expect(t.text()).toBe("new p1 accessibility ");
    expect(t.names()).toEqual(["paragraph"]);
    t.type("issues");
    expect(t.text()).toBe("new p1 accessibility issues");
  });
  test("Shift+Enter adds a chat line; search stays single-line", () => {
    const t = setup();
    t.type("hello"); t.key("Enter", { shiftKey: true }); t.type("world");
    expect(t.text()).toBe("hello\nworld");
    const s = setup("search");
    s.type("hello"); s.key("Enter", { shiftKey: true });
    expect(s.view.state.doc.childCount).toBe(1);
  });
  test("textbox labels, active descendant, placeholder and chip labels", async () => {
    const t = setup("search");
    expect(t.dom.getAttribute("role")).toBe("textbox");
    expect(t.dom.getAttribute("aria-label")).toBe("Test input");
    expect(t.dom.querySelector("[data-placeholder]")?.getAttribute("data-placeholder")).toBe("Type");
    t.type("acc");
    expect(t.dom.getAttribute("aria-activedescendant")).toBe("token-suggest-opt-0");
    act(() => t.ref.current!.setContent("@rule:image-alt"));
    await waitFor(() => expect(t.dom.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("rule:image-alt"));
  });
});
