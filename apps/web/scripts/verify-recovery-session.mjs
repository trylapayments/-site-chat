/**
 * Empirical verification of Supabase Auth recovery-session signals.
 *
 * Stack:
 * - GoTrue v2.194.0 (matches Supabase CLI 2.111.0 auth image)
 * - @supabase/supabase-js 2.111.0 (repo lockfile)
 *
 * Run against local GoTrue:
 *   node scripts/verify-recovery-session.mjs
 *
 * Env:
 *   SUPABASE_URL (default http://localhost:9999)
 *   SUPABASE_ANON_KEY (default HS256 anon JWT for GOTRUE_JWT_SECRET=testsecret)
 *   DATABASE_URL (default postgres://supabase_auth_admin:root@localhost:5432/postgres)
 */

import crypto from "node:crypto";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";

const GOTRUE_URL = process.env.GOTRUE_URL ?? "http://127.0.0.1:9999";
const PROXY_PORT = Number(process.env.PROXY_PORT ?? "54321");
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? `http://127.0.0.1:${PROXY_PORT}`;
const JWT_SECRET = process.env.GOTRUE_JWT_SECRET ?? "testsecret";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://supabase_auth_admin:root@localhost:5432/postgres";
function createAnonKey(secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      role: "anon",
      iss: "supabase",
      iat: now,
      exp: now + 60 * 60 * 24 * 365,
    }),
  );
  const data = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? createAnonKey(JWT_SECRET);

const TEST_EMAIL = `recovery-verify-${Date.now()}@example.com`;
const ORIGINAL_PASSWORD = "OriginalPass123!";
const NEW_PASSWORD = "NewRecoveryPass456!";

async function startAuthProxy() {
  const gotrue = new URL(GOTRUE_URL);

  const server = http.createServer((req, res) => {
    const incoming = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const targetPath = incoming.pathname.replace(/^\/auth\/v1/, "") || "/";
    const target = new URL(`${targetPath}${incoming.search}`, gotrue);

    const proxyReq = http.request(
      target,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: gotrue.host,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (error) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    });

    req.pipe(proxyReq);
  });

  await new Promise((resolve) => {
    server.listen(PROXY_PORT, "127.0.0.1", resolve);
  });

  return server;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function pickUserFields(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
    recovery_sent_at: user.recovery_sent_at,
    last_sign_in_at: user.last_sign_in_at,
    updated_at: user.updated_at,
  };
}

function pickSessionFields(session) {
  if (!session) return null;
  return {
    access_token_prefix: session.access_token?.slice(0, 24) ?? null,
    refresh_token_prefix: session.refresh_token?.slice(0, 12) ?? null,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user_id: session.user?.id ?? null,
  };
}

function pickClaimsFields(claims) {
  if (!claims) return null;
  return {
    sub: claims.sub,
    role: claims.role,
    aal: claims.aal,
    amr: claims.amr,
    session_id: claims.session_id,
    email: claims.email,
    exp: claims.exp,
    iat: claims.iat,
  };
}

async function snapshot(client, label) {
  const [userResult, sessionResult, claimsResult] = await Promise.all([
    client.auth.getUser(),
    client.auth.getSession(),
    client.auth.getClaims(),
  ]);

  const output = {
    stage: label,
    getUser: {
      error: userResult.error?.message ?? null,
      user: pickUserFields(userResult.data.user),
    },
    getSession: {
      error: sessionResult.error?.message ?? null,
      session: pickSessionFields(sessionResult.data.session),
    },
    getClaims: {
      error: claimsResult.error?.message ?? null,
      claims: pickClaimsFields(claimsResult.data?.claims ?? null),
    },
  };

  console.log(JSON.stringify(output, null, 2));
  return {
    user: userResult.data.user,
    session: sessionResult.data.session,
    claims: claimsResult.data?.claims ?? null,
  };
}

async function queryUserTokens(email) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync(
    "docker",
    [
      "exec",
      "gotrue-postgres",
      "psql",
      "-U",
      "postgres",
      "-tAc",
      `SELECT recovery_token, confirmation_token FROM auth.users WHERE email = '${email.replace(/'/g, "''")}' LIMIT 1;`,
    ],
    { encoding: "utf8" },
  );

  const [recoveryToken, confirmationToken] = stdout.trim().split("|");
  return {
    recovery_token: recoveryToken || null,
    confirmation_token: confirmationToken || null,
  };
}

async function confirmSignupEmail(email) {
  const { confirmation_token: confirmationToken } =
    await queryUserTokens(email);
  if (!confirmationToken) {
    throw new Error(`No confirmation_token for ${email}`);
  }

  const verifyUrl = `${GOTRUE_URL}/verify?type=signup&token=${encodeURIComponent(confirmationToken)}`;
  const verifyResponse = await fetch(verifyUrl, { redirect: "manual" });
  if (verifyResponse.status !== 303 && verifyResponse.status !== 302) {
    const body = await verifyResponse.text();
    throw new Error(
      `signup verify failed: HTTP ${verifyResponse.status} ${body.slice(0, 200)}`,
    );
  }
}

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    removeItem: async (key) => {
      store.delete(key);
    },
  };
}

async function main() {
  const proxy = await startAuthProxy();

  console.log(
    JSON.stringify(
      {
        versions: {
          supabase_js: "2.111.0 (repo lockfile)",
          gotrue: "v2.194.0",
          supabase_cli: "2.111.0",
        },
        endpoints: { SUPABASE_URL, GOTRUE_URL, DATABASE_URL },
        test_email: TEST_EMAIL,
      },
      null,
      2,
    ),
  );

  const storage = createMemoryStorage();
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storage,
    },
  });

  const signUp = await client.auth.signUp({
    email: TEST_EMAIL,
    password: ORIGINAL_PASSWORD,
  });
  if (signUp.error) {
    throw new Error(`signUp failed: ${signUp.error.message}`);
  }

  await confirmSignupEmail(TEST_EMAIL);

  const signIn = await client.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: ORIGINAL_PASSWORD,
  });
  if (signIn.error) {
    throw new Error(`signIn failed: ${signIn.error.message}`);
  }

  await snapshot(client, "1_normal_authenticated_session");

  const reset = await client.auth.resetPasswordForEmail(TEST_EMAIL, {
    redirectTo: "http://localhost:3000/auth/recovery",
  });
  if (reset.error) {
    throw new Error(`resetPasswordForEmail failed: ${reset.error.message}`);
  }

  const { recovery_token: recoveryToken } = await queryUserTokens(TEST_EMAIL);
  if (!recoveryToken) {
    throw new Error("recovery_token missing after resetPasswordForEmail");
  }

  const verifyUrl = `${GOTRUE_URL}/verify?type=recovery&token=${encodeURIComponent(recoveryToken)}`;
  const verifyResponse = await fetch(verifyUrl, { redirect: "manual" });
  if (verifyResponse.status !== 303 && verifyResponse.status !== 302) {
    const body = await verifyResponse.text();
    throw new Error(
      `verify failed: HTTP ${verifyResponse.status} ${body.slice(0, 200)}`,
    );
  }

  const location = verifyResponse.headers.get("location");
  if (!location) {
    throw new Error("verify redirect missing Location header");
  }

  const redirect = new URL(location);
  const authCode = redirect.searchParams.get("code");
  if (!authCode) {
    throw new Error(`verify redirect missing code: ${location}`);
  }

  const exchange = await client.auth.exchangeCodeForSession(authCode);
  if (exchange.error) {
    throw new Error(`exchangeCodeForSession failed: ${exchange.error.message}`);
  }

  await snapshot(client, "2_immediately_after_recovery_callback");

  // Simulate page refresh: new client instance, same persisted storage
  const refreshedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storage,
    },
  });

  await snapshot(refreshedClient, "3_after_page_refresh");

  const refresh = await refreshedClient.auth.refreshSession();
  if (refresh.error) {
    throw new Error(`refreshSession failed: ${refresh.error.message}`);
  }

  await snapshot(refreshedClient, "4_after_token_refresh");

  const update = await refreshedClient.auth.updateUser({
    password: NEW_PASSWORD,
  });
  if (update.error) {
    throw new Error(`updateUser(password) failed: ${update.error.message}`);
  }

  await snapshot(refreshedClient, "5_after_password_update");

  const relogin = await refreshedClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: NEW_PASSWORD,
  });
  if (relogin.error) {
    throw new Error(`post-update signIn failed: ${relogin.error.message}`);
  }

  await snapshot(refreshedClient, "6_fresh_login_after_password_update");

  await new Promise((resolve) => proxy.close(resolve));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
