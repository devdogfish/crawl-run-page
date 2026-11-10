// @vitest-environment jsdom
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { system } from "@/components/ui/system";
import { MemoryRouter } from "react-router";
import { Diff, UiActions, UiBlock, splitChoices } from "./cards";
import { issueId, resolveIssue } from "@/lib/refs";
import { pageIssues } from "@/lib/page-issues";
import { baselinesFor, defaultCrawl, pagesFor } from "@/lib/site-pages";
import { DEFAULT_SITE } from "@/lib/sites";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("each diff section copies its exact multiline code and confirms only that section", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const before = '<a href="/search">\n  + Search\n</a>';
  const after = '<a href="/search" aria-label="Search">\n  + Search\n</a>';
  const ui = render(<ChakraProvider value={system}><Diff before={before} after={after} /></ChakraProvider>);
  fireEvent.click(ui.getByRole("button", { name: "Copy original code" }).querySelector("span")!);
  await ui.findByRole("button", { name: "Copied original code" });
  expect(writeText).toHaveBeenLastCalledWith(before);
  expect(ui.getByRole("button", { name: "Copy replacement code" })).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Copy replacement code" }));
  await ui.findByRole("button", { name: "Copied replacement code" });
  expect(writeText).toHaveBeenLastCalledWith(after);
});

test("copy confirmation waits for clipboard success and stays absent on failure", async () => {
  let resolve!: () => void;
  const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }))
    .mockRejectedValueOnce(new Error("Clipboard denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const ui = render(<ChakraProvider value={system}><Diff before="old" after="new" /></ChakraProvider>);
  fireEvent.click(ui.getByRole("button", { name: "Copy original code" }));
  expect(ui.queryByRole("button", { name: "Copied original code" })).toBeNull();
  resolve();
  await ui.findByRole("button", { name: "Copied original code" });
  fireEvent.click(ui.getByRole("button", { name: "Copy replacement code" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(ui.queryByRole("button", { name: "Copied replacement code" })).toBeNull();
});

// ───────── The cards the model asks for with ```ui blocks ─────────

// The first pages of the default site that have open issues, and their issue ids
function openIssues(n: number) {
  const a = Number(defaultCrawl(DEFAULT_SITE).id), b = Number(baselinesFor(DEFAULT_SITE, String(a))[0]?.id);
  const out: { page: number; ids: string[]; issues: number }[] = [];
  for (const page of pagesFor(DEFAULT_SITE, a, b)) {
    if (out.length === n) break;
    if (page.change === "removed") continue;
    const elements = pageIssues(page, a, b).instances.filter((it) => it.status !== "fixed");
    const ids = elements.map((it) => issueId(DEFAULT_SITE, page.i, it.k));
    if (ids.length >= 2) out.push({ page: page.i, ids, issues: new Set(elements.map(({ rule }) => rule)).size });
  }
  return out;
}

const renderUi = (body: object | string, actions: { send?: (q: string) => void; busy?: boolean } = {}) => render(
  <ChakraProvider value={system}><MemoryRouter initialEntries={[`/${DEFAULT_SITE}/pages`]}>
    <UiActions.Provider value={actions}><UiBlock body={typeof body === "string" ? body : JSON.stringify(body)} /></UiActions.Provider>
  </MemoryRouter></ChakraProvider>);

test("issue: one issue with its HTML, and Fix asks for a fix of exactly that issue", () => {
  const [{ ids: [id] }] = openIssues(1);
  const r = resolveIssue(id)!;
  const send = vi.fn();
  const ui = renderUi({ type: "issue", issue: id }, { send });
  expect(ui.getByText(r.it.snippet)).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Fix" }));
  expect(send).toHaveBeenCalledWith(`Fix @issue:${r.id}`);
});

test("issue: no Fix without a conversation to send to, and none while an answer is being written", () => {
  const [{ ids: [id] }] = openIssues(1);
  expect(renderUi({ type: "issue", issue: id }).queryByRole("button", { name: "Fix" })).toBeNull();
  cleanup();
  const busy = renderUi({ type: "issue", issue: id }, { send: vi.fn(), busy: true });
  expect((busy.getByRole("button", { name: "Fix" }) as HTMLButtonElement).disabled).toBe(true);
});

test("issues: one row per known id in order, unknown ids and duplicates dropped, a Fix per row", () => {
  const [{ ids }] = openIssues(1);
  const [x, y] = ids;
  const send = vi.fn();
  const ui = renderUi({ type: "issues", title: "Worst first", issues: [y, "999999999999", x, y] }, { send });
  expect(ui.getByText("Worst first")).toBeTruthy();
  const rows = ui.getAllByRole("row");
  expect(rows.map((tr) => tr.querySelector("a")!.getAttribute("href"))).toEqual([resolveIssue(y)!.href(), resolveIssue(x)!.href()]);
  const r = resolveIssue(x)!;
  fireEvent.click(ui.getByRole("button", { name: `Fix: ${r.rule.title} (${r.it.selector})` }));
  expect(send).toHaveBeenCalledWith(`Fix @issue:${r.id}`);
});

test("issues: copy puts the rows on the clipboard as a table, export downloads a csv", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const createObjectURL = vi.fn(() => "blob:x");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  const [{ ids: [x] }] = openIssues(1);
  const ui = renderUi({ type: "issues", issues: [x] });
  fireEvent.click(ui.getByRole("button", { name: "Copy as a table" }));
  await ui.findByRole("button", { name: "Copied" });
  const [head, row] = writeText.mock.calls[0][0].split("\n");
  expect(head.split("\t")[0]).toBe("id");
  expect(row.split("\t")[0]).toBe(x);
  fireEvent.click(ui.getByRole("button", { name: "Export (.csv)" }));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
});

test("issues: no known id falls back to the code block", () => {
  const ui = renderUi({ type: "issues", issues: ["999999999999"] });
  expect(ui.queryByRole("row")).toBeNull();
  expect(ui.container.textContent).toContain('"issues"');
});

test("page: open issue count, priorities and links to the page", () => {
  const [{ page, issues }] = openIssues(1);
  const ui = renderUi({ type: "page", page: String(page) });
  expect(ui.getByText(new RegExp(`^${issues} open`))).toBeTruthy();
  const hrefs = ui.getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(hrefs).toContain(`/${DEFAULT_SITE}/pages/${page}?tab=preview`);
});

test("pages: one row per page in order with its open issues", () => {
  const [p, q] = openIssues(2);
  const ui = renderUi({ type: "pages", pages: [String(q.page), String(p.page), "abc"] });
  const rows = ui.getAllByRole("row");
  expect(rows.map((tr) => tr.querySelector("a")!.getAttribute("href"))).toEqual([`/${DEFAULT_SITE}/pages/${q.page}`, `/${DEFAULT_SITE}/pages/${p.page}`]);
  expect(rows[1].textContent).toContain(`${p.issues} open`);
  expect(ui.getByRole("button", { name: "Export (.csv)" })).toBeTruthy();
});

test("splitChoices: takes finished choice blocks out of the text and leaves the other cards", () => {
  const fix = '```ui\n{"type":"fix","issue":"1","html":"<p>"}\n```';
  const text = `Here.\n\n${fix}\n\n\`\`\`ui\n{"type":"choice","options":["Yes"," No ","Yes",4]}\n\`\`\``;
  expect(splitChoices(text)).toEqual({ text: `Here.\n\n${fix}`, options: ["Yes", "No"] });
  const open = 'Here.\n\n```ui\n{"type":"choice","opt';
  expect(splitChoices(open)).toEqual({ text: open, options: [] });
});

test("tables: long lists fold, cap at 25 rows, and say what's left to Export, which has every row", async () => {
  const many = openIssues(12).flatMap((p) => p.ids).slice(0, 30);
  expect(many).toHaveLength(30);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const ui = renderUi({ type: "issues", issues: [...many, "999999999999"] });
  expect(ui.getAllByRole("row")).toHaveLength(8);
  fireEvent.click(ui.getByRole("button", { name: "Show 17 more" }));
  expect(ui.getAllByRole("row")).toHaveLength(25);
  expect(ui.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  expect(ui.getByText("6 more aren't shown here. Export has them all.")).toBeTruthy(); // the unknown id past the rows isn't looked up
  fireEvent.click(ui.getByRole("button", { name: "Copy as a table" }));
  await ui.findByRole("button", { name: "Copied" });
  expect(writeText.mock.calls[0][0].split("\n")).toHaveLength(31); // header + all 30
});

test("tables: a short list shows every row and no footer; ids that aren't found are counted", () => {
  const [{ ids }] = openIssues(1);
  const ui = renderUi({ type: "issues", issues: [ids[0], "999999999999", ids[1]] });
  expect(ui.getAllByRole("row")).toHaveLength(2);
  expect(ui.getByText("1 couldn't be found.")).toBeTruthy();
  expect(ui.queryByText(/shown here/)).toBeNull();
});

test("pages: ids that aren't pages are dropped before anything is looked up", () => {
  const [p] = openIssues(1);
  const ui = renderUi({ type: "pages", pages: [String(p.page), "abc", null, { x: 1 }] });
  expect(ui.getAllByRole("row")).toHaveLength(1);
  expect(ui.queryByText(/couldn't be found/)).toBeNull();
});
