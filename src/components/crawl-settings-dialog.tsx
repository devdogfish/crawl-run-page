"use client";

// Crawl settings, used in three modes:
//   create → everything editable ("New crawl" on /crawls)
//   paused → target + discovery locked, throughput editable (Settings while a crawl is paused)
//   view   → read-only (running or finished crawl)
import { useState } from "react";
import {
  Alert, Badge, Button, CloseButton, Dialog, Field, Grid, Group, HStack, Input, NativeSelect, NumberInput, Portal,
  Separator, Stack, Switch, Text,
} from "@chakra-ui/react";
import { LuLock } from "react-icons/lu";

import { DISCOVERY, ENVIRONMENTS, type CrawlSettings, type Discovery, type Environment } from "@/lib/settings";

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

function SettingsForm({ mode, initial, onSubmit, onClose }: {
  mode: SettingsMode; initial: CrawlSettings; onSubmit?: (s: CrawlSettings, opts: { resume: boolean }) => void; onClose: () => void;
}) {
  const [s, setS] = useState<CrawlSettings>(initial);
  const set = <K extends keyof CrawlSettings>(k: K, v: CrawlSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const lockedFixed = mode !== "create"; // target + discovery
  const lockedLive = mode === "view"; // throughput
  const changed = JSON.stringify(s) !== JSON.stringify(initial);

  return (
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{mode === "create" ? "New crawl" : "Crawl settings"}</Dialog.Title>
      </Dialog.Header>
      <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>

      <Dialog.Body>
        <Stack gap="6">
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

          <Section title="Target" locked={lockedFixed}>
            <Field.Root disabled={lockedFixed}>
              <Field.Label>Environment and URL</Field.Label>
              <Group attached w="full">
                <NativeSelect.Root size="sm" w="40" flexShrink={0} disabled={lockedFixed}>
                  <NativeSelect.Field
                    value={s.environment}
                    onChange={(e) => { const env = e.target.value as Environment; setS((x) => ({ ...x, environment: env, url: ENVIRONMENTS[env].url })); }}
                  >
                    {(Object.keys(ENVIRONMENTS) as Environment[]).map((env) => <option key={env} value={env}>{ENVIRONMENTS[env].label}</option>)}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <Input size="sm" value={s.url} onChange={(e) => set("url", e.target.value)} />
              </Group>
              <Field.HelperText>{lockedFixed ? "A crawl always keeps the site it started on. Start a new crawl to crawl another environment." : "Choosing an environment fills in its URL."}</Field.HelperText>
            </Field.Root>
          </Section>

          <Section title="Discovery" locked={lockedFixed}>
            <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="4">
              <Field.Root disabled={lockedFixed}>
                <Field.Label>Find pages from</Field.Label>
                <NativeSelect.Root size="sm" disabled={lockedFixed}>
                  <NativeSelect.Field value={s.discovery} onChange={(e) => set("discovery", e.target.value as Discovery)}>
                    {(Object.keys(DISCOVERY) as Discovery[]).map((d) => <option key={d} value={d}>{DISCOVERY[d]}</option>)}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
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

          <Section title="Throughput" note={mode === "create" ? undefined : "Editable while paused"} locked={lockedLive}>
            <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="4">
              <Num label="Request delay" unit="ms" help="Wait between requests, per worker" value={s.delayMs} min={0} max={10_000} step={50} disabled={lockedLive} onChange={(v) => set("delayMs", v)} />
              <Num label="Request timeout" unit="s" help="Give up on a request after this long" value={s.timeoutS} min={1} max={120} disabled={lockedLive} onChange={(v) => set("timeoutS", v)} />
              <Num label="Concurrency" unit="workers" help="Requests in flight at once" value={s.concurrency} min={1} max={256} disabled={lockedLive} onChange={(v) => set("concurrency", v)} />
              <Num label="Max retries" unit="per URL" help="For 5xx responses and timeouts" value={s.maxRetries} min={0} max={10} disabled={lockedLive} onChange={(v) => set("maxRetries", v)} />
              <Num label="Lighthouse sample" unit="pages" help="Audited after the crawl" value={s.lighthouseSample} min={10} max={2_000} step={10} disabled={lockedLive} onChange={(v) => set("lighthouseSample", v)} />
            </Grid>
          </Section>
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
  );
}

function Section({ title, note, locked, children }: { title: string; note?: string; locked: boolean; children: React.ReactNode }) {
  return (
    <Stack gap="3">
      <HStack gap="2">
        <Text textStyle="sm" fontWeight="semibold">{title}</Text>
        {locked ? <Badge size="sm" variant="subtle" colorPalette="gray"><LuLock />Locked</Badge>
          : note ? <Badge size="sm" variant="subtle" colorPalette="blue">{note}</Badge> : null}
      </HStack>
      <Separator />
      {children}
    </Stack>
  );
}

function Num({ label, unit, help, value, min, max, step = 1, disabled, onChange }: {
  label: string; unit: string; help: string; value: number; min: number; max: number; step?: number; disabled: boolean; onChange: (v: number) => void;
}) {
  return (
    <Field.Root disabled={disabled}>
      <Field.Label>{label} <Text as="span" color="fg.muted" fontWeight="normal">({unit})</Text></Field.Label>
      <NumberInput.Root size="sm" w="full" value={String(value)} min={min} max={max} step={step} disabled={disabled}
        onValueChange={(e) => Number.isFinite(e.valueAsNumber) && onChange(e.valueAsNumber)}>
        <NumberInput.Control />
        <NumberInput.Input />
      </NumberInput.Root>
      <Field.HelperText>{help}</Field.HelperText>
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
