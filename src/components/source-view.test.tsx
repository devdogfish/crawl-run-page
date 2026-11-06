// @vitest-environment jsdom
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SourceView } from "./source-view";
import { system } from "./ui/system";
import { RULE_CATALOG, type Instance } from "@/lib/page-issues";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test("source stays literal, copies full HTML, wraps, and navigates issues", async () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const html = '<style>body { color: red; }</style>\n<a data-ix="1" title="x > y" href="/search">&amp;</a>\n<img data-ix="2" src="missing" onerror="alert(1)">';
  const onSelect = vi.fn();
  const rule = Object.keys(RULE_CATALOG)[0];
  const ui = render(<ChakraProvider value={system}><SourceView html={html} selected={1} onSelect={onSelect} card={<div>Issue explanation</div>} instances={[{ k: 1, rule }, { k: 2, rule }] as Instance[]} /></ChakraProvider>);
  expect(ui.container.querySelector('img')).toBeNull();
  expect([...ui.container.querySelectorAll('code')].map(el => el.textContent).join('\n')).toBe('<style>…</style>\n<a title="x > y" href="/search">&amp;</a>\n<img src="missing" onerror="alert(1)">');
  fireEvent.click(ui.getByRole('button', { name: 'Copy source' }));
  await waitFor(() => expect(ui.getByRole('button', { name: 'Source copied' })).toBeTruthy());
  expect(copy).toHaveBeenCalledWith(html.replace(/ data-ix="\d+"/g, ''));
  fireEvent.click(ui.getByRole('button', { name: /Line 2:/ }));
  await waitFor(() => expect(ui.getByText('Issue explanation')).toBeTruthy());
  fireEvent.click(ui.getByRole('button', { name: 'Wrap' }));
  expect(ui.getByRole('button', { name: 'Wrap' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(ui.getByRole('button', { name: 'Next source issue' }));
  expect(onSelect).toHaveBeenCalledWith(2);
});
