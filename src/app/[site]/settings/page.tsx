"use client";

// Settings, saved in this browser: theme (light / dark / system), issue priority (P1–P4 per severity)
// and the navigation layout (prototype: pick one layout, then remove that control).
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Box, Container, HStack, Heading, RadioCard, Separator, Stack, Text } from "@chakra-ui/react";
import { LuMonitor, LuMoon, LuSun } from "react-icons/lu";
import { LAYOUTS, useLayout, type Layout } from "@/components/app-shell";
import { FilterSelect } from "@/components/filter-select";
import { SEVERITIES, type Severity } from "@/lib/page-issues";
import { PRIORITIES, setPriority, usePriorityMap, type Priority } from "@/lib/priority";

const THEMES = [
  { value: "light", label: "Light", description: "Always light", icon: LuSun },
  { value: "dark", label: "Dark", description: "Always dark", icon: LuMoon },
  { value: "system", label: "System", description: "Follow this device", icon: LuMonitor },
];

export default function SettingsPage() {
  const { layout, setLayout } = useLayout();
  const { theme, setTheme } = useTheme();
  const pmap = usePriorityMap();
  const [mounted, setMounted] = useState(false); // the saved theme is only known in the browser
  useEffect(() => setMounted(true), []);

  return (
    <Box>
      <Container maxW="7xl" pt="7" pb="16">
        <Heading size="xl" fontWeight="semibold">Settings</Heading>
        <Separator mt="6" />
        <Row title="Theme" help="Saved in this browser.">
          <Choices value={mounted ? theme ?? "system" : undefined} onChange={setTheme} items={THEMES} />
        </Row>
        <Separator />
        <Row title="Issue priority" help="How each severity maps to your team's priorities. Shown on issues and used by filters and exports.">
          <Stack gap="2" maxW="sm">
            {SEVERITIES.map((sv) => (
              <HStack key={sv.id} justify="space-between">
                <HStack gap="2"><Box w="2" h="2" rounded="full" bg={`${sv.color}.solid`} /><Text textStyle="sm">{sv.label}</Text></HStack>
                <FilterSelect w="24" value={pmap[sv.id]} onChange={(v) => setPriority(sv.id as Severity, v as Priority)}
                  items={PRIORITIES.map((p) => ({ value: p, label: p }))} />
              </HStack>
            ))}
          </Stack>
        </Row>
        <Separator />
        <Row title="Navigation layout" help="Saved in this browser.">
          <Choices value={layout} onChange={(v) => setLayout(v as Layout)} items={LAYOUTS} />
        </Row>
        <Separator />
      </Container>
    </Box>
  );
}

function Row({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <Stack direction={{ base: "column", md: "row" }} gap={{ base: "4", md: "10" }} py="6">
      <Box w={{ md: "64" }} flexShrink={0}>
        <Text textStyle="sm" fontWeight="medium">{title}</Text>
        <Text textStyle="sm" color="fg.muted" mt="1">{help}</Text>
      </Box>
      <Box flex="1" maxW="3xl">{children}</Box>
    </Stack>
  );
}

function Choices({ value, onChange, items }: {
  value: string | undefined; onChange: (v: string) => void;
  items: { value: string; label: string; description: string; icon?: React.ElementType }[];
}) {
  return (
    <RadioCard.Root size="sm" value={value ?? null} onValueChange={(e) => e.value && onChange(e.value)}>
      <Stack direction={{ base: "column", sm: "row" }} gap="3">
        {items.map((it) => (
          <RadioCard.Item key={it.value} value={it.value} flex="1">
            <RadioCard.ItemHiddenInput />
            <RadioCard.ItemControl>
              <RadioCard.ItemContent>
                {it.icon && <Box color="fg.muted" mb="1"><it.icon /></Box>}
                <RadioCard.ItemText>{it.label}</RadioCard.ItemText>
                <RadioCard.ItemDescription>{it.description}</RadioCard.ItemDescription>
              </RadioCard.ItemContent>
              <RadioCard.ItemIndicator />
            </RadioCard.ItemControl>
          </RadioCard.Item>
        ))}
      </Stack>
    </RadioCard.Root>
  );
}
