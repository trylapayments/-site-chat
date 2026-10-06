import type { ExpoConfig, ConfigContext } from "expo/config";
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Mill",
  owner: "millcorns-team",
  slug: "mill-operators",
  scheme: "mill",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: false,
    bundleIdentifier: process.env.MILL_IOS_BUNDLE_ID || "chat.mill.operators",
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: { package: "chat.mill.operators", permissions: [] },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-notifications",
    [
      "expo-image-picker",
      {
        photosPermission: "Mill использует выбранные фотографии для отправки клиентам.",
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  extra: {
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "9deb0aa1-df65-4c03-99dd-0d8757f4ba73",
    },
  },
});
