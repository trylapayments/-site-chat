type PermissionState = { undetermined: boolean; denied: boolean };
export type PushOnboardingResult = "registered" | "denied" | "skipped" | "retry";
export async function runPushOnboarding({ permission, marker, register, remember, clear, cancelled }: {
  permission: () => Promise<PermissionState>;
  marker: () => Promise<string | null>;
  register: () => Promise<void>;
  remember: (state: "registered" | "denied") => Promise<void>;
  clear: () => Promise<void>;
  cancelled: () => boolean;
}): Promise<PushOnboardingResult> {
  try {
    const before = await permission();
    const saved = await marker();
    if (cancelled()) return "skipped";
    if (saved === "registered" && !before.undetermined) return "skipped";
    if (saved === "denied" && before.denied && !before.undetermined) return "denied";
    await register();
    if (cancelled()) return "skipped";
    await remember("registered");
    return "registered";
  } catch {
    if (cancelled()) return "skipped";
    try {
      const after = await permission();
      if (after.denied && !after.undetermined) {
        await remember("denied");
        return "denied";
      }
      await clear();
    } catch { /* A failed permission/storage lookup must remain retryable. */ }
    return "retry";
  }
}
// Retry only unfinished registration, sequentially; never repeat an accepted or denied prompt.
export function startPushOnboarding(
  attempt: () => Promise<PushOnboardingResult>,
  schedule: (callback: () => void, delay: number) => () => void = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
) {
  let cancelled = false;
  let cancelTimer: (() => void) | undefined;
  let retries = 0;
  const run = async () => {
    if (cancelled) return;
    let result: PushOnboardingResult;
    try { result = await attempt(); } catch { result = "retry"; }
    if (!cancelled && result === "retry") {
      const delay = Math.min(5000 * 2 ** Math.min(retries++, 3), 30000);
      cancelTimer = schedule(() => { void run(); }, delay);
    }
  };
  void run();
  return () => { cancelled = true; cancelTimer?.(); };
}
