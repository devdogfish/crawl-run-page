import { Children, createContext, useContext } from "react";
import { Button, type ButtonProps } from "@chakra-ui/react";

export const CompactNavActions = createContext<boolean | "container">(false);

// One visual treatment for the global toolbar actions.
export function NavAction(props: ButtonProps) {
  const compact = useContext(CompactNavActions);
  const children = Children.toArray(props.children);
  const label = props["aria-label"] ?? children.filter((child) => typeof child === "string").join("").trim();
  const compactProps: ButtonProps = compact === true ? { px: "0", minW: "9", w: "9", h: "9", gap: "0", "aria-label": label, title: label, children: children[0] } : {};
  const responsive = compact === "container";
  return <Button size="sm" h="9" px="3" gap="2" variant="outline" colorPalette="gray"
    color="fg.muted" borderColor="border" bg="transparent" rounded="l2" fontWeight="medium"
    _hover={{ bg: "bg.muted", color: "fg" }} _expanded={{ bg: "bg.muted", color: "fg" }}
    css={{ "& > .nav-label": { display: "contents" }, "& > svg": { width: "4", height: "4", flexShrink: 0 }, ...(responsive ? {
      "@container navbar (max-width: 1035px)": { paddingInline: "0", minWidth: "9", width: "9", gap: "0", "& > .nav-label": { display: "none" } },
    } : {}) }} {...props} {...compactProps}
    {...(responsive ? { "aria-label": label, title: label, children: <>{children[0]}<span className="nav-label">{children.slice(1)}</span></> } : {})} />;
}
