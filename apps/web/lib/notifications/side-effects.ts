/**
 * Browser / sound side effects for operator notifications.
 * Sound never autoplays before a user gesture (caller must gate on hasInteracted).
 * Never include note bodies or secrets in notification text.
 */

export function playNotificationSound(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const ctx = new window.AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    const start = ctx.currentTime;
    oscillator.start(start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    oscillator.stop(start + 0.14);
    void ctx.resume().catch(() => undefined);
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 200);
  } catch {
    // Autoplay / AudioContext failures are non-fatal.
  }
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "denied";
  }
  if (Notification.permission === "granted") {
    return "granted";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function showBrowserNotification(input: {
  title: string;
  body?: string | null;
  tag?: string;
  href?: string | null;
  onNavigate?: (href: string) => void;
}): Notification | null {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return null;
  }
  if (Notification.permission !== "granted") {
    return null;
  }

  try {
    const notification = new Notification(input.title, {
      body: input.body ?? undefined,
      tag: input.tag,
      silent: true,
    });

    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      if (input.href && input.onNavigate) {
        input.onNavigate(input.href);
      } else if (input.href) {
        window.location.assign(input.href);
      }
      notification.close();
    };

    return notification;
  } catch {
    return null;
  }
}
