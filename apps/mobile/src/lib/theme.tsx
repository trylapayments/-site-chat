import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { storage } from "./storage";
export type ThemeMode = "system" | "light" | "dark";
export const lightColors = {
  ink: "#10243A",
  muted: "#73869F",
  blue: "#0866FF",
  pale: "#EAF1FF",
  canvas: "#F7FAFF",
  line: "#E7EDF5",
  green: "#12A99A",
  surface: "#FFFFFF",
  input: "#F0F5FC",
  note: "#FFF8E5",
  error: "#FFF0F0",
  danger: "#B73C4B",
  avatar: "#E9F1FF",
};
export type Palette = typeof lightColors;
const darkColors: Palette = {
  ink: "#EFF5FE",
  muted: "#9AAFC6",
  blue: "#79A7FF",
  pale: "#1D3354",
  canvas: "#0C1523",
  line: "#27374C",
  green: "#39CABB",
  surface: "#152235",
  input: "#1B2B40",
  note: "#332D20",
  error: "#38202A",
  danger: "#FFA1AA",
  avatar: "#243753",
};
const Context = createContext({
  colors: lightColors,
  mode: "system" as ThemeMode,
  dark: false,
  setMode: (() => {}) as (mode: ThemeMode) => void,
});
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, updateMode] = useState<ThemeMode>("system");
  useEffect(() => {
    void storage.getItem("mill.appearance").then((value) => {
      if (value === "light" || value === "dark") updateMode(value);
    });
  }, []);
  const dark = mode === "dark" || (mode === "system" && system === "dark");
  const value = useMemo(
    () => ({
      colors: dark ? darkColors : lightColors,
      mode,
      dark,
      setMode: (next: ThemeMode) => {
        updateMode(next);
        void storage.setItem("mill.appearance", next);
      },
    }),
    [dark, mode],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useColors = () => useContext(Context);
