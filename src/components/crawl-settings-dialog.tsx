"use client";

// Crawl settings, used in three modes:
//   create → everything editable ("New crawl" in the navbar)
//   paused → target + discovery locked, throughput editable (Settings while a crawl is paused)
//   view   → read-only (running or finished crawl)
import { createContext, useContext, useRef, useState } from "react";
import {
  Alert, Button, CloseButton, Dialog, Field, Grid, Group, HStack, Input, InputGroup, NumberInput, Portal, Select, createListCollection, type ListCollection,
  Separator, Stack, Switch,
} from "@chakra-ui/react";

import { DISCOVERY, ENVIRONMENTS, type CrawlSettings, type Discovery, type Environment } from "@/lib/settings";
import { SITES, envUrl } from "@/lib/sites";

export type SettingsMode = "create" | "paused" | "view";

export function CrawlSettingsDialog({ open, onOpenChange, mode, initial, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SettingsMode;
  initial: CrawlSettings;
  onSubmit?: (s: CrawlSettings, opts: { resume: boolean }) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="lg" placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          {/* Remount the form each time it opens, so it starts from the current settings */}
          {open && <SettingsForm mode={mode} initial={initial} onSubmit={onSubmit} onClose={() => onOpenChange(false)} />}
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

const PortalTarget = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

function SettingsForm({ mode, initial, onSubmit, onClose }: {
  mode: SettingsMode; initial: CrawlSettings; onSubmit?: (s: CrawlSettings, opts: { resume: boolean }) => void; onClose: () => void;
}) {
  const [s, setS] = useState<CrawlSettings>(initial);
  const set = <K extends keyof CrawlSettings>(k: K, v: CrawlSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const lockedFixed = mode !== "create"; // target + discovery
  const lockedLive = mode === "view"; // throughput
  const changed = JSON.stringify(s) !== JSON.stringify(initial);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <PortalTarget.Provider value={contentRef}>
    <Dialog.Content ref={contentRef}>
      <Dialog.Header>
        <Dialog.Title>{mode === "create" ? "New crawl" : "Crawl settings"}</Dialog.Title>
      </Dialog.Header>
      <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>

      <Dialog.Body>
        <Stack gap="5">
          {mode === "paused" && (
            <Alert.Root status="info" size="sm">
              <Alert.Indicator />
              <Alert.Title>Target and discovery are fixed for this crawl. Throughput changes apply when you resume.</Alert.Title>
            </Alert.Root>
          )}
          {mode === "view" && (
            <Alert.Root status="neutral" size="sm">
              <Alert.Indicator />
              <Alert.Title>Pause the crawl to change throughput settings.</Alert.Title>
            </Alert.Root>
          )}

          <Stack gap="5" separator={<Separator />}>
          <Section>
            <Field.Root disabled={lockedFixed}>
              <Group w="full" gap="0" aria-label={`${SITES[s.site].name}: environment and URL`}>
                <StyledSelect
                  collection={ENV_ITEMS} value={s.environment} disabled={lockedFixed} w="40" flexShrink={0} attachedStart
                  onChange={(v) => { const env = v as Environment; setS((x) => ({ ...x, environment: env, url: envUrl(x.site, env) })); }}
                />
                <Input size="sm" value={s.url} onChange={(e) => set("url", e.target.value)} roundedStart="0" ms="-1px" />
              </Group>
            </Field.Root>
          </Section>

          <Section>
            <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="4">
              <Field.Root disabled={lockedFixed}>
                <Field.Label>Find pages from</Field.Label>
                <StyledSelect collection={DISCOVERY_ITEMS} value={s.discovery} disabled={lockedFixed} onChange={(v) => set("discovery", v as Discovery)} />
              </Field.Root>
              <Field.Root disabled={lockedFixed}>
                <Field.Label>Exclude paths</Field.Label>
                <Input size="sm" value={s.exclude} onChange={(e) => set("exclude", e.target.value)} placeholder="/search, /cart" />
              </Field.Root>
            </Grid>
            <HStack gap="8" mt="4">
              <Toggle label="Render JavaScript" checked={s.renderJs} disabled={lockedFixed} onChange={(v) => set("renderJs", v)} />
              <Toggle label="Respect robots.txt" checked={s.respectRobots} disabled={lockedFixed} onChange={(v) => set("respectRobots", v)} />
            </HStack>
          </Section>

          <Section>
            <Grid templateColumns={{ base: "1fr 1fr", sm: "repeat(3, 1fr)" }} gap="4">
              <Num label="Request delay" unit="ms" help="Wait between requests, per worker" value={s.delayMs} min={0} max={10_000} step={50} disabled={lockedLive} onChange={(v) => set("delayMs", v)} />
              <Num label="Timeout" unit="s" help="Give up on a request after this long" value={s.timeoutS} min={1} max={120} disabled={lockedLive} onChange={(v) => set("timeoutS", v)} />
              <Num label="Concurrency" unit="workers" help="Requests in flight at once" value={s.concurrency} min={1} max={256} disabled={lockedLive} onChange={(v) => set("concurrency", v)} />
              <Num label="Retries" unit="per URL" help="Retries for 5xx responses and timeouts" value={s.maxRetries} min={0} max={10} disabled={lockedLive} onChange={(v) => set("maxRetries", v)} />
              <Num label="Lighthouse sample" unit="pages" help="Pages audited after the crawl" value={s.lighthouseSample} min={10} max={2_000} step={10} disabled={lockedLive} onChange={(v) => set("lighthouseSample", v)} />
            </Grid>
          </Section>
          </Stack>
        </Stack>
      </Dialog.Body>

      <Dialog.Footer>
        {mode === "view" ? (
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            {mode === "paused" && <Button size="sm" variant="outline" disabled={!changed} onClick={() => { onSubmit?.(s, { resume: false }); onClose(); }}>Save</Button>}
            <Button size="sm" onClick={() => { onSubmit?.(s, { resume: true }); onClose(); }}>
              {mode === "create" ? "Start crawl" : "Save and resume"}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </Dialog.Content>
    </PortalTarget.Provider>
  );
}

// Chakra's styled Select (not the browser's native one). Its menu is portalled into the dialog content
// (Chakra's pattern for Select inside Dialog), so it isn't clipped by the scrolling body.
type Option = { value: string; label: string };
const ENV_ITEMS = createListCollection<Option>({ items: (Object.keys(ENVIRONMENTS) as Environment[]).map((e) => ({ value: e, label: ENVIRONMENTS[e].label })) });
const DISCOVERY_ITEMS = createListCollection<Option>({ items: (Object.keys(DISCOVERY) as Discovery[]).map((d) => ({ value: d, label: DISCOVERY[d] })) });

function StyledSelect({ collection, value, onChange, disabled, attachedStart, ...rest }: {
  collection: ListCollection<Option>; value: string; onChange: (v: string) => void;
  disabled: boolean; attachedStart?: boolean; w?: string; flexShrink?: number;
}) {
  const container = useContext(PortalTarget);
  return (
    <Select.Root collection={collection} size="sm" value={[value]} onValueChange={(e) => e.value[0] && onChange(e.value[0])}
      disabled={disabled} positioning={{ sameWidth: true }} {...rest}>
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger roundedEnd={attachedStart ? "0" : undefined}>
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup>
      </Select.Control>
      <Portal container={container ?? undefined}>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

// A group of related fields; groups are divided by the separators on the body's Stack
function Section({ children }: { children: React.ReactNode }) {
  return <Stack gap="4">{children}</Stack>;
}

function Num({ label, unit, help, value, min, max, step = 1, disabled, onChange }: {
  label: string; unit: string; help: string; value: number; min: number; max: number; step?: number; disabled: boolean; onChange: (v: number) => void;
}) {
  return (
    <Field.Root disabled={disabled} title={help}>
      <Field.Label>{label}</Field.Label>
      <NumberInput.Root size="sm" w="full" value={String(value)} min={min} max={max} step={step} disabled={disabled}
        onValueChange={(e) => Number.isFinite(e.valueAsNumber) && onChange(e.valueAsNumber)}>
        <NumberInput.Control />
        <InputGroup endElement={unit} endElementProps={{ me: "6", color: "fg.muted", fontSize: "xs", pointerEvents: "none" }}>
          <NumberInput.Input />
        </InputGroup>
      </NumberInput.Root>
    </Field.Root>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch.Root size="sm" checked={checked} disabled={disabled} onCheckedChange={(e) => onChange(e.checked)}>
      <Switch.HiddenInput />
      <Switch.Control />
      <Switch.Label>{label}</Switch.Label>
    </Switch.Root>
  );
}
