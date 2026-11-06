import { Button, type ButtonProps } from "@chakra-ui/react";

// One visual treatment for the global toolbar actions.
export function NavAction(props: ButtonProps) {
  return <Button size="sm" h="9" px="3" gap="2" variant="outline" colorPalette="gray"
    color="fg.muted" borderColor="border" bg="transparent" rounded="l2" fontWeight="medium"
    _hover={{ bg: "bg.muted", color: "fg" }} _expanded={{ bg: "bg.muted", color: "fg" }}
    css={{ "& > svg": { width: "4", height: "4", flexShrink: 0 } }} {...props} />;
}
