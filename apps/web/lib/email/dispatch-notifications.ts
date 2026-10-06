import "server-only";
import { after } from "next/server";
import { processNotificationEmailOutbox } from "./notification-email";

/** Send committed notifications after the response; cron remains the retry fallback. */
export function dispatchNotificationEmails(): void {
  if (!process.env.RESEND_API_KEY) return;
  after(async () => {
    try {
      await processNotificationEmailOutbox({ limit: 5 });
    } catch {
      console.error("Immediate notification email dispatch failed");
    }
  });
}
