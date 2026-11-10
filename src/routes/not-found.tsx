import { Link as RouterLink } from "react-router";
import { Box, Container, EmptyState, Link } from "@chakra-ui/react";

// Shown for an unknown site, section, rule or route (replaces Next's notFound()).
export function NotFound() {
  return (
    <Box>
      <Container maxW="7xl" pt="7">
        <EmptyState.Root mt="16">
          <EmptyState.Content>
            <EmptyState.Title>Page not found</EmptyState.Title>
            <EmptyState.Description><Link asChild><RouterLink to="/">Open demo</RouterLink></Link></EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Container>
    </Box>
  );
}
