// @vitest-environment jsdom
import { ChakraProvider } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { system } from "@/components/ui/system";
import { Diff } from "./cards";

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
