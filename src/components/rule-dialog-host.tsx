import { useEffect } from "react";
import { useBrowserState, removeBrowserState } from "@/lib/browser-state";
import { loadRules, saveRules } from "@/lib/custom-rules";
import { SITES } from "@/lib/sites";
import { RuleDialog } from "./rule-dialog";

type Session = { site: string; id: string | null };
const valid = (v: unknown): v is Session | null => v === null || (!!v && typeof v === "object" && "site" in v && typeof v.site === "string" && v.site in SITES && "id" in v && (v.id === null || typeof v.id === "string"));
export function openRuleEditor(site: string, id: string | null = null) {
  window.dispatchEvent(new CustomEvent("crawler:open-rule", { detail: { site, id } }));
}
export function RuleDialogHost() {
  const [session, setSession] = useBrowserState<Session | null>("crawler.ui.rule-dialog", null, valid);
  useEffect(() => {
    const open = (event: Event) => { const value = (event as CustomEvent).detail; if (valid(value)) setSession(value); };
    window.addEventListener("crawler:open-rule", open);
    return () => window.removeEventListener("crawler:open-rule", open);
  }, [setSession]);
  if (!session) return null;
  const rule = session.id ? loadRules(session.site).find((r) => r.id === session.id) : undefined;
  // A deleted rule must never be recreated accidentally from stale UI state.
  if (session.id && !rule) return null;
  const storageKey = `crawler.ui.rule.${session.site}.${session.id ?? "new"}`;
  const close = () => {
    removeBrowserState(storageKey);
    for (const suffix of ["open", "position", "size", "messages", "composer"]) removeBrowserState(`${storageKey}.ai.${suffix}`);
    setSession(null);
  };
  return <RuleDialog key={storageKey} storageKey={storageKey} open rule={rule} onOpenChange={(open) => { if (!open) close(); }}
    onCreate={(updated) => {
      const rules = loadRules(session.site);
      saveRules(session.site, rule ? rules.map((r) => r.id === updated.id ? updated : r) : [...rules, updated]);
    }} />;
}
