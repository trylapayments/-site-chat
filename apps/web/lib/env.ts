/**
 * Client-safe environment exports.
 * Server secrets live in `@/lib/env.server` and must not be imported from client code.
 */
export { clientEnv } from "./env.client";
