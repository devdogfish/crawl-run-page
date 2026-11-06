// Small pieces shared by the assistant's parts.
import { useEffect, useRef, useState } from "react";
import { Box, Button, Collapsible, HStack, IconButton, type ButtonProps, type IconButtonProps } from "@chakra-ui/react";
import { LuCheck, LuChevronDown, LuCopy } from "react-icons/lu";

import { Tooltip } from "@/components/ui/tooltip";

// Copies text; `done` is true for a moment afterwards
export function useCopy(text: string) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1500);
  };
  return [done, copy] as const;
}

export function CopyIconButton({ text, label = "Copy", ...rest }: { text: string; label?: string } & Omit<IconButtonProps, "aria-label">) {
  const [done, copy] = useCopy(text);
  return (
    <Tooltip content={done ? "Copied" : label}>
      <IconButton size="2xs" variant="ghost" color="fg.muted" aria-label={label} onClick={copy} {...rest}>
        {done ? <LuCheck /> : <LuCopy />}
      </IconButton>
    </Tooltip>
  );
}

export function CopyTextButton({ text, ...rest }: { text: string } & ButtonProps) {
  const [done, copy] = useCopy(text);
  return (
    <Button size="2xs" variant="ghost" color="fg.muted" onClick={copy} {...rest}>
      {done ? <LuCheck /> : <LuCopy />}{done ? "Copied" : "Copy"}
    </Button>
  );
}

// A quiet toggle that unfolds more text
export function Folded({ label, children, align = "start" }: { label: string; children: React.ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <HStack as="button" gap="1" textStyle="xs" color="fg.muted" _hover={{ color: "fg" }} ms={align === "end" ? "auto" : undefined}>
          <Box transition="transform 0.15s" transform={open ? undefined : "rotate(-90deg)"} display="flex"><LuChevronDown /></Box>{label}
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content><Box mt="1.5">{children}</Box></Collapsible.Content>
    </Collapsible.Root>
  );
}
