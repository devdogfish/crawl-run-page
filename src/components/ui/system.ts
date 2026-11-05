// Chakra theme: the default system plus one brand palette (RBC blue), used as the app-wide default colorPalette.
// Solid buttons, switches, radio cards and focus rings pick it up; anything that sets its own colorPalette
// (status badges, Lighthouse colours) is unchanged.
import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: { html: { colorPalette: "brand" } },
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#e8f1fa" }, 100: { value: "#c9ddf2" }, 200: { value: "#9cc3e8" }, 300: { value: "#64a2db" }, 400: { value: "#2f80cc" },
          500: { value: "#005daa" }, 600: { value: "#004f91" }, 700: { value: "#003f74" }, 800: { value: "#002f57" }, 900: { value: "#00213d" }, 950: { value: "#00162a" },
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
