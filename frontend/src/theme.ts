// Design tokens filled from /app/design_guidelines.json (iOS-Native Clean, green brand).
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#F2F2F7",
  onSurface: "#000000",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#000000",
  surfaceTertiary: "#E5E5EA",
  onSurfaceTertiary: "#000000",
  surfaceInverse: "#1C1C1E",
  onSurfaceInverse: "#FFFFFF",
  muted: "#8E8E93",

  brand: "#248A3D",
  onBrand: "#FFFFFF",
  brandPrimary: "#248A3D",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#1A642B",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E4F3E8",
  onBrandTertiary: "#1A642B",

  success: "#34C759",
  onSuccess: "#FFFFFF",
  warning: "#FF9500",
  onWarning: "#FFFFFF",
  error: "#FF3B30",
  onError: "#FFFFFF",
  info: "#6B7280",
  onInfo: "#FFFFFF",

  border: "#C6C6C8",
  borderStrong: "#AEAEB2",
  divider: "#E5E5EA",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};
