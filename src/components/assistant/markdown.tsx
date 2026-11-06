// The model's text → Chakra components. Light Markdown (paragraphs, lists, headings, quotes, tables, code) through
// react-markdown, with the references and in-app links turned into the things in chips.tsx and the ```ui blocks into cards.tsx.
//
// While an answer streams, remend closes whatever the last block has left open (a ** or a code fence). Every top-level
// block is its own memoized component, so the finished ones don't render again when the next delta arrives.
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";
import { Box, Code, Separator, Stack, Table, Text } from "@chakra-ui/react";

import { validateUrl } from "@/lib/nav/url-map";
import { UiBlock, UiPending } from "./cards";
import { TextLink, withRefs } from "./chips";
import { CodeBlock } from "./code-block";
import { fenceOf, splitBlocks } from "./tokens";

const heading = (props: { children?: React.ReactNode }) => <Text fontWeight="semibold" pt="1">{withRefs(props.children)}</Text>;
const list = { ps: "5", display: "flex", flexDirection: "column", gap: "1", "& ul, & ol": { mt: "1" } } as const;

const components: Components = {
  p: ({ children }) => <Text whiteSpace="pre-wrap">{withRefs(children)}</Text>,
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
  ul: ({ children }) => <Box asChild listStyleType="disc" {...list}><ul>{children}</ul></Box>,
  ol: ({ children, start }) => <Box asChild listStyleType="decimal" {...list}><ol start={start ?? undefined}>{children}</ol></Box>,
  li: ({ children }) => <Box as="li" css={{ "& > p + p, & > p + ul, & > p + ol": { marginTop: "6px" } }}>{withRefs(children)}</Box>,
  strong: ({ children }) => <Text as="strong" fontWeight="semibold">{withRefs(children)}</Text>,
  em: ({ children }) => <Text as="em">{withRefs(children)}</Text>,
  del: ({ children }) => <Text as="del">{children}</Text>,
  blockquote: ({ children }) => <Stack gap="2" borderStartWidth="2px" ps="3" color="fg.muted">{children}</Stack>,
  hr: () => <Separator />,
  // an in-app link only when url-map.json knows the path; anything else (external links included) is plain text
  a: ({ href, children }) => {
    const v = href ? validateUrl(href) : null;
    return v?.ok ? <TextLink to={v.url}>{children}</TextLink> : <>{children}</>;
  },
  table: ({ children }) => <Box overflowX="auto" borderWidth="1px" rounded="l3"><Table.Root size="sm" variant="line" showColumnBorder={false}>{children}</Table.Root></Box>,
  thead: ({ children }) => <Table.Header>{children}</Table.Header>,
  tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
  tr: ({ children }) => <Table.Row bg="transparent">{children}</Table.Row>,
  th: ({ children, style }) => <Table.ColumnHeader textStyle="xs" color="fg.muted" fontWeight="medium" px="3" py="1.5" whiteSpace="nowrap" style={style}>{withRefs(children)}</Table.ColumnHeader>,
  td: ({ children, style }) => <Table.Cell textStyle="xs" px="3" py="1.5" style={style}>{withRefs(children)}</Table.Cell>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? "");
    const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
    if (!lang && !text.includes("\n")) return <Code textStyle="xs">{children}</Code>;
    if (lang === "ui") return <UiBlock body={text} />;
    return <CodeBlock code={text} lang={lang} />;
  },
};

const plugins = [remarkGfm];

const Block = memo(function Block({ text, last, live }: { text: string; last: boolean; live: boolean }) {
  const fence = fenceOf(text);
  if (live && fence?.open && fence.lang === "ui") return <UiPending />;
  return (
    <Stack gap="3">
      <ReactMarkdown remarkPlugins={plugins} components={components}>{last ? remend(text) : text}</ReactMarkdown>
    </Stack>
  );
});

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = splitBlocks(text);
  return (
    <Stack gap="3" textStyle="sm" lineHeight="1.6" wordBreak="break-word">
      {blocks.map((b, n) => <Block key={n} text={b} last={n === blocks.length - 1} live={streaming && n === blocks.length - 1} />)}
    </Stack>
  );
}
