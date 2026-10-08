import type { ExpoConfig, ConfigContext } from "expo/config";
const voiceSounds = [
  "./assets/sounds/mill-voice-message.wav",
  "./assets/sounds/mill-voice-conversation.wav",
  "./assets/sounds/mill-voice-visitor.wav",
];
// Voice clips provided by the project owner, converted to iOS-compatible PCM WAV.
const voiceAlertsAvailable = true;
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Mill",
  owner: "millcorns-team",
  slug: "mill-operators",
  scheme: "mill",
  version: "1.0.0",
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: process.env.MILL_IOS_BUNDLE_ID || "chat.mill.operators",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      CFBundleDevelopmentRegion: "en",
      CFBundleLocalizations: ["en"],
    },
  },
  android: { package: "chat.mill.operators", permissions: [] },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F5F8FC",
        dark: { backgroundColor: "#0C1523" },
      },
    ],
    [
      "expo-audio",
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false },
    ],
    "expo-image",
    "expo-secure-store",
    [
      "expo-notifications",
      {
        sounds: [
          "./assets/sounds/mill-message.wav",
          "./assets/sounds/mill-conversation.wav",
          ...(voiceAlertsAvailable ? voiceSounds : []),
        ],
        defaultChannel: "mill-conversations-mill",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Mill uses the photos you select to share them with customers.",
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  extra: {
    voiceAlertsAvailable,
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "9deb0aa1-df65-4c03-99dd-0d8757f4ba73",
    },
  },
});
