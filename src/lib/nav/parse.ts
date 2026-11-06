// Text → intent. Pulls the things a query can say (site, section, filters, crawl numbers, a rule) out of
// the words, in a fixed order, and counts how much of the query it understood. No ranking, no URLs here.
import { contentWords, lev, matchRules } from "./index";

export type SectionId = "overview" | "crawls" | "analytics" | "pages" | "issues" | "settings";
export type Intent = {
  base?: "rbccm" | "rbcits"; qa: boolean;
  section?: SectionId; sectionFuzzy: boolean;
  sections: SectionId[]; // every section the words named, in order ("pages … with seo problems" names two)
  f: Record<string, string>; // url-map param values: cat pri type year seg change markup sort rule links crawl vs v range
  isNew: boolean; // the word "new": a status on issues, a change on pages
  rule?: { id: string; q: number };
  consumed: number; leftover: string[];
  nonNav: boolean; // a question or a command, not a place
};

const STOP = new Set(["a", "an", "the", "of", "in", "on", "at", "for", "from", "with", "to", "me", "my", "show", "open", "go", "goto", "all", "any", "that", "are", "is", "and", "over", "please", "find", "list", "see", "view", "only", "by", "it", "this"]);
const nonStop = (s: string) => (s.toLowerCase().match(/[a-z0-9#]+/g) ?? []).filter((w) => !STOP.has(w)).length;

const NON_NAV = /^(how|what|why|when|where|who|which|can|could|should|would|will|please|explain|tell|help|fix|delete|remove|is|are|do|does|did|summari[sz]e|compare)\b/i;
// "overview", "dashboard" and "home" all mean the one analytics page
export const SECTION_WORDS: SectionId[] = ["crawls", "analytics", "pages", "issues", "settings"];
const SECTION_ALIAS: Record<string, SectionId> = { home: "analytics", overview: "analytics", problem: "issues", issue: "issues", crawl: "crawls", page: "pages", setting: "settings", config: "settings", preferences: "settings" };

export function parse(query: string): Intent {
  const o = query.trim();
  let s = " " + o.toLowerCase() + " ";
  const it: Intent = { qa: false, sectionFuzzy: false, sections: [], f: {}, isNew: false, consumed: 0, leftover: [], nonNav: NON_NAV.test(o) };

  // take(): remove every match of re from s, count its words as understood, and hand the groups to fn
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    s = s.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (...a) => {
      const groups = a.slice(0, a.findIndex((x) => typeof x === "number"));
      const m = Object.assign(groups, { index: 0 }) as unknown as RegExpExecArray;
      it.consumed += nonStop(groups[0]);
      fn(m);
      return " ";
    });
  };

  // "pages linking to <url>": the value keeps its case, so read it from the original
  const lm = /(?:\bpages?\s+)?(?:that\s+)?\blink(?:s|ing)?\s+to\s+(\S+)/i.exec(o);
  if (lm) { it.f.links = lm[1]; it.consumed += nonStop(lm[0]); s = s.replace(new RegExp(lm[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " "); }

  take(/\b(?:vs|versus|compared\s+(?:to|with)|against)\s+(?:crawl\s*)?#?(\d{2,4})\b/, (m) => { it.f.vs = m[1]; });
  take(/\b(?:since\s+(?:the\s+)?|in\s+the\s+|on\s+the\s+)?(?:last|previous|latest)\s+crawl\b|\bsince\s+(?:last|yesterday)\b/, () => { it.f.sinceLast = "1"; });
  take(/\bcrawl\s*#?(\d{2,4})\b|#(\d{2,4})\b/, (m) => { it.f.crawl = m[1] ?? m[2]; });
  take(/\bworst\s+(accessibility|a11y|performance|seo|security)\b/, (m) => { it.f.sort = "cat:" + (m[1] === "a11y" ? "accessibility" : m[1]); });
  take(/\bworst\b|\bmost\s+issues\b/, () => { it.f.sort ??= "worst"; });
  // content rules (regexes counted on each page's HTML)
  take(/\b(?:outdated\s+|old\s+|stale\s+)?copyright(?:\s+(?:years?|notices?))?\b/, () => { it.f.rule = "copyright"; });
  take(/\blegacy(?:\s+\.?page)?(?:\s+(?:links?|urls?|domains?))?\b/, () => { it.f.rule = "legacy-domain"; });
  take(/\b(?:placeholder|lorem\s+ipsum|tbd)(?:\s+text)?\b/, () => { it.f.rule = "placeholder"; });
  take(/\b(?:hard-?coded\s+)?phone(?:\s+numbers?)?\b/, () => { it.f.rule = "phone"; });
  take(/\bold\s+brand(?:\s+name)?\b|\bdexia\b/, () => { it.f.rule = "old-brand"; });
  // sites
  take(/\brbc\s*cm\b|\brbccm\b|\bcapital\s+markets\b/, () => { it.base = "rbccm"; });
  take(/\brbc\s*(?:is|its)\b|\brbc(?:is|its)\b|\binvestor\s+services\b/, () => { it.base = "rbcits"; });
  take(/\bqa\b|\bstaging\b/, () => { it.qa = true; });
  // filters
  take(/\b(20(?:1[6-9]|2[0-6]))\b/, (m) => { it.f.year = m[1]; });
  take(/\b(\d{1,3})\s*(?:days?|d)\b/, (m) => { it.f.range = m[1]; });
  take(/\bweek\b/, () => { it.f.range = "7"; });
  take(/\bmonth\b/, () => { it.f.range = "30"; });
  take(/\ball\s+time\b/, () => { it.f.range = "all"; });
  take(/\b(p[1-4])\b/, (m) => { it.f.pri = m[1].toUpperCase(); });
  take(/\b(?:critical|blockers?)\b/, () => { it.f.pri = "P1"; });
  take(/\bserious\b/, () => { it.f.pri = "P2"; });
  take(/\bmoderate\b/, () => { it.f.pri = "P3"; });
  take(/\bminor\b/, () => { it.f.pri = "P4"; });
  take(/\b(?:accessibility|a11y)\b/, () => { it.f.cat = "accessibility"; });
  take(/\bseo\b/, () => { it.f.cat = "seo"; });
  take(/\b(?:performance|perf|speed)\b/, () => { it.f.cat = "performance"; });
  take(/\b(?:security|compliance)\b/, () => { it.f.cat = "security"; });
  take(/\bpage[- ]specific(?:\s+markup)?\b/, () => { it.f.markup = "page"; });
  take(/\bshared(?:\s+(?:markup|template|components?))?\b|\btemplate\s+issues?\b/, () => { it.f.markup = "shared"; });
  take(/\bother\s+pages\b/, () => { it.f.type = "other"; });
  take(/\b(?:articles?|insights?|blog\s+posts?)\b/, () => { it.f.type = "article"; });
  take(/\bresearch(?:\s+reports?)?\b/, () => { it.f.type = "research"; });
  take(/\b(?:news(?:\s+releases?)?|press\s+releases?)\b/, () => { it.f.type = "news"; });
  take(/\bpodcasts?\b/, () => { it.f.type = "podcast"; });
  take(/\bvideos?\b/, () => { it.f.type = "video"; });
  take(/\bevents?\b/, () => { it.f.type = "event"; });
  take(/\b(?:people|persons?|bios?|profiles?)\b/, () => { it.f.type = "people"; });
  take(/\b(?:fixed|resolved)\b/, () => { it.f.seg = "fixed"; });
  take(/\b(?:new|added)\b/, () => { it.isNew = true; });
  take(/\b(?:changed|modified|updated|edited)\b/, () => { it.f.change = "changed"; });
  take(/\b(?:removed|deleted|gone)\b/, () => { it.f.change = "removed"; });
  // analytics views
  take(/\b(dashboard|report|board|explorer)\b/, (m) => { it.f.v = m[1]; });
  // sections
  take(/\b(overview|crawls?|analytics|pages?|issues?|problems?|settings?|home)\b/, (m) => {
    const w = m[1];
    it.section = SECTION_ALIAS[w] ?? (SECTION_WORDS.includes(w as SectionId) ? (w as SectionId) : SECTION_ALIAS[w.slice(0, -1)]);
    if (it.section && !it.sections.includes(it.section)) it.sections.push(it.section);
  });

  // what's left: a rule, or a section/site spelled loosely
  let rest = (s.match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w));
  if (rest.length) {
    const toks = contentWords(rest.join(" "));
    const hit = matchRules(toks)[0];
    if (hit && hit.score >= 0.6) { it.rule = { id: hit.id, q: hit.score }; it.consumed += rest.length; rest = []; }
  }
  const left: string[] = [];
  for (const w of rest) {
    const sec = w.length >= 3 ? ([...SECTION_WORDS, "overview"] as const).map((x) => [x, SECTION_ALIAS[x] ?? x] as const).find(([x]) => x.startsWith(w) || (w.length >= 4 && lev(w, x) <= (w.length >= 7 ? 2 : 1)))?.[1] : undefined;
    if (sec && !it.section) { it.section = sec; it.sections.push(sec); it.sectionFuzzy = true; it.consumed++; } else left.push(w);
  }
  it.leftover = left;
  return it;
}
