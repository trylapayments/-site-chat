import "server-only";

import { serverEnvSchema } from "@site-chat/shared/env";

/**
 * Validated server environment variables.
 * Throws at import time if required variables are missing or invalid.
 */
function createServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Invalid server environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid server environment variables");
  }

  return parsed.data;
}

export const env = createServerEnv();
