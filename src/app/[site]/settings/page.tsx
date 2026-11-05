"use client";

// Settings, saved in this browser: theme (light / dark / system) and the navigation layout
// (prototype: pick one layout, then remove that control).
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Box, Button, Container, Heading, HStack, RadioCard, Separator, Stack, Text } from "@chakra-ui/react";
import { LuMonitor, LuMoon, LuSun } from "react-icons/lu";
import { DEFAULT_BRAND, LAYOUTS, applyBrand, savedBrand, useLayout, type Layout } from "@/components/app-shell";

const THEMES = [
  { value: "light", label: "Light", description: "Always light", icon: LuSun },
  { value: "dark", label: "Dark", description: "Always dark", icon: LuMoon },
  { value: "system", label: "System", description: "Follow this device", icon: LuMonitor },
];

const BRANDS = [
  { value: "#005daa", label: "Blue" }, { value: "#0f766e", label: "Teal" }, { value: "#6d28d9", label: "Violet" },
  { value: "#be123c", label: "Crimson" }, { value: "#c2410c", label: "Orange" }, { value: "#334155", label: "Slate" },
];

export default function SettingsPage() {
  const { layout, setLayout } = useLayout();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false); // the saved theme is only known in the browser
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  useEffect(() => { setMounted(true); setBrand(savedBrand()); }, []);
  const chooseBrand = (hex: string) => { setBrand(hex); applyBrand(hex); };

  return (
    <Box>
      <Container maxW="7xl" pt="7" pb="16">
        <Heading size="xl" fontWeight="semibold">Settings</Heading>
        <Separator mt="6" />
        <Row title="Theme" help="Saved in this browser.">
          <Choices value={mounted ? theme ?? "system" : undefined} onChange={setTheme} items={THEMES} />
        </Row>
        <Separator />
        <Row title="Primary color" help="Buttons, switches, links and focus rings. Saved in this browser.">
          <HStack gap="3" wrap="wrap">
            {BRANDS.map((b) => (
              <Box key={b.value} as="button" aria-label={b.label} title={b.label} onClick={() => chooseBrand(b.value)}
                boxSize="8" rounded="full" bg={b.value} borderWidth="2px" borderColor="bg"
                outlineWidth="2px" outlineStyle="solid" outlineColor={brand.toLowerCase() === b.value ? "fg" : "transparent"} cursor="pointer" />
            ))}
            <input type="color" aria-label="Custom color" value={brand} onChange={(e) => chooseBrand(e.target.value)}
              style={{ width: 32, height: 32, padding: 0, border: 0, background: "none", cursor: "pointer" }} />
            <Text textStyle="sm" color="fg.muted" fontFamily="mono">{brand.toUpperCase()}</Text>
            {brand.toLowerCase() !== DEFAULT_BRAND && <Button size="xs" variant="ghost" onClick={() => chooseBrand(DEFAULT_BRAND)}>Reset</Button>}
          </HStack>
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
