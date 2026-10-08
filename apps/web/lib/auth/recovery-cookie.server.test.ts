import {beforeEach, describe, expect, it, vi} from "vitest";
import type {AppSupabaseClient} from "@/lib/supabase/server";
import {createRecoveryCookieValue} from "./recovery-cookie";
const state = vi.hoisted(() => ({raw: undefined as string | undefined}));
vi.mock("next/headers", () => ({cookies: () => Promise.resolve({get: () => state.raw ? {value: state.raw} : undefined})}));
import {readRecoveryGateContext, readRecoveryCookieValidationForSession} from "./recovery-cookie.server";
const now = 1_800_000_000;
function client(sessionId = "session-a") {
 const getClaims = vi.fn().mockResolvedValue({data: {claims: {session_id: sessionId}}, error: null});
 return {supabase: {auth: {getClaims}} as unknown as AppSupabaseClient, getClaims};
}
describe("recovery gate reads", () => {
 beforeEach(() => {state.raw = undefined;});
 it("does not contact authentication for an absent recovery cookie", async () => {
  const {supabase, getClaims} = client();
  expect(await readRecoveryGateContext(supabase, now)).toEqual({cookieValidation: {valid: false, reason: "missing"}, expiredSessionBindingMatches: false});
  expect(await readRecoveryCookieValidationForSession(supabase, now)).toEqual({valid: false, reason: "missing"});
  expect(getClaims).not.toHaveBeenCalled();
 });
 it("still verifies session binding and reads claims only once", async () => {
  state.raw = createRecoveryCookieValue("test-auth-cookie-secret-min-32-characters", "session-a", now);
  const {supabase, getClaims} = client();
  expect((await readRecoveryGateContext(supabase, now)).cookieValidation.valid).toBe(true);
  expect(getClaims).toHaveBeenCalledTimes(1);
 });
 it("rejects a valid cookie belonging to another session", async () => {
  state.raw = createRecoveryCookieValue("test-auth-cookie-secret-min-32-characters", "session-a", now);
  const {supabase} = client("session-b");
  expect((await readRecoveryGateContext(supabase, now)).cookieValidation).toEqual({valid: false, reason: "session_mismatch"});
 });
});
