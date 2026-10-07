import { api } from "./client";

export type MobileCapabilities = { apiVersion: number; push: boolean };

export function getMobileCapabilities(userId: string) {
  return api<MobileCapabilities>("capabilities", undefined, undefined, userId);
}
