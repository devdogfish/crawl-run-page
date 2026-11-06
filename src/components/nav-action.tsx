import { Children, createContext, useContext } from "react";
import { Button, type ButtonProps } from "@chakra-ui/react";

export const CompactNavActions = createContext(false);

// One visual treatment for the global toolbar actions.
export function NavAction(props: ButtonProps) {
  const compact = useContext(CompactNavActions);
  const children = Children.toArray(props.children);
  const label = props["aria-label"] ?? children.filter((child) => typeof child === "string").join("").trim();
  const compactProps: ButtonProps = compact ? { px: "0", minW: "9", w: "9", h: "9", gap: "0", "aria-label": label, title: label, children: children[0] } : {};
  return <Button size="sm" h="9" px="3" gap="2" variant="outline" colorPalette="gray"
    color="fg.muted" borderColor="border" bg="transparent" rounded="l2" fontWeight="medium"
    _hover={{ bg: "bg.muted", color: "fg" }} _expanded={{ bg: "bg.muted", color: "fg" }}
    css={{ "& > svg": { width: "4", height: "4", flexShrink: 0 } }} {...props} {...compactProps} />;
}
