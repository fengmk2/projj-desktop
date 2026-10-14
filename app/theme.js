import { set_theme } from "gpui-base";
export function applyTheme(dark) {
  /** @type {import("gpui-base").ColorTokens} */
  const colors = dark
    ? {
        background: "#191b1e",
        foreground: "#eeeae4",
        surface: "#202226",
        surface_foreground: "#eeeae4",
        primary: "#ec9b70",
        primary_foreground: "#21180f",
        secondary: "#2b2d31",
        secondary_foreground: "#eeeae4",
        muted: "#24262a",
        muted_foreground: "#9e9d9b",
        accent: "#382b24",
        accent_foreground: "#efb591",
        destructive: "#df6b65",
        destructive_foreground: "#ffffff",
        border: "#36383c",
        input: "#44464a",
        ring: "#ec9b70",
        selection: "#63432e",
      }
    : {
        background: "#ffffff",
        foreground: "#252a32",
        surface: "#f7f8fa",
        surface_foreground: "#252a32",
        primary: "#ac542c",
        primary_foreground: "#ffffff",
        secondary: "#f0f2f5",
        secondary_foreground: "#252a32",
        muted: "#f6f7f9",
        muted_foreground: "#747c89",
        accent: "#f9eee7",
        accent_foreground: "#994823",
        destructive: "#c04740",
        destructive_foreground: "#ffffff",
        border: "#e6e8ed",
        input: "#d9dde5",
        ring: "#bc704b",
        selection: "#f4ddca",
      };
  set_theme({
    appearance: dark ? "dark" : "light",
    tokens: {
      colors,
      spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
      radius: { none: 0, sm: 4, md: 7, lg: 10, xl: 14, full: 9999 },
      typography: {
        sans: ".AppleSystemUIFont",
        mono: "Menlo",
        md: { size: 14 },
        sm: { size: 13 },
        xs: { size: 12 },
      },
    },
  });
}
