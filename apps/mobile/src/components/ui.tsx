import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
export const colors = {
  ink: "#142641",
  muted: "#7C8BA3",
  blue: "#4274EE",
  pale: "#EEF3FE",
  canvas: "#F7F9FD",
  line: "#E8EDF5",
  green: "#2BAD88",
};
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <LinearGradient
        colors={["#72A5FF", "#3D6BDE"]}
        style={{
          width: small ? 30 : 54,
          height: small ? 30 : 54,
          borderRadius: small ? 11 : 19,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: small ? 17 : 28,
            height: small ? 12 : 21,
            borderRadius: 8,
            backgroundColor: "#FFF",
          }}
        />
        <View
          style={{
            width: 7,
            height: 7,
            backgroundColor: "#FFF",
            position: "absolute",
            bottom: small ? 7 : 14,
            left: small ? 8 : 16,
            transform: [{ rotate: "20deg" }],
          }}
        />
      </LinearGradient>
      <Text
        style={{
          color: colors.ink,
          fontWeight: "800",
          letterSpacing: -1.5,
          fontSize: small ? 26 : 40,
        }}
      >
        mill
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
export function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  const variants = ["#EAF0FF", "#EBF5F2", "#F3EDFF", "#FFF2E7"];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.36,
        backgroundColor: variants[name.charCodeAt(0) % variants.length],
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
    </View>
  );
}
export function ErrorBanner({ message }: { message?: string }) {
  return message ? (
    <View accessibilityRole="alert" style={styles.error}>
      <Text style={{ color: "#9C3E43", fontSize: 13 }}>{message}</Text>
    </View>
  ) : null;
}
export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.blue} />
    </View>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.center}>
      <Text style={{ fontSize: 34, color: colors.blue, marginBottom: 15 }}>☁︎</Text>
      <Text style={styles.heading}>{title}</Text>
      <Text style={[styles.caption, { textAlign: "center", marginTop: 8 }]}>{detail}</Text>
    </View>
  );
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: "row", alignItems: "center" },
  heading: { fontSize: 23, color: colors.ink, fontWeight: "700", letterSpacing: -0.6 },
  caption: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  input: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#FFF",
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
  center: { flex: 1, minHeight: 160, justifyContent: "center", alignItems: "center", padding: 28 },
  error: { padding: 14, backgroundColor: "#FFF0F0", borderRadius: 12, margin: 12 },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
