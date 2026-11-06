// PROTOTYPE: user-defined rules, saved in this browser per site. A rule flags a page when its pattern is found
// (or missing) in the chosen part of the page. Rules run on the crawler's stored HTML, so they apply from the next
// crawl; earlier crawls aren't re-checked. Real backend: a row in the rule table (see docs/pages-and-issues.md and PLAN.md T2.7).
import type { Priority } from "@/lib/priority";

export type Scope = "content" | "attributes" | "source";
export const SCOPES: { value: Scope; label: string; description: string }[] = [
  { value: "content", label: "Page content", description: "The text people read. Scripts, styles and comments are ignored." },
  { value: "attributes", label: "Links and attribute values only", description: "href, src, alt, rel and other attribute values." },
  { value: "source", label: "Entire page source", description: "All of the HTML, including scripts, styles and comments." },
];

export type CustomRule = {
  id: string; name: string; scope: Scope;
  when: "found" | "missing"; pattern: string; regex: boolean; matchCase: boolean;
  type: string; // page type id, or "all"
  priority: Priority; category: string; howToFix: string;
};

const key = (site: string) => `crawler.rules.${site}`;
export function loadRules(site: string): CustomRule[] {
  try { return JSON.parse(localStorage.getItem(key(site)) ?? "[]"); } catch { return []; }
}
export function saveRules(site: string, rules: CustomRule[]) {
  try { localStorage.setItem(key(site), JSON.stringify(rules)); window.dispatchEvent(new Event("crawler:rules-changed")); } catch { /* ignore */ }
}

// null when the pattern is usable, else why not
export function patternError(pattern: string, regex: boolean): string | null {
  if (!pattern.trim()) return "Enter what to look for.";
  if (regex) { try { new RegExp(pattern); } catch (e) { return (e as Error).message.replace(/^Invalid regular expression: /, ""); } }
  return null;
}


// Validate model output at the browser boundary before storing or exposing an editable chip.
export function saveChatRule(value: unknown): CustomRule {
  if (!value || typeof value !== "object") throw new Error("AI returned an invalid rule.");
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^custom-[\w-]+$/.test(r.id) ||
    typeof r.site !== "string" || !["rbccm", "rbccm-qa", "rbcits", "rbcits-qa"].includes(r.site) ||
    typeof r.name !== "string" || !r.name.trim() || typeof r.pattern !== "string" ||
    !["content", "attributes", "source"].includes(String(r.scope)) || !["found", "missing"].includes(String(r.when)) ||
    typeof r.regex !== "boolean" || typeof r.matchCase !== "boolean" || typeof r.description !== "string") {
    throw new Error("AI returned an incomplete rule. Ask it to fill in the missing details.");
  }
  const error = patternError(r.pattern, r.regex);
  if (error) throw new Error(`Rule not saved: ${error}`);
  const rule: CustomRule = { id: r.id, name: r.name.trim(), pattern: r.pattern, scope: r.scope as Scope,
    when: r.when as CustomRule["when"], regex: r.regex, matchCase: r.matchCase, howToFix: r.description,
    type: "all", priority: "P3", category: "seo" };
  const rules = loadRules(r.site);
  // Replayed events cannot duplicate a rule or overwrite later manual edits.
  const existing = rules.find((item) => item.id === rule.id);
  if (existing) return existing;
  localStorage.setItem(key(r.site), JSON.stringify([...rules, rule]));
  window.dispatchEvent(new Event("crawler:rules-changed"));
  return rule;
}
