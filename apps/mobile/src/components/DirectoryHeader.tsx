import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Avatar, BrandWash, Logo, useTheme } from "./ui";
import { useMill } from "../lib/session";
export function DirectoryHeader({ title, detail }: { title: string; detail?: string }) {
  const { colors, styles } = useTheme();
  const { session, workspace } = useMill();
  return (
    <View style={{ padding: 22, gap: 20 }}>
      <BrandWash />
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Logo small />
        <Pressable accessibilityLabel="Settings" onPress={() => router.push("/settings")}>
          <Avatar name={session?.user.email ?? "Mill"} size={38} />
        </Pressable>
      </View>
      <View>
        <Text style={{ fontSize: 34, fontWeight: "800", letterSpacing: -1, color: colors.ink }}>
          {title}
        </Text>
        <Text style={[styles.caption, { marginTop: 6 }]}>{detail ?? workspace?.name}</Text>
      </View>
    </View>
  );
}
