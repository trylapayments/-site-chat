export type AlertEvent = "chat" | "visitor" | "message";
export type AlertSoundMode = "mill" | "voice" | "system" | "silent";

export function alertSound(mode: AlertSoundMode, event: AlertEvent) {
  if (mode === "silent") return null;
  if (mode === "system") return "default";
  if (mode === "voice") {
    if (event === "visitor") return "mill-voice-visitor.wav";
    return event === "chat" ? "mill-voice-conversation.wav" : "mill-voice-message.wav";
  }
  return event === "message" ? "mill-message.wav" : "mill-conversation.wav";
}
