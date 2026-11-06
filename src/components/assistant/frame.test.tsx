// @vitest-environment jsdom
import { useState } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { system } from "@/components/ui/system";
import { AssistantFrame, dockingEdge, type Placement } from "./frame";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness() {
  const [placement, setPlacement] = useState<Placement>("right");
  return <ChakraProvider value={system}><AssistantFrame placement={placement} onPlacementChange={setPlacement} onClose={() => {}}>
    <textarea aria-label="Draft" />
  </AssistantFrame></ChakraProvider>;
}

test("detach and both dock controls preserve the mounted composer draft", async () => {
  const ui = render(<Harness />);
  const draft = ui.getByLabelText("Draft");
  fireEvent.change(draft, { target: { value: "An unfinished question" } });
  fireEvent.click(ui.getByRole("button", { name: "Detach assistant" }));
  await ui.findByRole("button", { name: "Dock assistant left" });
  fireEvent.click(ui.getByRole("button", { name: "Dock assistant left" }));
  expect(document.querySelector('[data-placement="left"]')).not.toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Detach assistant" }));
  fireEvent.click(ui.getByRole("button", { name: "Dock assistant right" }));
  expect(document.querySelector('[data-placement="right"]')).not.toBeNull();
  expect(ui.getByLabelText("Draft")).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe("An unfinished question");
});

test.each(["left", "right"] as const)("drag previews %s docking and commits only on release", async (side) => {
  const ui = render(<Harness />);
  fireEvent.click(ui.getByRole("button", { name: "Detach assistant" }));
  const drag = document.querySelector('[data-part="drag-trigger"]')!;
  fireEvent.pointerDown(drag, { button: 0, clientX: 650, clientY: 110 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  fireEvent.pointerMove(document, { clientX: side === "left" ? 0 : 1000, clientY: 110 });
  await ui.findByText(`Release to dock ${side}`);
  expect(document.querySelector('[data-placement="floating"]')).not.toBeNull();
  fireEvent.pointerUp(document);
  await waitFor(() => expect(document.querySelector(`[data-placement="${side}"]`)).not.toBeNull());
  expect(ui.queryByText(`Release to dock ${side}`)).toBeNull();
});

test("edge preview has a small hysteresis zone and clears away from edges", () => {
  expect(dockingEdge({ x: 20, y: 100 }, { width: 400, height: 600 }, 1200)).toBe("left");
  expect(dockingEdge({ x: 35, y: 100 }, { width: 400, height: 600 }, 1200, "left")).toBe("left");
  expect(dockingEdge({ x: 100, y: 100 }, { width: 400, height: 600 }, 1200, "left")).toBeNull();
});

test("pulling the docked header detaches and follows the same pointer gesture", async () => {
  const ui = render(<Harness />);
  const draft = ui.getByLabelText("Draft");
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  const drag = document.querySelector('[data-part="drag-trigger"]')!;
  fireEvent.pointerDown(drag, { button: 0, clientX: 700, clientY: 20 });
  fireEvent.pointerMove(document, { clientX: 697, clientY: 21 });
  expect(document.querySelector('[data-placement="right"]')).not.toBeNull();
  fireEvent.pointerMove(document, { clientX: 550, clientY: 100 });
  await waitFor(() => expect(document.querySelector('[data-placement="floating"]')).not.toBeNull());
  const positioner = document.querySelector('[data-part="positioner"]')!;
  const first = positioner.getAttribute("style");
  fireEvent.pointerMove(document, { clientX: 400, clientY: 140 });
  await waitFor(() => expect(positioner.getAttribute("style")).not.toBe(first));
  fireEvent.pointerUp(document);
  expect(document.querySelector('[data-placement="floating"]')).not.toBeNull();
  expect(ui.getByLabelText("Draft")).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe("Keep this draft");
});

test("a header click does not detach; a tear can dock on the opposite edge", async () => {
  render(<Harness />);
  const drag = document.querySelector('[data-part="drag-trigger"]')!;
  fireEvent.pointerDown(drag, { button: 0, clientX: 700, clientY: 20 });
  fireEvent.pointerUp(document);
  expect(document.querySelector('[data-placement="right"]')).not.toBeNull();
  fireEvent.pointerDown(drag, { button: 0, clientX: 700, clientY: 20 });
  fireEvent.pointerMove(document, { clientX: 50, clientY: 100 });
  fireEvent.pointerUp(document);
  await waitFor(() => expect(document.querySelector('[data-placement="left"]')).not.toBeNull());
});
