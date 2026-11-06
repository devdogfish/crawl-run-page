// @vitest-environment jsdom
import { RuleDialogHost } from "@/components/rule-dialog-host";
import { useState } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { system } from "@/components/ui/system";
import { RuleDialog } from "./rule-dialog";

// Exercise the window/request flow independently of the separately tested rich-text editor.
vi.mock("./assistant/composer", () => ({ Composer: ({ onSend, onStop, busy }: { onSend: (q: string) => void; onStop: () => void; busy: boolean }) => {
  const [text, setText] = useState("");
  return <><textarea aria-label="Rule prompt" value={text} onChange={(e) => setText(e.target.value)} />{busy ? <button onClick={onStop}>Stop</button> : <button onClick={() => { onSend(text); setText(""); }}>Send</button>}</>;
} }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

test("rule options toggle independently and persist on creation", async () => {
  const onCreate = vi.fn();
  const ui = render(<ChakraProvider value={system}><RuleDialog open onOpenChange={() => {}} onCreate={onCreate} /></ChakraProvider>);
  fireEvent.change(ui.getByPlaceholderText("Mentions the old brand name"), { target: { value: "Brand check" } });
  fireEvent.change(ui.getByPlaceholderText("Dominion Securities"), { target: { value: "brand" } });
  fireEvent.click(ui.getByText("Regular expression"));
  await waitFor(() => expect((ui.getByText("Regular expression").closest("label")!.querySelector("input") as HTMLInputElement).checked).toBe(true));
  fireEvent.click(ui.getByText("Match case"));
  await waitFor(() => expect((ui.getByText("Match case").closest("label")!.querySelector("input") as HTMLInputElement).checked).toBe(true));
  fireEvent.click(ui.getByText("Missing", { exact: true }));
  await waitFor(() => expect((ui.getByRole("radio", { name: "Missing" }) as HTMLInputElement).checked).toBe(true));
  fireEvent.click(ui.getByText("Entire page source"));
  await waitFor(() => expect((ui.getByRole("radio", { name: /Entire page source/ }) as HTMLInputElement).checked).toBe(true));
  fireEvent.click(ui.getByText("Create rule", { exact: true }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ regex: true, matchCase: true, when: "missing", scope: "source" }));
});

test("AI fills provided fields and keeps a follow-up conversation", async () => {
  const onCreate = vi.fn();
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
    fields: { pattern: "old\\.example", regex: true, scope: "attributes" }, message: "What name, match case, and found or missing?",
  }), { headers: { "X-Crawler-AI": "1" } })).mockResolvedValueOnce(new Response(JSON.stringify({
    fields: { name: "Old links", when: "missing", matchCase: true, description: "Detect old links" }, message: "Ready to review.",
  }), { headers: { "X-Crawler-AI": "1" } }));
  vi.stubGlobal("fetch", fetchMock);
  const ui = render(<ChakraProvider value={system}><RuleDialog open onOpenChange={() => {}} onCreate={onCreate} /></ChakraProvider>);
  fireEvent.click(ui.getByRole("button", { name: "AI rule assistant" }));
  fireEvent.change(await ui.findByLabelText("Rule prompt"), { target: { value: "Find old.example links" } });
  fireEvent.click(ui.getByRole("button", { name: "Send" }));
  await ui.findByText("What name, match case, and found or missing?");
  expect((ui.getByLabelText("Text or pattern") as HTMLInputElement).value).toBe("old\\.example");
  fireEvent.change(ui.getByLabelText("Rule prompt"), { target: { value: "Old links, missing, case sensitive. Description: Detect old links" } });
  fireEvent.click(ui.getByRole("button", { name: "Send" }));
  await ui.findByText("Ready to review.");
  const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(sent.messages).toHaveLength(3);
  expect(sent.current.pattern).toBe("old\\.example");
  fireEvent.click(ui.getByRole("button", { name: "AI rule assistant" }));
  fireEvent.click(ui.getByText("Create rule", { exact: true }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Old links", pattern: "old\\.example", scope: "attributes", when: "missing", regex: true, matchCase: true, howToFix: "Detect old links" }));
});

test("AI preserves edits made during a request and rejects invalid regex", async () => {
  let resolve!: (response: Response) => void;
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { pattern: "[", regex: true }, message: "Done" }), { headers: { "X-Crawler-AI": "1" } }));
  vi.stubGlobal("fetch", fetchMock);
  const ui = render(<ChakraProvider value={system}><RuleDialog open onOpenChange={() => {}} onCreate={() => {}} /></ChakraProvider>);
  fireEvent.click(ui.getByRole("button", { name: "AI rule assistant" }));
  fireEvent.change(await ui.findByLabelText("Rule prompt"), { target: { value: "Make a brand rule" } });
  fireEvent.click(ui.getByRole("button", { name: "Send" }));
  fireEvent.change(ui.getByPlaceholderText("Mentions the old brand name"), { target: { value: "My edited name" } });
  resolve(new Response(JSON.stringify({ fields: { name: "AI name", pattern: "brand", regex: true }, message: "Applied pattern" }), { headers: { "X-Crawler-AI": "1" } }));
  await ui.findByText("Applied pattern");
  expect((ui.getByPlaceholderText("Mentions the old brand name") as HTMLInputElement).value).toBe("My edited name");
  fireEvent.change(ui.getByLabelText("Rule prompt"), { target: { value: "Change pattern" } });
  fireEvent.click(ui.getByRole("button", { name: "Send" }));
  await ui.findByText(/AI returned an invalid pattern/);
  expect((ui.getByLabelText("Text or pattern") as HTMLInputElement).value).toBe("brand");
});

test("custom rule chip opens edit mode and updates the existing rule", async () => {
  const { MemoryRouter } = await import("react-router");
  const { withRefs } = await import("./assistant/chips");
  const { saveRules, loadRules } = await import("@/lib/custom-rules");
  saveRules("rbccm", [{ id: "custom-edit", name: "Original rule", pattern: "brand", regex: true, matchCase: true, scope: "source", when: "missing", howToFix: "Description", type: "all", priority: "P2", category: "seo" }]);
  const ui = render(<ChakraProvider value={system}><MemoryRouter initialEntries={["/rbccm/issues"]}>{withRefs("@rule:custom-edit")}<RuleDialogHost /></MemoryRouter></ChakraProvider>);
  fireEvent.click(ui.getByRole("button", { name: "Original rule" }));
  await ui.findByText("Edit rule");
  expect((ui.getByLabelText("Text or pattern") as HTMLInputElement).value).toBe("brand");
  fireEvent.change(ui.getByPlaceholderText("Mentions the old brand name"), { target: { value: "Updated rule" } });
  fireEvent.click(ui.getByRole("button", { name: "Save changes" }));
  await ui.findByRole("button", { name: "Updated rule" });
  expect(loadRules("rbccm")).toHaveLength(1);
  expect(loadRules("rbccm")[0]).toMatchObject({ id: "custom-edit", name: "Updated rule", priority: "P2", scope: "source", when: "missing" });
  localStorage.clear();
});

test("floating assistant can move, resize, close, and reopen", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
  const ui = render(<ChakraProvider value={system}><RuleDialog open onOpenChange={() => {}} onCreate={() => {}} /></ChakraProvider>);
  fireEvent.click(ui.getByRole("button", { name: "AI rule assistant" }));
  await ui.findByLabelText("Rule prompt");
  const drag = document.querySelector('[data-scope="floating-panel"][data-part="drag-trigger"]')!;
  const positioner = document.querySelector('[data-scope="floating-panel"][data-part="positioner"]')!;
  const originalPosition = positioner.getAttribute("style");
  fireEvent.pointerDown(drag, { button: 0, clientX: 600, clientY: 50 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  fireEvent.pointerMove(document, { clientX: 500, clientY: 100 });
  await waitFor(() => expect(positioner.getAttribute("style")).not.toBe(originalPosition));
  fireEvent.pointerUp(document);
  const originalSize = positioner.getAttribute("style");
  const resize = document.querySelector('[data-scope="floating-panel"][data-part="resize-trigger"][data-axis="se"]')!;
  fireEvent.pointerDown(resize, { button: 0, clientX: 900, clientY: 600 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  fireEvent.pointerMove(document, { clientX: 950, clientY: 650 });
  await waitFor(() => expect(positioner.getAttribute("style")).not.toBe(originalSize));
  fireEvent.pointerUp(document);
  fireEvent.click(ui.getByRole("button", { name: "Close rule assistant" }));
  await waitFor(() => expect(ui.queryByLabelText("Rule prompt")).toBeNull());
  fireEvent.click(ui.getByRole("button", { name: "AI rule assistant" }));
  await ui.findByLabelText("Rule prompt");
});


test("new rule draft survives a remount and explicit cancel discards it", async () => {
  const { openRuleEditor } = await import("./rule-dialog-host");
  const Host = () => <ChakraProvider value={system}><button onClick={() => openRuleEditor("rbccm")}>New</button><RuleDialogHost /></ChakraProvider>;
  let ui = render(<Host />);
  fireEvent.click(ui.getByText("New"));
  fireEvent.change(await ui.findByLabelText("Text or pattern"), { target: { value: "unfinished pattern" } });
  fireEvent.click(ui.getByText("Missing", { exact: true }));
  await waitFor(() => expect((ui.getByRole("radio", { name: "Missing" }) as HTMLInputElement).checked).toBe(true));
  ui.unmount();
  sessionStorage.clear();
  ui = render(<Host />);
  expect((await ui.findByLabelText("Text or pattern") as HTMLInputElement).value).toBe("unfinished pattern");
  expect((ui.getByRole("radio", { name: "Missing" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
  ui.unmount();
  ui = render(<Host />);
  expect(ui.queryByLabelText("Text or pattern")).toBeNull();
  fireEvent.click(ui.getByText("New"));
  expect((await ui.findByLabelText("Text or pattern") as HTMLInputElement).value).toBe("");
});

test("edit draft restores without chat and saves to the same rule", async () => {
  const { saveRules, loadRules } = await import("@/lib/custom-rules");
  saveRules("rbccm", [{ id: "custom-restore", name: "Existing", pattern: "old", regex: false, matchCase: false, scope: "content", when: "found", howToFix: "", type: "all", priority: "P3", category: "seo" }]);
  localStorage.setItem("crawler.ui.rule-dialog", JSON.stringify({ site: "rbccm", id: "custom-restore" }));
  const Host = () => <ChakraProvider value={system}><RuleDialogHost /></ChakraProvider>;
  let ui = render(<Host />);
  fireEvent.change(await ui.findByLabelText("Text or pattern"), { target: { value: "changed" } });
  ui.unmount();
  ui = render(<Host />);
  expect((await ui.findByLabelText("Text or pattern") as HTMLInputElement).value).toBe("changed");
  fireEvent.click(ui.getByRole("button", { name: "Save changes" }));
  expect(loadRules("rbccm")).toHaveLength(1);
  expect(loadRules("rbccm")[0].pattern).toBe("changed");
  expect(localStorage.getItem("crawler.ui.rule.rbccm.custom-restore")).toBeNull();
});
