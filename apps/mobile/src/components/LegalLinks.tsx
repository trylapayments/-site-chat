import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { ErrorBanner, useTheme } from "./ui";

export function LegalLinks() {
  const { colors } = useTheme();
  const [error, setError] = useState("");
  async function open(path: "privacy" | "support") {
    try {
      await Linking.openURL(`https://mill.chat/${path}`);
      setError("");
    } catch {
      setError("Unable to open this page. Please try again.");
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 20 }}>
        {(["privacy", "support"] as const).map((path) => (
          <Pressable
            key={path}
            accessibilityRole="link"
            onPress={() => void open(path)}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
          >
            <Text style={{ color: colors.blue, fontSize: 13 }}>
              {path === "privacy" ? "Privacy Policy" : "Support"}
            </Text>
          </Pressable>
        ))}
      </View>
      <ErrorBanner message={error} />
    </View>
  );
}
