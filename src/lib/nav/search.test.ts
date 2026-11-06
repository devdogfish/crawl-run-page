import { describe, expect, test } from "vitest";
import { appendFileSync } from "node:fs";

import flows from "./flows.fixture.json";
import { isWeak, search, WEAK } from "./search";
import { buildUrl, chipsFor, validateUrl } from "./url-map";

type Flow = { query: string; context: { site: string; url: string }; kind: string; expect: string | null; why: string; priority: string };
const all = flows as Flow[];

// Same path, same param set; order of params doesn't matter
const canon = (u: string) => {
  const x = new URL(u, "http://x.invalid");
  return x.pathname + "?" + [...x.searchParams].map(([k, v]) => `${k}=${v}`).sort().join("&");
};

const det = all.filter((f) => f.kind === "deterministic" && f.expect && (f.priority === "must" || f.priority === "should"));
const timings: number[] = [];

describe("deterministic flows", () => {
  test.each(det.map((f) => [f.query + " @" + f.context.url, f] as const))("%s", (_name, f) => {
    const t = performance.now();
    const r = search(f.query, f.context);
    timings.push(performance.now() - t);
    expect(r.length, "no results").toBeGreaterThan(0);
    expect(canon(r[0].url)).toBe(canon(f.expect!));
    for (const x of r) expect(validateUrl(x.url).ok, x.url).toBe(true);
    expect(r[0].score).toBeGreaterThanOrEqual(WEAK);
  });
});

describe("AI-marked flows the matcher also gets", () => {
  const ai = all.filter((f) => f.kind === "ai" && f.expect);
  test.each(ai.map((f) => [f.query, f] as const))("%s", (_n, f) => {
    const r = search(f.query, f.context);
    // not required (the AI row covers these), but where the matcher is confident it must be right
    if (!isWeak(r)) expect(canon(r[0].url)).toBe(canon(f.expect!));
  });
  test("synonyms for broken external links", () => {
    for (const q of ["404", "broken links", "external 404s", "dead links"]) expect(search(q, { site: "rbccm", url: "/rbccm/overview" })[0].url, q).toBe("/rbccm/issues/broken-link-external");
  });
});

describe("questions and nonsense are not places", () => {
  const none = all.filter((f) => f.kind === "none");
  test.each(none.map((f) => [f.query || "(empty)", f] as const))("%s", (_n, f) => {
    const r = search(f.query, f.context);
    expect(isWeak(r)).toBe(true);
  });
});

describe("typo tolerance and shapes", () => {
  const ctx = { site: "rbccm", url: "/rbccm/overview" };
  test.each([
    ["setings", "/rbccm/settings"], ["analytcs", "/rbccm/analytics"], ["crwls", "/rbccm/crawls"], ["iss", "/rbccm/issues"],
    ["color-contrst", "/rbccm/issues/color-contrast"], ["P1 accessibility", "/rbccm/issues?cat=accessibility&pri=P1"],
    ["critical a11y issues", "/rbccm/issues?cat=accessibility&pri=P1"], ["videos 2022", "/rbccm/pages?type=video&year=2022"],
    ["rbc is crawls", "/rbcits/crawls"], ["worst pages", "/rbccm/pages"], ["fixed issues", "/rbccm/issues?seg=fixed"],
  ])("%s", (q, url) => { expect(canon(search(q, ctx)[0].url)).toBe(canon(url)); });

  test("results carry chips from the url map", () => {
    const r = search("new P1 accessibility issues", ctx)[0];
    expect(r.chips.map((c) => c.label)).toEqual(["Accessibility", "P1", "New"]);
  });
  test("latency", () => {
    const qs = ["a", "pod", "p1 acc", "color contrast on podcasts", "https://www.rbccm.com/en/insights/2021/data-centres-outlook", "data centres", "asdf qwer zxcv"];
    const ts = qs.flatMap((q) => Array.from({ length: 5 }, () => { const t = performance.now(); search(q, ctx); return performance.now() - t; }));
    appendFileSync("/tmp/nav-latency.txt", `max ${Math.max(...ts).toFixed(2)}ms median ${ts.sort((a, b) => a - b)[ts.length >> 1].toFixed(2)}ms flows-max ${Math.max(...timings).toFixed(2)}ms\n`);
    expect(Math.max(...ts)).toBeLessThan(16);
  });
});

describe("validateUrl", () => {
  test("rejects unknown params, bad enum values, bad sites, bad routes", () => {
    expect(validateUrl("/rbccm/issues?bogus=1").ok).toBe(false);
    expect(validateUrl("/rbccm/issues?pri=P9").ok).toBe(false);
    expect(validateUrl("/nope/issues").ok).toBe(false);
    expect(validateUrl("/rbccm/nothing/here/at/all").ok).toBe(false);
    expect(validateUrl("https://evil.example/rbccm/issues").ok).toBe(false);
    expect(validateUrl("//evil.example/rbccm/issues").ok).toBe(false);
    expect(validateUrl("/rbccm/issues/not-a-rule").ok).toBe(false);
    expect(validateUrl("/rbccm/crawls/1").ok).toBe(false);
    expect(validateUrl("/rbccm/pages/99999999").ok).toBe(false);
  });
  test("drops params at their default and orders the rest like the url map", () => {
    const v = validateUrl("/rbccm/issues?seg=new&pri=all&cat=seo&q=");
    expect(v.ok && v.url).toBe("/rbccm/issues?cat=seo&seg=new");
    expect(validateUrl("/rbccm/analytics?v=dashboard&range=30")).toMatchObject({ ok: true, url: "/rbccm/analytics" });
  });
  test("accepts valid ones and builds URLs", () => {
    expect(validateUrl("/rbcits/crawls/431").ok).toBe(true);
    expect(validateUrl("/rbccm/pages?sort=cat:performance&vs=none")).toMatchObject({ ok: true, url: "/rbccm/pages?vs=none&sort=cat:performance" });
    const b = buildUrl("pages", "rbccm", {}, { type: "podcast", year: 2024, q: "" });
    expect(b.ok && b.url).toBe("/rbccm/pages?type=podcast&year=2024");
    expect(chipsFor("/rbccm/pages?type=podcast&year=2024").map((c) => c.label)).toEqual(["Podcasts", "2024"]);
    expect(buildUrl("rule", "rbccm", { ruleId: "nope" }).ok).toBe(false);
  });
});

describe("intent: crawl on its own", () => {
  const ctx = { site: "rbccm", url: "/rbccm/analytics" };
  test("puts the Crawls page first and recent crawls under it", () => {
    for (const q of ["crawl", "crawls"]) {
      const r = search(q, ctx);
      expect(r[0].url, q).toBe("/rbccm/crawls");
      const recent = r.filter((x) => x.url.startsWith("/rbccm/crawls/"));
      expect(recent.length, q).toBe(5);
      expect(recent[0].title).toBe("Crawl #812");
      expect(recent[0].subtitle).toMatch(/^Running/);
    }
  });
  test("uses the other site when named", () => {
    expect(search("rbc is crawls", ctx).filter((x) => x.url.startsWith("/rbcits/crawls/")).length).toBe(5);
  });
  test("sends overview, dashboard, home and analytics to the same page", () => {
    for (const q of ["overview", "dashboard", "analytics", "home", "overvew"]) expect(search(q, ctx)[0].url, q).toBe("/rbccm/analytics");
  });
});

describe("references copied from Ask AI", () => {
  const ctx = { site: "rbccm", url: "/rbccm/crawls" };
  test("@issue, @rule, @page and @crawl go straight to the thing", () => {
    expect(search("@issue:210000", ctx)[0].url).toBe(search("210000", ctx)[0].url);
    expect(search("@rule:image-alt", ctx)[0].url).toBe("/rbccm/issues/image-alt");
    expect(search("@page:22", ctx)[0].url).toMatch(/^\/rbccm\/pages\/22/);
    expect(search("@crawl:806", ctx)[0].url).toBe("/rbccm/crawls/806");
    expect(search("  @Rule : image-alt ", ctx)[0].url).toBe("/rbccm/issues/image-alt");
  });
  test("an unknown id doesn't match anything confidently", () => {
    expect(isWeak(search("@issue:99999999999", ctx))).toBe(true);
  });
});
