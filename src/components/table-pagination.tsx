"use client";

// Footer pagination for every data panel (crawl history, pages, a crawl's pages tab).
// Chakra renders "…" as plain text; here each "…" opens a small "Go to page" box so any page is two clicks away.
import { useState } from "react";
import { Button, ButtonGroup, HStack, IconButton, Input, Pagination, Popover, Portal, Text } from "@chakra-ui/react";
import { LuChevronLeft, LuChevronRight, LuEllipsis } from "react-icons/lu";

export function TablePagination({ count, pageSize, page, onPageChange }: {
  count: number; pageSize: number; page: number; onPageChange: (page: number) => void;
}) {
  const total = Math.max(1, Math.ceil(count / pageSize));
  return (
    <Pagination.Root count={count} pageSize={pageSize} page={page} onPageChange={(e) => onPageChange(e.page)}>
      <HStack justify="space-between" px="3" py="2" borderTopWidth="1px" bg="bg.subtle">
        <Pagination.PageText format="long" textStyle="xs" color="fg.muted" fontVariantNumeric="tabular-nums" />
        <ButtonGroup variant="ghost" size="xs">
          <Pagination.PrevTrigger asChild><IconButton aria-label="Previous page"><LuChevronLeft /></IconButton></Pagination.PrevTrigger>
          <Pagination.Context>
            {({ pages }) => pages.map((p, k) => p.type === "ellipsis"
              ? <JumpToPage key={`e${k}`} total={total} onJump={onPageChange} />
              : (
                <Pagination.Item key={p.value} {...p} asChild>
                  <IconButton variant="ghost" color="fg.muted" _selected={{ bg: "bg.emphasized", color: "fg", fontWeight: "semibold" }}>{p.value}</IconButton>
                </Pagination.Item>
              ))}
          </Pagination.Context>
          <Pagination.NextTrigger asChild><IconButton aria-label="Next page"><LuChevronRight /></IconButton></Pagination.NextTrigger>
        </ButtonGroup>
      </HStack>
    </Pagination.Root>
  );
}

function JumpToPage({ total, onJump }: { total: number; onJump: (page: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= total;
  const go = () => { if (!valid) return; onJump(n); setOpen(false); setValue(""); };
  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: "top" }} size="xs" initialFocusEl={() => document.getElementById("jump-to-page")}>
      <Popover.Trigger asChild>
        <IconButton aria-label="Go to page" variant="ghost" color="fg.muted"><LuEllipsis /></IconButton>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content w="auto">
            <Popover.Body p="2">
              <HStack as="form" gap="2" onSubmit={(e) => { e.preventDefault(); go(); }}>
                <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">Go to page</Text>
                <Input id="jump-to-page" size="xs" w="16" inputMode="numeric" value={value} placeholder={`1–${total}`}
                  onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} aria-invalid={value !== "" && !valid} />
                <Button size="xs" type="submit" disabled={!valid}>Go</Button>
              </HStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
