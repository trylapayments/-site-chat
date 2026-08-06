/**
 * Shared ephemeral Realtime contracts: typing Broadcast + Presence.
 *
 * Typing events are never persisted. Presence is conversation-scoped on the
 * existing private visitor topic (`widget-conversation:{64-hex}`).
 */

import { z } from "zod";

/** Versioned Broadcast event name for typing indicators. */
export const TYPING_BROADCAST_EVENT = "typing.v1" as const;

/** Client-side remote typing TTL (4–5s window; PRD specifies 5s). */
export const TYPING_REMOTE_TTL_MS = 4_500;

/** Minimum interval between outgoing "started" typing broadcasts. */
export const TYPING_THROTTLE_MS = 1_500;

/** After this idle period without input, emit "stopped". */
export const TYPING_IDLE_STOP_MS = 2_000;

/** Presence / typing actor key max length (opaque, not raw UUIDs required). */
export const EPHEMERAL_ACTOR_KEY_MAX = 128;

export const ephemeralActorRoleSchema = z.enum(["visitor", "operator"]);
export type EphemeralActorRole = z.infer<typeof ephemeralActorRoleSchema>;

export const typingBroadcastPayloadSchema = z
  .object({
    v: z.literal(1),
    actorRole: ephemeralActorRoleSchema,
    actorKey: z.string().min(1).max(EPHEMERAL_ACTOR_KEY_MAX),
    state: z.enum(["started", "stopped"]),
    displayName: z.string().min(1).max(80).nullable().optional(),
  })
  .strict();

export type TypingBroadcastPayload = z.infer<typeof typingBroadcastPayloadSchema>;

export const presenceStateSchema = z
  .object({
    v: z.literal(1),
    role: ephemeralActorRoleSchema,
    displayName: z.string().min(1).max(80).nullable().optional(),
  })
  .strict();

export type PresenceStatePayload = z.infer<typeof presenceStateSchema>;

/**
 * Reject emails and other non-public labels before showing to the opposite party.
 */
export function isSafePublicDisplayName(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    return false;
  }

  // Member labels today are often emails — do not leak those to the visitor.
  if (trimmed.includes("@")) {
    return false;
  }

  return true;
}

export function sanitizePublicDisplayName(
  value: string | null | undefined,
): string | null {
  if (!isSafePublicDisplayName(value)) {
    return null;
  }

  return value!.trim();
}

export type RemoteTypingActor = {
  actorKey: string;
  actorRole: EphemeralActorRole;
  displayName: string | null;
  expiresAt: number;
};

export function parseTypingBroadcastPayload(
  raw: unknown,
): TypingBroadcastPayload | null {
  const parsed = typingBroadcastPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parsePresenceStatePayload(
  raw: unknown,
): PresenceStatePayload | null {
  const parsed = presenceStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Apply a validated typing event into the remote actor map.
 * Ignores events from the local actor key (echo suppression).
 */
export function applyRemoteTypingEvent(input: {
  actors: ReadonlyMap<string, RemoteTypingActor>;
  payload: TypingBroadcastPayload;
  nowMs: number;
  localActorKey?: string | null;
  ttlMs?: number;
}): Map<string, RemoteTypingActor> {
  const next = new Map(input.actors);
  const ttl = input.ttlMs ?? TYPING_REMOTE_TTL_MS;

  if (input.localActorKey && input.payload.actorKey === input.localActorKey) {
    return next;
  }

  if (input.payload.state === "stopped") {
    next.delete(input.payload.actorKey);
    return next;
  }

  next.set(input.payload.actorKey, {
    actorKey: input.payload.actorKey,
    actorRole: input.payload.actorRole,
    displayName: sanitizePublicDisplayName(input.payload.displayName ?? null),
    expiresAt: input.nowMs + ttl,
  });

  return next;
}

/**
 * Drop expired remote typing actors. Returns the next map and whether anything changed.
 */
export function expireRemoteTypingActors(input: {
  actors: ReadonlyMap<string, RemoteTypingActor>;
  nowMs: number;
}): { actors: Map<string, RemoteTypingActor>; changed: boolean } {
  const next = new Map<string, RemoteTypingActor>();
  let changed = false;

  for (const [key, actor] of input.actors) {
    if (actor.expiresAt > input.nowMs) {
      next.set(key, actor);
    } else {
      changed = true;
    }
  }

  if (!changed && next.size === input.actors.size) {
    return { actors: next, changed: false };
  }

  return { actors: next, changed: changed || next.size !== input.actors.size };
}

export function listTypingActorsForRole(
  actors: ReadonlyMap<string, RemoteTypingActor>,
  role: EphemeralActorRole,
): RemoteTypingActor[] {
  return [...actors.values()].filter((actor) => actor.actorRole === role);
}

/**
 * Resolve a stable typing indicator label for a role without flicker across actors.
 * Prefers a single safe display name; otherwise returns null (caller uses generic label).
 */
export function resolveTypingDisplayName(
  actors: ReadonlyMap<string, RemoteTypingActor>,
  role: EphemeralActorRole,
): string | null {
  const matching = listTypingActorsForRole(actors, role);
  if (matching.length === 0) {
    return null;
  }

  const named = matching
    .map((actor) => actor.displayName)
    .filter((name): name is string => Boolean(name));

  if (named.length === 1) {
    return named[0] ?? null;
  }

  // Multiple distinct names → generic label (avoid flicker / ambiguity).
  const unique = new Set(named);
  if (unique.size === 1) {
    return named[0] ?? null;
  }

  return null;
}

export function isAnyoneTyping(
  actors: ReadonlyMap<string, RemoteTypingActor>,
  role: EphemeralActorRole,
): boolean {
  return listTypingActorsForRole(actors, role).length > 0;
}

export type PresencePeer = {
  key: string;
  role: EphemeralActorRole;
  displayName: string | null;
  /** Number of connected tabs/metas for this presence key. */
  connectionCount: number;
};

/**
 * Reconcile Supabase presence state into role-aware peers.
 * Multi-tab: connectionCount > 1 keeps the peer online until the last tab leaves.
 */
export function reconcilePresencePeers(
  presenceState: Record<string, unknown[]>,
): PresencePeer[] {
  const peers: PresencePeer[] = [];

  for (const [key, metas] of Object.entries(presenceState)) {
    if (!Array.isArray(metas) || metas.length === 0) {
      continue;
    }

    let role: EphemeralActorRole | null = null;
    let displayName: string | null = null;

    for (const meta of metas) {
      const parsed = parsePresenceStatePayload(meta);
      if (!parsed) {
        continue;
      }

      role = parsed.role;
      const safe = sanitizePublicDisplayName(parsed.displayName ?? null);
      if (safe) {
        displayName = safe;
      }
    }

    if (!role) {
      continue;
    }

    peers.push({
      key,
      role,
      displayName,
      connectionCount: metas.length,
    });
  }

  return peers;
}

export function isRoleOnline(
  peers: readonly PresencePeer[],
  role: EphemeralActorRole,
  /** Exclude local presence key so self does not count as "remote online". */
  excludeKey?: string | null,
): boolean {
  return peers.some(
    (peer) =>
      peer.role === role &&
      peer.connectionCount > 0 &&
      (!excludeKey || peer.key !== excludeKey),
  );
}

/**
 * Pure helper for throttled local typing emission decisions.
 */
export type LocalTypingDecision =
  | { action: "none" }
  | { action: "started" }
  | { action: "stopped" };

export function decideLocalTypingEmit(input: {
  text: string;
  nowMs: number;
  lastStartedAt: number | null;
  isCurrentlyTyping: boolean;
  throttleMs?: number;
}): LocalTypingDecision {
  const throttle = input.throttleMs ?? TYPING_THROTTLE_MS;
  const hasMeaningfulInput = input.text.trim().length > 0;

  if (!hasMeaningfulInput) {
    if (input.isCurrentlyTyping) {
      return { action: "stopped" };
    }
    return { action: "none" };
  }

  if (!input.isCurrentlyTyping) {
    return { action: "started" };
  }

  if (
    input.lastStartedAt === null ||
    input.nowMs - input.lastStartedAt >= throttle
  ) {
    return { action: "started" };
  }

  return { action: "none" };
}

export function buildTypingBroadcastPayload(input: {
  actorRole: EphemeralActorRole;
  actorKey: string;
  state: "started" | "stopped";
  displayName?: string | null;
}): TypingBroadcastPayload {
  return {
    v: 1,
    actorRole: input.actorRole,
    actorKey: input.actorKey,
    state: input.state,
    displayName: sanitizePublicDisplayName(input.displayName ?? null),
  };
}

export function buildPresenceStatePayload(input: {
  role: EphemeralActorRole;
  displayName?: string | null;
}): PresenceStatePayload {
  return {
    v: 1,
    role: input.role,
    displayName: sanitizePublicDisplayName(input.displayName ?? null),
  };
}

/** Opaque operator presence/typing key — avoids exposing raw member UUIDs. */
export function operatorEphemeralActorKey(memberId: string): string {
  // Deterministic FNV-1a style dual hash — opaque to visitors on the channel.
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  for (let i = 0; i < memberId.length; i += 1) {
    const c = memberId.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `op_${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}
