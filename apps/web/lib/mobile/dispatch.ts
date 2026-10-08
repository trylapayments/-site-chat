import "server-only";
import { after } from "next/server";
import { processMobilePush } from "./push";

/** Deliver committed visitor notifications without adding latency to sending a message. */
export function dispatchMobilePush(): void {
  if (process.env.MOBILE_PUSH_ENABLED !== "1") return;
  after(async () => {
    try {
      await processMobilePush();
    } catch {
      // Durable outbox and the separate scheduler retry; never log tokens or message content.
      console.error("Immediate mobile push dispatch failed");
    }
  });
}
