// @vitest-environment jsdom
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PagePreview } from "./page-preview";
import { system } from "./ui/system";
import { RULE_CATALOG, type Instance } from "@/lib/page-issues";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test("mobile issue actions render outside the clipped preview and follow scrolling", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  const ui = render(<ChakraProvider value={system}><PagePreview html="<p>Page</p>" viewport={390}
    instances={[{ k: 1, rule: Object.keys(RULE_CATALOG)[0] } as Instance]} selected={1}
    card={<button>Issue actions</button>} /></ChakraProvider>);
  const iframe = ui.getByTitle("Crawled page") as HTMLIFrameElement;
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<p data-ix="1">Selected element</p>';
  Object.defineProperty(doc.documentElement, "scrollHeight", { value: 1000 });
  vi.spyOn(doc.querySelector("p")!, "getBoundingClientRect").mockReturnValue({ x: 350, y: 50, left: 350, top: 50, width: 30, height: 30 } as DOMRect);
  fireEvent.load(iframe);
  const action = await ui.findByText("Issue actions");
  expect(iframe.closest<HTMLElement>("[data-page-preview]")!.contains(action)).toBe(false);
  const overlay = action.parentElement!;
  await waitFor(() => expect(overlay.style.top).toBe("88px"));
  expect(overlay.style.left).toBe("175px");
  const wrapper = iframe.closest<HTMLElement>("[data-page-preview]")!;
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({ left: 0, top: 100 } as DOMRect);
  fireEvent.scroll(window);
  await waitFor(() => expect(overlay.style.top).toBe("188px"));
  wrapper.scrollTop = 30;
  fireEvent.scroll(wrapper);
  await waitFor(() => expect(overlay.style.top).toBe("158px"));
  wrapper.scrollTop = 100;
  fireEvent.scroll(wrapper);
  await waitFor(() => expect(overlay.style.visibility).toBe("hidden"));
});


test("outside clicks dismiss the card; selecting another issue smoothly reveals it", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  const scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = scrollTo;
  const instances = [1, 2].map(k => ({ k, rule: Object.keys(RULE_CATALOG)[0] } as Instance));
  const View = ({ selected, revealRequest = 0 }: { selected: number; revealRequest?: number }) => <ChakraProvider value={system}><PagePreview html="<p>Page</p>" viewport={390}
    instances={instances} selected={selected} revealRequest={revealRequest} card={<button>Issue actions</button>} /></ChakraProvider>;
  const ui = render(<View selected={1} />);
  const iframe = ui.getByTitle("Crawled page") as HTMLIFrameElement;
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<p data-ix="1">First</p><p data-ix="2">Second</p>';
  Object.defineProperty(doc.documentElement, "scrollHeight", { value: 2000 });
  doc.querySelectorAll("p").forEach((el, i) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left: 20, top: i ? 1400 : 50, width: 30, height: 30 } as DOMRect));
  fireEvent.load(iframe);
  const action = await ui.findByText("Issue actions");
  fireEvent.pointerDown(action);
  expect(ui.queryByText("Issue actions")).not.toBeNull();
  fireEvent.pointerDown(document.body);
  expect(ui.queryByText("Issue actions")).toBeNull();
  ui.rerender(<View selected={1} revealRequest={1} />);
  expect(ui.queryByText("Issue actions")).not.toBeNull();
  ui.rerender(<View selected={2} revealRequest={1} />);
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1250, behavior: "smooth" }));
  expect(ui.queryByText("Issue actions")).not.toBeNull();
});


test("evidence crop centers an element at the top-right page edge without excess height", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(680);
  const ui = render(<ChakraProvider value={system}><PagePreview html="<p>Page</p>" selected={1} crop={1} height={180}
    instances={[{ k: 1, rule: Object.keys(RULE_CATALOG)[0] } as Instance]} /></ChakraProvider>);
  const iframe = ui.getByTitle("Crawled page") as HTMLIFrameElement;
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<p data-ix="1">Search</p>';
  Object.defineProperty(doc.documentElement, "scrollHeight", { value: 2000 });
  vi.spyOn(doc.querySelector("p")!, "getBoundingClientRect").mockReturnValue({ left: 1200, top: 12, width: 32, height: 32 } as DOMRect);
  fireEvent.load(iframe);
  await waitFor(() => expect(iframe.parentElement!.style.transform).toBe("translate(-822.8px, 21.225px) scale(0.95625)"));
});
