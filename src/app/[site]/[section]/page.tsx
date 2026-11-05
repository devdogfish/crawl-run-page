"use client";

// Placeholder for sections that aren't part of this prototype yet (Schedules, Reports, Settings),
// so both navigation layouts can be clicked through. /[site]/crawls is a real route and takes precedence.
import { notFound, useParams } from "next/navigation";
import { Box, Container, EmptyState, Heading, Icon } from "@chakra-ui/react";
import { SECTIONS } from "@/components/app-navbar";

export default function SectionPlaceholder() {
  const { section } = useParams<{ section: string }>();
  const s = SECTIONS.find((x) => x.id === section);
  if (!s) notFound();
  return (
    <Box>
      <Container maxW="7xl" pt="7">
        <Heading size="xl" fontWeight="semibold">{s.label}</Heading>
        <EmptyState.Root mt="16">
          <EmptyState.Content>
            <EmptyState.Indicator><Icon as={s.icon} /></EmptyState.Indicator>
            <EmptyState.Title>{s.label} isn&apos;t part of this prototype</EmptyState.Title>
            <EmptyState.Description>It&apos;s here so you can try the navigation.</EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Container>
    </Box>
  );
}
