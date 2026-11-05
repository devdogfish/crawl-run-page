// "New rule": a custom check the crawler runs on every page's stored HTML.
// Fields: name, where to look, what to look for (found or missing, text or regex), which pages, priority, category, how to fix.
import { useState } from "react";
import {
  Button, Checkbox, CloseButton, Dialog, Field, Grid, Input, NativeSelect, Portal, RadioCard, SegmentGroup, Stack, Text, Textarea,
} from "@chakra-ui/react";

import { SCOPES, patternError, type CustomRule, type Scope } from "@/lib/custom-rules";
import { PRIORITIES, type Priority } from "@/lib/priority";
import { CATEGORIES, PAGE_TYPES } from "@/lib/site-pages";

export function RuleDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (r: CustomRule) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="lg" placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          {open && <RuleForm onCreate={(r) => { onCreate(r); onOpenChange(false); }} onClose={() => onOpenChange(false)} />}
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function RuleForm({ onCreate, onClose }: { onCreate: (r: CustomRule) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("content");
  const [when, setWhen] = useState<CustomRule["when"]>("found");
  const [pattern, setPattern] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState<Priority>("P3");
  const [category, setCategory] = useState("seo");
  const [howToFix, setHowToFix] = useState("");
  const [tried, setTried] = useState(false);

  const err = patternError(pattern, regex);
  const nameErr = name.trim() ? null : "Give the rule a name.";
  const submit = () => {
    setTried(true);
    if (err || nameErr) return;
    onCreate({ id: `custom-${Date.now().toString(36)}`, name: name.trim(), scope, when, pattern, regex, matchCase, type, priority, category, howToFix: howToFix.trim() });
  };

  return (
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>New rule</Dialog.Title></Dialog.Header>
      <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>
      <Dialog.Body>
        <Stack gap="5">
          <Field.Root invalid={tried && !!nameErr}>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mentions the old brand name" autoFocus />
            {tried && nameErr && <Field.ErrorText>{nameErr}</Field.ErrorText>}
          </Field.Root>

          <Field.Root>
            <Field.Label>Where to look</Field.Label>
            <RadioCard.Root size="sm" w="full" value={scope} onValueChange={(e) => e.value && setScope(e.value as Scope)}>
              <Stack gap="2">
                {SCOPES.map((o) => (
                  <RadioCard.Item key={o.value} value={o.value}>
                    <RadioCard.ItemHiddenInput />
                    <RadioCard.ItemControl>
                      <RadioCard.ItemContent>
                        <RadioCard.ItemText>{o.label}</RadioCard.ItemText>
                        <RadioCard.ItemDescription>{o.description}</RadioCard.ItemDescription>
                      </RadioCard.ItemContent>
                      <RadioCard.ItemIndicator />
                    </RadioCard.ItemControl>
                  </RadioCard.Item>
                ))}
              </Stack>
            </RadioCard.Root>
          </Field.Root>

          <Field.Root invalid={tried && !!err}>
            <Field.Label>Flag the page when this text is</Field.Label>
            <SegmentGroup.Root size="sm" value={when} onValueChange={(e) => e.value && setWhen(e.value as CustomRule["when"])}>
              <SegmentGroup.Indicator />
              <SegmentGroup.Items items={[{ value: "found", label: "Found" }, { value: "missing", label: "Missing" }]} />
            </SegmentGroup.Root>
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} fontFamily={regex ? "mono" : undefined}
              placeholder={regex ? "RBC Capital Markets? Inc\\." : "Dominion Securities"} />
            {tried && err && <Field.ErrorText>{err}</Field.ErrorText>}
            <Stack direction="row" gap="5" mt="1">
              <Checkbox.Root size="sm" checked={regex} onCheckedChange={(e) => setRegex(!!e.checked)}>
                <Checkbox.HiddenInput /><Checkbox.Control /><Checkbox.Label>Regular expression</Checkbox.Label>
              </Checkbox.Root>
              <Checkbox.Root size="sm" checked={matchCase} onCheckedChange={(e) => setMatchCase(!!e.checked)}>
                <Checkbox.HiddenInput /><Checkbox.Control /><Checkbox.Label>Match case</Checkbox.Label>
              </Checkbox.Root>
            </Stack>
          </Field.Root>

          <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="4">
            <Field.Root>
              <Field.Label>Pages</Field.Label>
              <NativeSelect.Root size="sm"><NativeSelect.Field value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">All page types</option>
                {PAGE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label>Category</Field.Label>
              <NativeSelect.Root size="sm"><NativeSelect.Field value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root>
            </Field.Root>
          </Grid>

          <Field.Root>
            <Field.Label>Priority</Field.Label>
            <SegmentGroup.Root size="sm" value={priority} onValueChange={(e) => e.value && setPriority(e.value as Priority)}>
              <SegmentGroup.Indicator />
              <SegmentGroup.Items items={PRIORITIES.map((p) => ({ value: p, label: p }))} />
            </SegmentGroup.Root>
          </Field.Root>

          <Field.Root>
            <Field.Label>How to fix <Text as="span" color="fg.muted" fontWeight="normal">(optional)</Text></Field.Label>
            <Textarea value={howToFix} onChange={(e) => setHowToFix(e.target.value)} rows={3} placeholder="Shown on each issue and included in prompts." />
          </Field.Root>

          <Text textStyle="xs" color="fg.muted">Runs on the next crawl. Earlier crawls aren&apos;t checked again.</Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>Create rule</Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
