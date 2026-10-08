import React from "react";
import { Text, View } from "react-native";
import { visitorLocation } from "../core/visitor-location";
import { useTheme } from "./ui";
export function VisitorLocation({
  visitor,
  detailed = false,
}: {
  visitor: { country?: string | null; city?: string | null; ip?: string | null };
  detailed?: boolean;
}) {
  const { styles, colors } = useTheme();
  const location = visitorLocation(visitor);
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.caption}>{location || "Location unavailable"}</Text>
      <Text selectable={detailed} style={{ fontSize: 12, color: colors.muted }}>
        IP: {visitor.ip || "Unavailable"}
      </Text>
      {detailed && (
        <Text style={{ fontSize: 12, color: colors.muted }}>
          Approximate location based on IP address.
        </Text>
      )}
    </View>
  );
}
