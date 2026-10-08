import * as StoreReview from "expo-store-review";
import { storage } from "./storage";
import { recordReviewClose, reviewEligible, type ReviewProgress } from "../core/review-policy";

const queues = new Map<string, Promise<void>>();
function serial(userId: string, run: () => Promise<void>) {
  const work = (queues.get(userId) ?? Promise.resolve()).then(run).catch(() => {});
  queues.set(userId, work);
  void work.finally(() => {
    if (queues.get(userId) === work) queues.delete(userId);
  });
  return work;
}
async function read(userId: string): Promise<ReviewProgress> {
  const raw = await storage.getItem(`mill.review.${userId}`);
  if (raw) {
    const value = JSON.parse(raw) as ReviewProgress;
    if (
      Number.isFinite(value.firstUse) &&
      Array.isArray(value.closed) &&
      value.closed.every((id) => typeof id === "string")
    )
      return value;
  }
  return { firstUse: Date.now(), closed: [] };
}
export function startReviewProgress(userId: string) {
  return serial(userId, async () => {
    await storage.setItem(`mill.review.${userId}`, JSON.stringify(await read(userId)));
  });
}
export function noteSuccessfulClose(userId: string, companyId: string, conversationId: string) {
  return serial(userId, async () => {
    const next = recordReviewClose(
      await read(userId),
      `${companyId}:${conversationId}`,
      Date.now(),
    );
    await storage.setItem(`mill.review.${userId}`, JSON.stringify(next));
  });
}
export function requestReviewWhenIdle(userId: string, stillIdle: () => boolean) {
  return serial(userId, async () => {
    const progress = await read(userId);
    if (
      !stillIdle() ||
      !reviewEligible(progress, Date.now()) ||
      !(await StoreReview.isAvailableAsync())
    )
      return;
    if (!stillIdle()) return;
    // Persist the attempt before asking the OS; it may choose not to show the dialog.
    progress.lastAttempt = Date.now();
    await storage.setItem(`mill.review.${userId}`, JSON.stringify(progress));
    if (stillIdle()) await StoreReview.requestReview();
  });
}
