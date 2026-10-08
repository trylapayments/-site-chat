import React from "react";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../components/ui";
import { useMill } from "../../lib/session";
import { usePushNavigation } from "../../lib/push";
export default function MainTabs() {
  const { colors } = useTheme();
  const { session } = useMill();
  usePushNavigation();
  if (!session) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontWeight: "600", fontSize: 12 },
      }}
    >
      {(
        [
          { name: "inbox", title: "Chats", icon: "chatbubbles-outline" },
          { name: "visitors", title: "Visitors", icon: "people-outline" },
          { name: "contacts", title: "Contacts", icon: "person-circle-outline" },
          { name: "templates", title: "Templates", icon: "document-text-outline" },
        ] as const
      ).map((item) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{
            title: item.title,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={
                  focused
                    ? (
                        {
                          inbox: "chatbubbles",
                          visitors: "people",
                          contacts: "person-circle",
                          templates: "document-text",
                        } as const
                      )[item.name]
                    : item.icon
                }
                size={24}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
