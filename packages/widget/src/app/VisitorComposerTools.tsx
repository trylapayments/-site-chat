import { useEffect, useRef, useState } from "react";

const EMOJI = [
  "😀",
  "😊",
  "🙂",
  "😎",
  "😍",
  "🤔",
  "😢",
  "🙏",
  "👍",
  "👋",
  "❤️",
  "🎉",
  "✅",
  "⭐",
  "💬",
  "📩",
];
const MAX_BYTES = 10 * 1024 * 1024;
export function VisitorComposerTools({
  emojiEnabled,
  voiceEnabled,
  disabled,
  active,
  color,
  onEmoji,
  onVoice,
}: {
  emojiEnabled: boolean;
  voiceEnabled: boolean;
  disabled: boolean;
  active: boolean;
  color: string;
  onEmoji: (emoji: string) => void;
  onVoice: (file: File) => void;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function release() {
    if (timer.current) clearInterval(timer.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    timer.current = null;
    stopTimer.current = null;
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    stream.current = null;
  }
  function stop(discard: boolean) {
    cancelled.current = discard;
    generation.current += 1;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
    setRecording(false);
    setRequesting(false);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      generation.current += 1;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    };
  }, []);
  useEffect(() => {
    return () => {
      if (clip) URL.revokeObjectURL(clip.url);
    };
  }, [clip]);
  useEffect(() => {
    if (!voiceEnabled || disabled || !active) {
      stop(true);
      setClip(null);
    }
    if (!emojiEnabled || !active) setEmojiOpen(false);
    // Capture is terminated whenever the host hides/closes the widget or changes settings.
  }, [voiceEnabled, emojiEnabled, disabled, active]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) stop(true);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function start() {
    setError("");
    setClip(null);
    setEmojiOpen(false);
    if (
      typeof navigator.mediaDevices === "undefined" ||
      typeof navigator.mediaDevices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Voice recording is not supported here. Please type a message or attach an audio file.",
      );
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) {
      setError("Your browser does not support voice recording. Please attach an audio file.");
      return;
    }
    setRequesting(true);
    const attempt = ++generation.current;
    try {
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!alive.current || generation.current !== attempt) {
        capture.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      stream.current = capture;
      cancelled.current = false;
      const media = new MediaRecorder(capture, { mimeType, audioBitsPerSecond: 64000 });
      recorder.current = media;
      const chunks: Blob[] = [];
      let total = 0;
      media.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          total += event.data.size;
          if (total > MAX_BYTES) {
            stop(true);
            setError("Voice messages must be smaller than 10 MB.");
          }
        }
      };
      media.onerror = () => {
        stop(true);
        if (alive.current) setError("Recording failed. Please try again.");
      };
      media.onstop = () => {
        release();
        if (!alive.current || cancelled.current || total === 0 || total > MAX_BYTES) return;
        const type = media.mimeType.split(";")[0] ?? "audio/webm";
        const ext = type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm";
        const file = new File(chunks, `voice-${String(Date.now())}.${ext}`, { type });
        setClip({ file, url: URL.createObjectURL(file) });
        setRecording(false);
      };
      media.start(1000);
      setSeconds(0);
      setRecording(true);
      setRequesting(false);
      timer.current = setInterval(() => {
        setSeconds((value) => value + 1);
      }, 1000);
      stopTimer.current = setTimeout(() => {
        stop(false);
      }, 120000);
    } catch (e) {
      release();
      if (!alive.current || generation.current !== attempt) return;
      setRequesting(false);
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser settings, or type a message."
          : "Could not access your microphone. Please try again.",
      );
    }
  }
  const button = {
    border: "none",
    background: "transparent",
    color,
    padding: "6px",
    cursor: "pointer",
    fontSize: "20px",
    borderRadius: "8px",
  };
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px",
        marginTop: "0",
      }}
    >
      {emojiEnabled && (
        <button
          type="button"
          aria-label="Choose emoji"
          aria-expanded={emojiOpen}
          disabled={disabled || recording || requesting}
          style={button}
          onClick={() => {
            setEmojiOpen((value) => !value);
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M8 14s1.5 3 4 3 4-3 4-3" />
            <path d="M8 9h.01M16 9h.01" strokeLinecap="round" strokeWidth="3" />
          </svg>
        </button>
      )}
      {emojiOpen && emojiEnabled && (
        <div
          role="group"
          aria-label="Emoji picker"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            zIndex: 5,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            padding: "8px",
            border: "1px solid #d1d5db",
            borderRadius: "12px",
            background: "white",
            boxShadow: "0 4px 16px #0002",
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEmojiOpen(false);
          }}
        >
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insert ${emoji}`}
              style={button}
              onClick={() => {
                onEmoji(emoji);
                setEmojiOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {voiceEnabled && !recording && !clip && (
        <button
          type="button"
          aria-label="Record voice message"
          disabled={disabled || requesting}
          style={button}
          onClick={() => {
            void start();
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {requesting && (
        <span role="status" style={{ fontSize: "12px" }}>
          Waiting for microphone permission…{" "}
          <button
            type="button"
            style={button}
            onClick={() => {
              stop(true);
            }}
          >
            Cancel
          </button>
        </span>
      )}
      {recording && (
        <>
          <span role="status" style={{ fontSize: "13px", color: "#b91c1c" }}>
            ● Recording {String(Math.floor(seconds / 60))}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <button
            type="button"
            style={button}
            aria-label="Stop recording"
            onClick={() => {
              stop(false);
            }}
          >
            ■
          </button>
          <button
            type="button"
            style={{ ...button, fontSize: "13px" }}
            aria-label="Discard recording"
            onClick={() => {
              stop(true);
            }}
          >
            Cancel
          </button>
        </>
      )}
      {clip && (
        <div
          style={{
            width: "100%",
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <audio
            controls
            preload="metadata"
            src={clip.url}
            aria-label="Review voice message"
            style={{ width: "100%", height: "36px" }}
          />
          <button
            type="button"
            disabled={disabled}
            style={{ ...button, fontSize: "13px" }}
            onClick={() => {
              onVoice(clip.file);
              setClip(null);
            }}
          >
            Attach voice message
          </button>
          <button
            type="button"
            style={{ ...button, fontSize: "13px" }}
            onClick={() => {
              setClip(null);
            }}
          >
            Delete recording
          </button>
        </div>
      )}
      {error && (
        <p role="alert" style={{ width: "100%", margin: 0, fontSize: "12px", color: "#b91c1c" }}>
          {error}
        </p>
      )}
    </div>
  );
}
