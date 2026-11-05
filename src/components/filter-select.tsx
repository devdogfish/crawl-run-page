// Small styled dropdown used in table filter rows (xs, matches the toolbar). The first item is the "no filter" value;
// when another value is picked the trigger gets a stronger border so active filters stand out.
import { useMemo } from "react";
import { Portal, Select, Stack, Text, createListCollection } from "@chakra-ui/react";

export type Item = { value: string; label: string; hint?: string; mono?: boolean };

// Items are usually rebuilt on every render; keep the collection stable while their content is the same
export function useItems(items: Item[]) {
  const key = JSON.stringify(items);
  return useMemo(() => createListCollection({ items }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Filter dropdowns in the panel: Chakra Select (styled), xs to match the toolbar
export function FilterSelect({ value, onChange, items, w }: { value: string; onChange: (v: string) => void; items: Item[]; w: string }) {
  const collection = useItems(items);
  const on = value !== items[0].value; // the first item is the "no filter" value
  return (
    <Select.Root collection={collection} size="xs" w={w} value={[value]} onValueChange={(e) => e.value[0] && onChange(e.value[0])} positioning={{ sameWidth: false }}>
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger borderColor={on ? "border.emphasized" : undefined} bg={on ? "bg" : undefined} fontWeight={on ? "medium" : undefined}>
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content minW="56" maxH="80">
            {items.map((item) => (
              <Select.Item key={item.value} item={item}>
                <Stack gap="0" minW="0">
                  <Text>{item.label}</Text>
                  {item.hint && <Text textStyle="xs" color="fg.muted" fontFamily={item.mono || item.hint.startsWith("/") ? "mono" : undefined} truncate>{item.hint}</Text>}
                </Stack>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}
