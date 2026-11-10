import { describe, expect, it } from "vitest";
import { validateUrl } from "./nav/url-map";
import { inPageScope, issueScopeDefaults, matchesIssueScope, pageScopeDefaults, readCrawlScope, readRouteQuery, returnPath } from "./route-query";
import { crawlChoices, defaultScope } from "./site-pages";

const site = "rbccm";
const defaults = { ...defaultScope(site), ...pageScopeDefaults, ...issueScopeDefaults, sort: "worst", band: "all", worst: "all" };

describe("route query scope", () => {
  it("keeps valid multi-value drilldown filters while discarding malformed values", () => {
    const query = new URLSearchParams("pri=P3,P2,P2,no&cat=seo,no&markup=shared&year=2025&sort=invalid&worst=P2&band=good&sub=../../");
    expect(readRouteQuery(site, defaults, query)).toMatchObject({
      pri: "P2,P3", cat: "seo", markup: "shared", year: "2025", sort: "worst", worst: "P2", band: "good", sub: "",
    });
    expect(validateUrl("/rbccm/pages?pri=P2,P3&cat=seo&markup=shared&year=2025&worst=P2&band=good").ok).toBe(true);
    expect(validateUrl("/rbccm/issues?pri=P2,P3&year=2025&sub=about").ok).toBe(true);
  });

  it("selects an earlier completed crawl from the same site and preserves explicit no comparison", () => {
    const [latest, older, previous] = crawlChoices(site);
    expect(readCrawlScope(site, older.id, latest.id)).toEqual({ crawl: older.id, vs: previous.id });
    expect(readCrawlScope(site, "invalid", "none")).toEqual({ crawl: latest.id, vs: "none" });
    expect(readCrawlScope(site, latest.id, "", false)).toEqual({ crawl: latest.id, vs: "none" });
  });

  it("matches the selected year, exact folder, rule, markup and priority", () => {
    const page = { type: "other", path: "/en/about/2025/report" };
    expect(inPageScope(page, { type: "other", year: "2025", sub: "about" })).toBe(true);
    expect(inPageScope(page, { type: "other", year: "2025", sub: "abo" })).toBe(false);
    expect(inPageScope({ type: "other", path: "/en/?lang=en" }, { ...pageScopeDefaults, sub: "__root__" })).toBe(true);
    expect(inPageScope(page, { ...pageScopeDefaults, sub: "__root__" })).toBe(false);
    const hit = { rule: "link-name", shared: true, pattern: "header a" };
    const scope = { ...issueScopeDefaults, pri: "P1,P2", cat: "accessibility", markup: "shared", el: "header a" };
    expect(matchesIssueScope(hit, scope)).toBe(true);
    expect(matchesIssueScope(hit, { ...scope, markup: "page" })).toBe(false);
    expect(matchesIssueScope(hit, { ...scope, auditRule: "label" })).toBe(false);
  });

  it("keeps a drilldown return link inside the selected site's known lists and rule pages", () => {
    expect(returnPath("/rbccm/issues/link-name?markup=shared", site, "/")).toBe("/rbccm/issues/link-name?markup=shared");
    expect(returnPath("//other.example", site, "/")).toBe("/");
    expect(returnPath("/rbccm/issues/../../rbcits/pages", site, "/")).toBe("/");
  });
});
