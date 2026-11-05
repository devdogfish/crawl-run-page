// Crawl settings. Some are fixed once a crawl has started (they define WHAT is crawled, so changing
// them mid-run would make the results inconsistent); others only control HOW FAST/HOW HARD it crawls
// and can be changed while the crawl is paused.

export type Environment = "production" | "staging" | "development";

export const ENVIRONMENTS: Record<Environment, { label: string; url: string }> = {
  production: { label: "Production", url: "https://shop.example.com" },
  staging: { label: "Staging", url: "https://staging.shop.example.com" },
  development: { label: "Development", url: "https://dev.shop.example.com" },
};

export type Discovery = "sitemap+links" | "sitemap" | "links";
export const DISCOVERY: Record<Discovery, string> = {
  "sitemap+links": "Sitemap and links",
  sitemap: "Sitemap only",
  links: "Follow links only",
};

export type CrawlSettings = {
  // Locked after start
  environment: Environment;
  url: string;
  discovery: Discovery;
  exclude: string; // comma-separated path prefixes
  renderJs: boolean;
  respectRobots: boolean;
  // Editable while paused
  delayMs: number; // pause between requests per worker
  timeoutS: number; // give up on a request after this long
  concurrency: number; // parallel workers
  maxRetries: number; // retries for 5xx / timeouts
  lighthouseSample: number; // pages audited after the crawl (step hasn't run yet)
};

export const DEFAULT_SETTINGS: CrawlSettings = {
  environment: "production",
  url: ENVIRONMENTS.production.url,
  discovery: "sitemap+links",
  exclude: "/search, /cart, /account",
  renderJs: true,
  respectRobots: true,
  delayMs: 250,
  timeoutS: 30,
  concurrency: 64,
  maxRetries: 2,
  lighthouseSample: 200,
};

export const EDITABLE_WHILE_PAUSED = ["delayMs", "timeoutS", "concurrency", "maxRetries", "lighthouseSample"] as const;
export type EditableKey = (typeof EDITABLE_WHILE_PAUSED)[number];

export const EDITABLE_LABEL: Record<EditableKey, (v: number) => string> = {
  delayMs: (v) => `delay ${v} ms`,
  timeoutS: (v) => `timeout ${v} s`,
  concurrency: (v) => `${v} workers`,
  maxRetries: (v) => `${v} retries`,
  lighthouseSample: (v) => `Lighthouse sample ${v}`,
};

// "delay 250 → 500 ms, timeout 30 → 20 s" for the UPDATE log line
export function describeChanges(a: CrawlSettings, b: CrawlSettings) {
  const units: Record<EditableKey, string> = { delayMs: " ms", timeoutS: " s", concurrency: " workers", maxRetries: " retries", lighthouseSample: " pages" };
  const names: Record<EditableKey, string> = { delayMs: "delay", timeoutS: "timeout", concurrency: "concurrency", maxRetries: "retries", lighthouseSample: "Lighthouse sample" };
  return EDITABLE_WHILE_PAUSED.filter((k) => a[k] !== b[k]).map((k) => `${names[k]} ${a[k]} → ${b[k]}${units[k]}`).join(", ");
}

export const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
