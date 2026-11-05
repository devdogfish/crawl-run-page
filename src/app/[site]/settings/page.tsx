"use client";

// Settings. For now it only holds the navigation layout choice (prototype: pick one, then remove this).
import { Box, Container, Heading, RadioCard, Separator, Stack, Text } from "@chakra-ui/react";
import { LAYOUTS, useLayout, type Layout } from "@/components/app-shell";

export default function SettingsPage() {
  const { layout, setLayout } = useLayout();
  return (
    <Box>
      <Container maxW="7xl" pt="7" pb="16">
        <Heading size="xl" fontWeight="semibold">Settings</Heading>
        <Separator mt="6" />
        <Stack direction={{ base: "column", md: "row" }} gap={{ base: "4", md: "10" }} py="6">
          <Box w={{ md: "64" }} flexShrink={0}>
            <Text textStyle="sm" fontWeight="medium">Navigation layout</Text>
            <Text textStyle="sm" color="fg.muted" mt="1">Saved in this browser.</Text>
          </Box>
          <RadioCard.Root size="sm" value={layout} onValueChange={(e) => e.value && setLayout(e.value as Layout)} flex="1" maxW="3xl">
            <Stack direction={{ base: "column", sm: "row" }} gap="3">
              {LAYOUTS.map((l) => (
                <RadioCard.Item key={l.value} value={l.value} flex="1">
                  <RadioCard.ItemHiddenInput />
                  <RadioCard.ItemControl>
                    <RadioCard.ItemContent>
                      <RadioCard.ItemText>{l.label}</RadioCard.ItemText>
                      <RadioCard.ItemDescription>{l.description}</RadioCard.ItemDescription>
                    </RadioCard.ItemContent>
                    <RadioCard.ItemIndicator />
                  </RadioCard.ItemControl>
                </RadioCard.Item>
              ))}
            </Stack>
          </RadioCard.Root>
        </Stack>
        <Separator />
      </Container>
    </Box>
  );
}
