"use client";

// One toolbar for every data panel (logs, pages): search · filter segments · count · copy · download
import { useState } from "react";
import { HStack, IconButton, Input, InputGroup, SegmentGroup, Text } from "@chakra-ui/react";
import { LuCheck, LuCopy, LuDownload, LuSearch, LuX } from "react-icons/lu";
import { Tooltip } from "@/components/ui/tooltip";

export function DataToolbar<V extends string>({
  query, onQuery, placeholder, segments, value, onValue, count, copyLabel, onCopy, downloadLabel, onDownload,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  segments: { value: V; label: string }[];
  value: V;
  onValue: (v: V) => void;
  count: string;
  copyLabel: string;
  onCopy: () => Promise<void> | void;
  downloadLabel: string;
  onDownload: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <HStack gap="2" px="2" py="1.5" borderBottomWidth="1px" bg="bg.subtle" wrap="wrap">
      <InputGroup
        flex="1" minW="40" maxW="72" startElement={<LuSearch />}
        endElement={query ? <IconButton aria-label="Clear search" size="2xs" variant="ghost" onClick={() => onQuery("")}><LuX /></IconButton> : undefined}
      >
        <Input size="xs" placeholder={placeholder} value={query} onChange={(e) => onQuery(e.target.value)} />
      </InputGroup>
      <SegmentGroup.Root size="sm" css={{ "& [data-part=item]": { fontSize: "xs" } }} value={value} onValueChange={(e) => onValue(e.value as V)}>
        <SegmentGroup.Indicator />
        <SegmentGroup.Items items={segments} />
      </SegmentGroup.Root>
      <Text textStyle="xs" color="fg.muted" ms="auto" fontVariantNumeric="tabular-nums" whiteSpace="nowrap">{count}</Text>
      <Tooltip content={copyLabel}>
        <IconButton aria-label="Copy" size="xs" variant="ghost" onClick={copy}>{copied ? <LuCheck /> : <LuCopy />}</IconButton>
      </Tooltip>
      <Tooltip content={downloadLabel}>
        <IconButton aria-label="Download" size="xs" variant="ghost" onClick={onDownload}><LuDownload /></IconButton>
      </Tooltip>
    </HStack>
  );
}

export function downloadText(text: string, fileName: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
}
