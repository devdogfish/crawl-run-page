"use client";

// The parts of a rule shown the same way everywhere (rule page, a page's issue): the one-line meta, and the
// guidance (why it matters, how to fix, references).
import NextLink from "next/link";
import { Badge, HStack, Heading, Icon, Link, Stack, Text } from "@chakra-ui/react";
import { LuChevronLeft, LuExternalLink } from "react-icons/lu";

import { SEVERITIES, type Rule } from "@/lib/page-issues";
import { PRIORITY } from "@/lib/priority";
import { CATEGORIES } from "@/lib/site-pages";

// "‹ Issues": the way back to the list, instead of a breadcrumb that repeats the title below it
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link asChild textStyle="sm" color="fg.muted" _hover={{ color: "fg" }} w="fit-content" mb="2" display="inline-flex" gap="0.5" alignItems="center">
      <NextLink href={href}><Icon as={LuChevronLeft} boxSize="4" />{children}</NextLink>
    </Link>
  );
}

// P1 badge + title on one line (P1 is Critical, P2 Serious, P3 Moderate, P4 Minor)
const PALETTE = { P1: "red", P2: "orange", P3: "gray", P4: "gray" } as const;
export function RuleTitle({ rule, size }: { rule: Rule; size: "md" | "lg" }) {
  const sev = SEVERITIES.find((x) => x.id === rule.severity)!;
  const prio = PRIORITY[rule.severity];
  return (
    <HStack gap="2.5" align="center">
      <Badge size={size === "lg" ? "md" : "sm"} variant="subtle" colorPalette={PALETTE[prio]} title={sev.label} flexShrink={0}>{prio}</Badge>
      <Heading size={size} fontWeight="semibold">{rule.title}</Heading>
    </HStack>
  );
}

// Accessibility · WCAG 4.1.2   (+ whatever the page adds)
export function RuleMeta({ rule, children }: { rule: Rule; children?: React.ReactNode }) {
  const cat = CATEGORIES.find((c) => c.id === rule.category)!.label;
  return (
    <HStack gap="1.5" textStyle="xs" color="fg.muted">
      <Text>{cat}{rule.criterion ? ` · WCAG ${rule.criterion.split(" ")[0]}` : ""}</Text>
      {children}
    </HStack>
  );
}

// Why it matters, how to fix (with `actions` right under it), references
export function RuleGuide({ rule, actions }: { rule: Rule; actions?: React.ReactNode }) {
  return (
    <Stack gap="5">
      <Stack gap="1"><Text textStyle="xs" fontWeight="medium" color="fg.muted">Why it matters</Text><Text textStyle="sm">{rule.why}</Text></Stack>
      <Stack gap="2">
        <Stack gap="1"><Text textStyle="xs" fontWeight="medium" color="fg.muted">How to fix</Text><Text textStyle="sm">{rule.howToFix}</Text></Stack>
        {actions}
      </Stack>
      {rule.refs.length > 0 && (
        <Stack gap="1">
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">References</Text>
          {rule.refs.map((x) => (
            <Link key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" textStyle="sm" color="fg.muted" _hover={{ color: "fg" }} w="fit-content">{x.label}<LuExternalLink /></Link>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
