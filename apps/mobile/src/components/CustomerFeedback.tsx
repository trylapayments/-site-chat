import React, { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../lib/client";
import { startPolling } from "../core/poll";
import { useMill } from "../lib/session";
import { useTheme } from "./ui";
type Rating = { score: number; comment: string | null; created_at: string };
export function CustomerFeedback({
  workspaceId,
  conversationId,
  userId,
}: {
  workspaceId: string;
  conversationId: string;
  userId: string;
}) {
  const { online, active } = useMill();
  const { colors, styles } = useTheme();
  const [rating, setRating] = useState<Rating | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!online || !active) return;
      let cancelled = false;
      const stop = startPolling(async () => {
        try {
          const result = await api<Rating | null>(
            "rating",
            workspaceId,
            { conversationId },
            userId,
          );
          if (!cancelled) setRating(result);
        } catch {
          /* Feedback must not block the conversation. */
        }
      }, 10000);
      return () => {
        cancelled = true;
        stop();
      };
    }, [workspaceId, conversationId, userId, online, active]),
  );
  if (!rating) return null;
  return (
    <View
      accessibilityLabel={`Customer feedback: ${rating.score} out of 5`}
      style={[styles.card, { marginHorizontal: 16, padding: 12, gap: 6 }]}
    >
      <Text style={{ color: colors.ink, fontWeight: "700" }}>
        Customer feedback · {rating.score}/5
      </Text>
      <Text style={{ color: colors.blue }}>
        {"★".repeat(Math.max(0, Math.min(5, rating.score)))}
        {"☆".repeat(Math.max(0, 5 - rating.score))}
      </Text>
      {rating.comment && (
        <Text style={{ color: colors.ink }} numberOfLines={3}>
          {rating.comment}
        </Text>
      )}
    </View>
  );
}
