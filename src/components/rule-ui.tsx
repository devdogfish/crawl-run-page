// The parts of a rule shown the same way everywhere (rule page, a page's issue): the one-line meta, and the
// guidance (why it matters, how to fix, references).
import { Fragment } from "react";
import { Link as RouterLink } from "react-router";
import { Badge, HStack, Heading, Icon, Link, Stack, Text } from "@chakra-ui/react";
import { LuChevronLeft } from "react-icons/lu";

import { SEVERITIES, type Rule } from "@/lib/page-issues";
import { PRIORITY } from "@/lib/priority";
import { CATEGORIES } from "@/lib/site-pages";

// "‹ Issues": the way back to the list, instead of a breadcrumb that repeats the title below it
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link asChild textStyle="sm" color="fg.muted" _hover={{ color: "fg" }} w="fit-content" mb="2" display="inline-flex" gap="0.5" alignItems="center">
      <RouterLink to={href}><Icon as={LuChevronLeft} boxSize="4" />{children}</RouterLink>
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
    <Stack gap="4">
      <Stack gap="1.5">
        <Text textStyle="sm" fontWeight="medium">Why it matters</Text>
        <Text textStyle="sm" lineHeight="1.6">{rule.why}</Text>
      </Stack>
      <Stack gap="3">
        <Stack gap="1.5">
          <Text textStyle="sm" fontWeight="medium">How to fix</Text>
          <Text textStyle="sm" lineHeight="1.6">
            {rule.howToFix}
            {rule.refs.length > 0 && <> See {rule.refs.map((ref, index) => (
              <Fragment key={ref.url}>
                {index > 0 && (index === rule.refs.length - 1 ? " and " : ", ")}
                <Link href={ref.url} target="_blank" rel="noopener noreferrer" display="inline" color="brand.fg" textDecoration="none" textUnderlineOffset="3px" _hover={{ textDecoration: "underline" }}>{ref.label}</Link>
              </Fragment>
            ))}.</>}
          </Text>
        </Stack>
        {actions}
      </Stack>
    </Stack>
  );
}
