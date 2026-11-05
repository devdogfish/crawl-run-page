// Chakra theme: the default system plus one brand palette, used as the app-wide default colorPalette.
// The palette is derived from one CSS variable (--brand, default RBC blue) so Settings can change it at runtime.
// Solid buttons, switches, radio cards and focus rings pick it up; anything that sets its own colorPalette
// (status badges, Lighthouse colours) is unchanged.
import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: { html: { colorPalette: "brand", "--brand": "#005daa" } },
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "color-mix(in srgb, var(--brand) 10%, white)" }, 100: { value: "color-mix(in srgb, var(--brand) 22%, white)" }, 200: { value: "color-mix(in srgb, var(--brand) 40%, white)" }, 300: { value: "color-mix(in srgb, var(--brand) 60%, white)" }, 400: { value: "color-mix(in srgb, var(--brand) 80%, white)" },
          500: { value: "var(--brand)" },
          600: { value: "color-mix(in srgb, var(--brand) 85%, black)" }, 700: { value: "color-mix(in srgb, var(--brand) 68%, black)" }, 800: { value: "color-mix(in srgb, var(--brand) 50%, black)" }, 900: { value: "color-mix(in srgb, var(--brand) 32%, black)" }, 950: { value: "color-mix(in srgb, var(--brand) 20%, black)" },
        },
      },
    },
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
          contrast: { value: "white" },
          fg: { value: { _light: "{colors.brand.600}", _dark: "{colors.brand.300}" } },
          muted: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.900}" } },
          subtle: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
          emphasized: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.800}" } },
          focusRing: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
          border: { value: { _light: "{colors.brand.300}", _dark: "{colors.brand.700}" } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
