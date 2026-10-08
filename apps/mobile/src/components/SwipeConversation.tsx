import React, { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "./ui";
export function SwipeConversation({
  children,
  onClose,
  closed,
  disabled,
}: {
  children: React.ReactNode;
  onClose: () => Promise<void>;
  closed: boolean;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const closing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [gestureVersion, setGestureVersion] = useState(0);
  async function close() {
    if (closing.current) return;
    closing.current = true;
    setBusy(true);
    swipe.current?.close();
    try {
      await onClose();
    } finally {
      setGestureVersion((version) => version + 1);
      closing.current = false;
      setBusy(false);
    }
  }
  if (closed || disabled) return children;
  return (
    <Swipeable
      key={gestureVersion}
      ref={swipe}
      enabled={!busy}
      overshootRight={false}
      rightThreshold={48}
      onSwipeableOpen={(direction) => {
        if (direction === "left") void close();
      }}
      renderRightActions={() => (
        <Pressable
          accessibilityLabel="Close conversation"
          disabled={busy}
          onPress={() => void close()}
          style={{
            width: 104,
            borderRadius: 18,
            backgroundColor: "#1761DF",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 7,
            gap: 6,
          }}
        >
          <Ionicons name="checkmark-circle-outline" size={26} color="#FFF" />
          <Text style={{ color: "#FFF", fontWeight: "600" }}>Close</Text>
        </Pressable>
      )}
    >
      <View style={{ backgroundColor: colors.canvas }}>
        {children}
        {busy && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: 18,
              bottom: 12,
              padding: 6,
              borderRadius: 10,
              backgroundColor: colors.surface,
            }}
          >
            <ActivityIndicator color={colors.blue} accessibilityLabel="Closing conversation" />
          </View>
        )}
      </View>
    </Swipeable>
  );
}
