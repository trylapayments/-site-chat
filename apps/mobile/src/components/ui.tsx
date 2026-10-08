import React, { useMemo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { lightColors, useColors, type Palette } from "../lib/theme";
export const colors = lightColors;
export function useTheme() {
  const theme = useColors();
  const styles = useMemo(() => makeStyles(theme.colors), [theme.colors]);
  return { ...theme, styles };
}
export function BrandWash() {
  const { dark } = useTheme();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={dark ? ["#182E48", "#0C1523"] : ["#EAF4FF", "#F7FAFF"]}
      start={{ x: 1, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: 210 }}
    />
  );
}
export function Logo({ small = false }: { small?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Image
        source={require("../../assets/icon.png")}
        style={{ width: small ? 34 : 58, height: small ? 34 : 58, borderRadius: small ? 10 : 17 }}
      />
      <Text
        style={{
          color: colors.ink,
          fontWeight: "800",
          letterSpacing: -1.5,
          fontSize: small ? 26 : 40,
        }}
      >
        Mill
      </Text>
    </View>
  );
}
export function Button({
  title,
  onPress,
  disabled,
  subtle = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  const { colors, styles } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        subtle && styles.subtle,
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, subtle && { color: colors.blue }]}>{title}</Text>
    </Pressable>
  );
}
export function Avatar({
  name,
  size = 46,
  online = false,
}: {
  name: string;
  size?: number;
  online?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.avatar,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.ink, fontSize: size * 0.34, fontWeight: "700" }}>
        {name
          .split(" ")
          .slice(0, 2)
          .map((n) => n[0])
          .join("")
          .toUpperCase()}
      </Text>
      {online && (
        <View
          accessibilityLabel="Online"
          style={{
            position: "absolute",
            right: -1,
            bottom: 0,
            width: 13,
            height: 13,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: colors.surface,
            backgroundColor: colors.green,
          }}
        />
      )}
    </View>
  );
}
export function ErrorBanner({ message }: { message?: string }) {
  const { colors, styles } = useTheme();
  return message ? (
    <View accessibilityRole="alert" style={styles.error}>
      <Text style={{ color: colors.danger, fontSize: 13 }}>{message}</Text>
    </View>
  ) : null;
}
export function Loading() {
  const { colors, styles } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.blue} />
    </View>
  );
}
export function Empty({
  title,
  detail,
  icon = "chatbubbles-outline",
  loading = false,
}: {
  title: string;
  detail: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  loading?: boolean;
}) {
  const { colors, styles } = useTheme();
  return (
    <View style={styles.center}>
      {loading ? (
        <ActivityIndicator color={colors.blue} style={{ marginBottom: 20 }} />
      ) : (
        <View
          accessible={false}
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: colors.pale,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Ionicons name={icon} size={30} color={colors.blue} />
        </View>
      )}
      <Text style={styles.heading}>{title}</Text>
      <Text style={[styles.caption, { textAlign: "center", marginTop: 8 }]}>{detail}</Text>
    </View>
  );
}
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      width: "100%",
      maxWidth: 960,
      alignSelf: "center",
      backgroundColor: colors.canvas,
    },
    row: { flexDirection: "row", alignItems: "center" },
    heading: { fontSize: 24, color: colors.ink, fontWeight: "700", letterSpacing: -0.6 },
    caption: { fontSize: 14, color: colors.muted, lineHeight: 21 },
    input: {
      minHeight: 54,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      fontSize: 16,
      color: colors.ink,
    },
    button: {
      minHeight: 50,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.blue,
      paddingHorizontal: 16,
    },
    subtle: { backgroundColor: colors.pale },
    buttonText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
    center: {
      flex: 1,
      minHeight: 160,
      justifyContent: "center",
      alignItems: "center",
      padding: 28,
    },
    error: { padding: 14, backgroundColor: colors.error, borderRadius: 12, margin: 12 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 20,
      shadowColor: "#193B69",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.035,
      shadowRadius: 12,
      borderWidth: 1,
      borderColor: colors.line,
    },
  });

export const styles = makeStyles(lightColors);
