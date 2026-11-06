// "New rule": a custom check the crawler runs on every page's stored HTML.
// Fields: name, where to look, what to look for (found or missing, text or regex), description.
import { useRef, useState } from "react";
import {
  Button, Checkbox, CloseButton, Dialog, Field, Input, InputGroup, Portal, RadioCard, SegmentGroup, Stack, Text, Textarea,
} from "@chakra-ui/react";

import { RuleAiWindow, type RuleDraft } from "./rule-ai-window";
import { SCOPES, patternError, type CustomRule, type Scope } from "@/lib/custom-rules";

export function RuleDialog({ open, onOpenChange, onCreate, rule }: { rule?: CustomRule; open: boolean; onOpenChange: (o: boolean) => void; onCreate: (r: CustomRule) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="lg" placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          {open && <RuleForm rule={rule} onCreate={(r) => { onCreate(r); onOpenChange(false); }} onClose={() => onOpenChange(false)} />}
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function RuleForm({ onCreate, onClose, rule }: { rule?: CustomRule; onCreate: (r: CustomRule) => void; onClose: () => void }) {
  const panelHost = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(rule?.name ?? "");
  const [scope, setScope] = useState<Scope>(rule?.scope ?? "content");
  const [when, setWhen] = useState<CustomRule["when"]>(rule?.when ?? "found");
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [regex, setRegex] = useState(rule?.regex ?? false);
  const [matchCase, setMatchCase] = useState(rule?.matchCase ?? false);
  const [description, setDescription] = useState(rule?.howToFix ?? "");
  const [tried, setTried] = useState(false);

  const err = patternError(pattern, regex);
  const nameErr = name.trim() ? null : "Give the rule a name.";
  const submit = () => {
    setTried(true);
    if (err || nameErr) return;
    onCreate({ id: rule?.id ?? `custom-${crypto.randomUUID()}`, name: name.trim(), scope, when, pattern, regex, matchCase, type: rule?.type ?? "all", priority: rule?.priority ?? "P3", category: rule?.category ?? "seo", howToFix: description.trim() });
  };

  return (
    <Dialog.Content ref={panelHost}>
      <Dialog.Header><Dialog.Title>{rule ? "Edit rule" : "New rule"}</Dialog.Title></Dialog.Header>
      <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>
      <Dialog.Body>
        <Stack gap="5">
          <Field.Root invalid={tried && !!nameErr}>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mentions the old brand name" autoFocus />
            {tried && nameErr && <Field.ErrorText>{nameErr}</Field.ErrorText>}
          </Field.Root>

          <Stack gap="4">
            <Stack gap="2">
              <Field.Root invalid={tried && !!err}>
                <InputGroup endElement={
                <RuleAiWindow portalRef={panelHost} current={{ name, pattern, scope, when, regex, matchCase, description }} onApply={(fields, original) => {
                  // Preserve edits made while the AI request was in flight.
                  const apply = <K extends keyof RuleDraft>(key: K, setter: React.Dispatch<React.SetStateAction<RuleDraft[K]>>) => {
                    const value = fields[key];
                    if (value !== undefined) setter((latest) => latest === original[key] ? value : latest);
                  };
                  apply("name", setName); apply("pattern", setPattern); apply("scope", setScope);
                  apply("when", setWhen); apply("regex", setRegex); apply("matchCase", setMatchCase); apply("description", setDescription);
                }} />
                } endElementProps={{ px: "1" }}>
                  <Input pe="28" aria-label="Text or pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} fontFamily={regex ? "mono" : undefined}
                    placeholder={regex ? "RBC Capital Markets? Inc\\." : "Dominion Securities"} />
                </InputGroup>
                {tried && err && <Field.ErrorText>{err}</Field.ErrorText>}
              </Field.Root>
            </Stack>
            <Stack direction={{ base: "column", sm: "row" }} gap="4" columnGap="6">
              <Checkbox.Root size="sm" checked={regex} onCheckedChange={(e) => setRegex(!!e.checked)}>
                <Checkbox.HiddenInput /><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Label>Regular expression</Checkbox.Label>
              </Checkbox.Root>
              <Checkbox.Root size="sm" checked={matchCase} onCheckedChange={(e) => setMatchCase(!!e.checked)}>
                <Checkbox.HiddenInput /><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Label>Match case</Checkbox.Label>
              </Checkbox.Root>
            </Stack>
          </Stack>

            <Stack gap="3">
              <Text textStyle="sm" fontWeight="medium">Flag the page when this text is</Text>
              <SegmentGroup.Root aria-label="Flag when" size="sm" alignSelf="flex-start" value={when} onValueChange={(e) => e.value && setWhen(e.value as CustomRule["when"])}>
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={[{ value: "found", label: "Found" }, { value: "missing", label: "Missing" }]} />
              </SegmentGroup.Root>
            </Stack>

          <Stack gap="3">
            <Text textStyle="sm" fontWeight="medium">Where to look</Text>
            <RadioCard.Root aria-label="Where to look" size="sm" w="full" value={scope} onValueChange={(e) => e.value && setScope(e.value as Scope)}>
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
          </Stack>

          <Field.Root>
            <Field.Label>Description <Text as="span" color="fg.muted" fontWeight="normal">(optional)</Text></Field.Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Describe what this rule checks and why it matters." />
          </Field.Root>

        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>{rule ? "Save changes" : "Create rule"}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
