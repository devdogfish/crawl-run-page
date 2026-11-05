// Crawl / baseline pickers in page headers (Pages, Issues): crawl id + date, with the distance as a hint
import { HStack, Portal, Select, Text } from "@chakra-ui/react";
import { useSite } from "@/components/site-context";
import { baselinesFor, crawlChoices } from "@/lib/site-pages";
import { useItems, type Item } from "@/components/filter-select";

export function ScopeSelect({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: Item[] }) {
  const collection = useItems(items);
  return (
    <Select.Root collection={collection} size="sm" w="48" value={[value]} onValueChange={(e) => e.value[0] && onChange(e.value[0])} aria-label={label}>
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger bg="bg"><Select.ValueText /></Select.Trigger>
        <Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content maxH="80">
            {items.map((item) => (
              <Select.Item key={item.value} item={item}>
                <Text flex="1">{item.label}</Text>
                {item.hint && <Text textStyle="xs" color="fg.muted">{item.hint}</Text>}
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

// "Crawl [#A] compared with [#B]": the baseline is an earlier crawl of the same site.
// Changing the crawl keeps the baseline if it's still older, else picks the crawl before it.
export function CrawlScope({ crawl, vs, onChange }: { crawl: string; vs: string; onChange: (crawl: string, vs: string) => void }) {
  const site = useSite();
  const crawls = crawlChoices(site);
  const at = crawls.find((c) => c.id === crawl)?.startedAt.getTime() ?? 0;
  const label = (id: string) => { const c = crawls.find((x) => x.id === id); return c ? `#${c.id} · ${fmtDay(c.startedAt)}` : `#${id}`; };
  const baselines = baselinesFor(site, crawl);
  return (
    <HStack gap="2" wrap="wrap">
      <ScopeSelect label="Crawl" value={crawl} onChange={(v) => {
        const fits = baselinesFor(site, v);
        onChange(v, vs === "none" ? "none" : fits.some((c) => c.id === vs) ? vs : fits[0]?.id ?? "none");
      }} items={crawls.map((c) => ({ value: c.id, label: label(c.id), hint: c.trigger }))} />
      <Text textStyle="sm" color="fg.muted">compared with</Text>
      <ScopeSelect label="Baseline" value={vs} onChange={(v) => onChange(crawl, v)}
        items={[{ value: "none", label: "No comparison", hint: "" }, ...baselines.map((c) => {
          const days = Math.round((at - c.startedAt.getTime()) / 86_400_000);
          return { value: c.id, label: label(c.id), hint: days <= 0 ? "Same day" : `${days} day${days === 1 ? "" : "s"} earlier` };
        })]} />
    </HStack>
  );
}

export const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
