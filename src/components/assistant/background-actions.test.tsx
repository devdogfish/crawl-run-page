// @vitest-environment jsdom
import { RuleDialogHost } from "@/components/rule-dialog-host";
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "../assistant";
import { system } from "../ui/system";
import { saveRules } from "@/lib/custom-rules";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = () => {};
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Controls() {
  const { open, setOpen } = useAssistant();
  return <><button onClick={() => setOpen(true)}>Open chat</button><output aria-label="Chat state">{open ? "open" : "closed"}</output></>;
}
async function setup(text: string, fullscreen: boolean) {
  sessionStorage.setItem("crawler.ask-ai", JSON.stringify([{ role: "assistant", text }]));
  const ui = render(<ChakraProvider value={system}><MemoryRouter initialEntries={["/rbccm/pages"]}><AssistantProvider><Controls /><RuleDialogHost /></AssistantProvider></MemoryRouter></ChakraProvider>);
  fireEvent.click(ui.getByText("Open chat"));
  await ui.findByRole("dialog", { name: "Ask AI" });
  const content = document.querySelector('[data-scope="floating-panel"][data-part="content"]')!;
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ width: fullscreen ? window.innerWidth : 400, height: window.innerHeight } as DOMRect);
  return ui;
}

test.each([true, false])("navigation dismisses chat only when full screen (%s)", async (fullscreen) => {
  const ui = await setup("[Preview](/rbccm/pages/7)", fullscreen);
  fireEvent.click(await ui.findByRole("link", { name: "Preview" }));
  await waitFor(() => expect(ui.getByLabelText("Chat state").textContent).toBe(fullscreen ? "closed" : "open"));
});

test("opening a rule dismisses full-screen chat without losing the edit dialog", async () => {
  saveRules("rbccm", [{ id: "custom-edit", name: "My rule", pattern: "old", scope: "content", when: "found", regex: false, matchCase: false, type: "all", priority: "P3", category: "seo", howToFix: "" }]);
  const ui = await setup("@rule:custom-edit", true);
  fireEvent.click(await ui.findByRole("button", { name: "My rule" }));
  await ui.findByText("Edit rule");
  expect(ui.getByLabelText("Chat state").textContent).toBe("closed");
  expect(ui.getByRole("button", { name: "Save changes" })).toBeTruthy();
});


test("open floating panel and unsent composer survive tab replacement", async () => {
  localStorage.setItem("crawler.ui.assistant.open", "true");
  localStorage.setItem("crawler.ui.assistant.placement", '"floating"');
  localStorage.setItem("crawler.ui.assistant.position", JSON.stringify({ x: 30, y: 45 }));
  localStorage.setItem("crawler.ui.assistant.size", JSON.stringify({ width: 450, height: 500 }));
  localStorage.setItem("crawler.ui.assistant.composer", JSON.stringify("Unsent question"));
  const Host = () => <ChakraProvider value={system}><MemoryRouter><AssistantProvider><Controls /></AssistantProvider></MemoryRouter></ChakraProvider>;
  let ui = render(<Host />);
  await waitFor(() => expect(ui.getByRole("textbox", { name: "Message to Ask AI" }).textContent).toBe("Unsent question"));
  expect(document.querySelector('[data-placement="floating"]')).not.toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Dock assistant left" }));
  ui.unmount();
  sessionStorage.clear();
  ui = render(<Host />);
  await ui.findByRole("dialog", { name: "Ask AI" });
  expect(document.querySelector('[data-placement="left"]')).not.toBeNull();
  await waitFor(() => expect(ui.getByRole("textbox", { name: "Message to Ask AI" }).textContent).toBe("Unsent question"));
});
