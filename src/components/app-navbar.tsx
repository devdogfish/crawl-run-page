"use client";

// App-wide top bar: logo on the left, New crawl on the right.
import { useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Box, Button, Container, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuPlus, LuWaypoints } from "react-icons/lu";

import { CrawlSettingsDialog } from "@/components/crawl-settings-dialog";
import { DEFAULT_SETTINGS } from "@/lib/settings";

export function AppNavbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg/90" backdropFilter="blur(8px)" borderBottomWidth="1px">
      <Container maxW="7xl">
        <Flex h="14" align="center" gap="4">
          <HStack asChild gap="2">
            <NextLink href="/crawls" aria-label="Crawler home">
              <Flex boxSize="7" rounded="l2" bg="fg" color="bg" align="center" justify="center">
                <Icon as={LuWaypoints} boxSize="4" />
              </Flex>
              <Text fontWeight="semibold" letterSpacing="tight">Crawler</Text>
            </NextLink>
          </HStack>
          <Button size="sm" ms="auto" onClick={() => setOpen(true)}><LuPlus />New crawl</Button>
        </Flex>
      </Container>
      <CrawlSettingsDialog
        open={open} onOpenChange={setOpen} mode="create" initial={DEFAULT_SETTINGS}
        onSubmit={(s) => router.push(`/crawls/813?settings=${encodeURIComponent(JSON.stringify(s))}`)}
      />
    </Box>
  );
}
