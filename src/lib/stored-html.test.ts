// @vitest-environment jsdom
import { expect, test } from "vitest";
import findings from "@/data/captured-findings.json";
import inventory from "@/data/public-pages.json";
import { getStoredDocument, getStoredSnapshot, prepareStoredPreview } from "./stored-html";

test("captured issue markers identify the original DOM element in the sanitized document", () => {
  const page = { url: inventory.rbccm.find(({ id }) => id === 9310)!.url };
  const finding = findings.rbccm["9310"].find(({ origin, onPage }) => origin === "static-html" && onPage)!;
  expect(getStoredSnapshot(page)?.sourceUrl).toBe(page.url);

  const html = getStoredDocument(page, [{ ...finding, k: 23 }]);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector(finding.selector)?.getAttribute("data-ix")).toBe("23");
  expect(document.querySelector("script, iframe, object, embed, [onload], [onclick], [data-capture-target], [data-mce-html]")).toBeNull();
  const preview = prepareStoredPreview(html);
  expect(preview).toContain("Content-Security-Policy");
  expect(preview).toContain("<style data-source-url=");
});

test("source markers are retained for stylesheet findings without visible elements", () => {
  const page = { url: inventory.rbccm.find(({ id }) => id === 0)!.url };
  const finding = findings.rbccm["0"].find(({ onPage }) => !onPage)!;
  const html = getStoredDocument(page, [{ ...finding, k: 7 }]);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector(finding.selector)?.getAttribute("data-ix")).toBe("7");
});

test("unavailable page source is explicit", () => {
  const page = { url: "https://example.invalid/missing" };
  expect(getStoredSnapshot(page)).toBeUndefined();
  expect(getStoredDocument(page, [])).toContain("Page HTML is unavailable");
});
