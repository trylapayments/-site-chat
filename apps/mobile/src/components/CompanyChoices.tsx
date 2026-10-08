import React from "react";
import { Pressable, Text, View } from "react-native";
import type { AccessibleWorkspace } from "@site-chat/shared";
import { unreadBadge } from "../core/company-inbox";
import { useTheme } from "./ui";
export function CompanyChoices({
  workspaces,
  counts,
  selected,
  onSelect,
}: {
  workspaces: AccessibleWorkspace[];
  counts: Record<string, number>;
  selected: string | "all" | null;
  onSelect: (id: string) => void;
}) {
  const { colors, styles } = useTheme();
  const options = [
    { id: "all", name: "All Websites", role: "" },
    ...workspaces.map((w) => ({ id: w.workspace_id, name: w.name, role: w.role })),
  ];
  return (
    <View style={{ gap: 4 }}>
      {options.map((item) => {
        const count =
          item.id === "all"
            ? Object.values(counts).reduce((sum, n) => sum + n, 0)
            : (counts[item.id] ?? 0);
        const badge = unreadBadge(count);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityLabel={`${item.name}${badge ? `, ${count} unread` : ""}`}
            accessibilityState={{ checked: selected === item.id }}
            onPress={() => onSelect(item.id)}
            style={[styles.row, { minHeight: 48, gap: 10, paddingVertical: 8 }]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: selected === item.id ? colors.blue : colors.ink,
                  fontWeight: "600",
                }}
              >
                {item.name}
              </Text>
              {item.role && <Text style={{ color: colors.muted, fontSize: 12 }}>{item.role}</Text>}
            </View>
            {!!badge && (
              <View
                style={{
                  backgroundColor: colors.blue,
                  borderRadius: 12,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "600" }}>{badge}</Text>
              </View>
            )}
            {selected === item.id && <Text style={{ color: colors.blue }}>✓</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}
