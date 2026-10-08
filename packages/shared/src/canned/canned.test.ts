import { describe, expect, it } from "vitest";

import { CannedError, parseCannedErrorMessage } from "./errors.js";
import {
  filterCannedResponsesForSlash,
  findCannedResponseByShortcut,
  isSubsequence,
  rankCannedResponses,
  scoreCannedResponse,
} from "./search.js";
import {
  detectSlashTrigger,
  formatShortcutDisplay,
  isValidShortcut,
  normalizeShortcutInput,
  replaceSlashTrigger,
} from "./slash.js";
import {
  advanceCannedCatchUpWatermark,
  applyCannedFolderRealtimeChange,
  applyCannedRealtimeChange,
  localCannedTombstone,
  mergeCannedFolders,
  mergeCannedResponses,
  reconcileCannedCatchUp,
  reconcileCannedFolderCatchUp,
  seedCannedCatchUpWatermark,
} from "./state.js";
import {
  extractCannedVariables,
  interpolateCannedBody,
  listCannedVariables,
  missingCannedVariables,
  unknownCannedVariables,
} from "./variables.js";
import {
  cannedResponseSchema,
  createCannedResponseSchema,
  listCannedResponsesQuerySchema,
  listCannedResponsesResultSchema,
  updateCannedResponseSchema,
} from "../schemas/canned-responses.js";
import type { CannedFolder, CannedResponse } from "../schemas/canned-responses.js";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function response(partial: Partial<CannedResponse> & Pick<CannedResponse, "id">): CannedResponse {
  return {
    workspace_id: WORKSPACE_ID,
    visibility: "workspace",
    owner_member_id: null,
    owner_display_label: null,
    folder_id: null,
    title: "Refund policy",
    body: "Hi {{visitor.name}}, our refund window is 30 days.",
    shortcut: "refund",
    usage_count: 0,
    is_favorited: false,
    created_by: MEMBER_ID,
    created_by_display_label: "owner@local.test",
    updated_by: null,
    updated_by_display_label: null,
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:00.000Z",
    deleted_at: null,
    ...partial,
  };
}

function folder(partial: Partial<CannedFolder> & Pick<CannedFolder, "id">): CannedFolder {
  return {
    workspace_id: WORKSPACE_ID,
    visibility: "workspace",
    owner_member_id: null,
    owner_display_label: null,
    name: "Billing",
    sort_order: 0,
    response_count: 0,
    created_by: MEMBER_ID,
    created_by_display_label: "owner@local.test",
    updated_by: null,
    updated_by_display_label: null,
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:00.000Z",
    deleted_at: null,
    ...partial,
  };
}

describe("canned response schemas", () => {
  it("parses an RPC item shape", () => {
    const parsed = cannedResponseSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: WORKSPACE_ID,
      visibility: "personal",
      owner_member_id: MEMBER_ID,
      owner_display_label: "agent@local.test",
      folder_id: null,
      title: "Greeting",
      body: "Hello {{visitor.name}}",
      shortcut: "greet",
      usage_count: 3,
      is_favorited: true,
      created_by: MEMBER_ID,
      created_by_display_label: "agent@local.test",
      updated_by: null,
      updated_by_display_label: null,
      created_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:05:00.000Z",
      deleted_at: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown visibility and extra keys", () => {
    expect(
      cannedResponseSchema.safeParse({ ...response({ id: WORKSPACE_ID }), extra: 1 }).success,
    ).toBe(false);
  });

  it("defaults list query filters", () => {
    const parsed = listCannedResponsesQuerySchema.parse({});
    expect(parsed).toMatchObject({
      limit: 100,
      visibility: "all",
      favorites_only: false,
      include_folders: true,
      authoritative: false,
    });
  });

  it("accepts the unfiled folder sentinel", () => {
    expect(listCannedResponsesQuerySchema.parse({ folder_id: "none" }).folder_id).toBe("none");
    expect(listCannedResponsesQuerySchema.safeParse({ folder_id: "nope" }).success).toBe(false);
  });

  it("tolerates a folder-less list result", () => {
    const parsed = listCannedResponsesResultSchema.parse({
      items: [response({ id: "11111111-1111-4111-8111-111111111111" })],
      has_more: false,
      server_watermark: "2026-08-16T12:00:00.000Z",
    });
    expect(parsed.folders).toBeUndefined();
    expect(parsed.tombstones).toEqual([]);
    expect(parsed.authoritative).toBe(false);
  });

  it("normalizes shortcut input on create and update", () => {
    expect(
      createCannedResponseSchema.parse({ title: "T", body: "B", shortcut: "/Refund " }).shortcut,
    ).toBe("refund");
    expect(
      createCannedResponseSchema.parse({ title: "T", body: "B", shortcut: "  " }).shortcut,
    ).toBeNull();
    expect(
      createCannedResponseSchema.safeParse({ title: "T", body: "B", shortcut: "bad shortcut" })
        .success,
    ).toBe(false);
    expect(
      updateCannedResponseSchema.parse({
        cannedResponseId: "11111111-1111-4111-8111-111111111111",
        title: "T",
        body: "B",
      }).shortcut,
    ).toBeNull();
  });

  it("defaults create visibility to workspace", () => {
    expect(createCannedResponseSchema.parse({ title: "T", body: "B" }).visibility).toBe(
      "workspace",
    );
  });
});

describe("canned variables", () => {
  it("lists the supported tokens", () => {
    expect(listCannedVariables().map((entry) => entry.name)).toEqual([
      "visitor.name",
      "visitor.email",
      "operator.name",
      "workspace.name",
      "conversation.id",
    ]);
  });

  it("interpolates known variables", () => {
    const text = interpolateCannedBody(
      "Hi {{visitor.name}} ({{visitor.email}}), I am {{operator.name}} from {{workspace.name}}. Ref {{conversation.id}}.",
      {
        visitorName: "Ada",
        visitorEmail: "ada@example.com",
        operatorName: "Grace",
        workspaceName: "Acme Support",
        conversationId: "conv-1",
      },
    );
    expect(text).toBe("Hi Ada (ada@example.com), I am Grace from Acme Support. Ref conv-1.");
  });

  it("treats agent.name as an alias of operator.name", () => {
    expect(interpolateCannedBody("{{agent.name}}", { operatorName: "Grace" })).toBe("Grace");
  });

  it("tolerates inner whitespace in tokens", () => {
    expect(interpolateCannedBody("Hi {{ visitor.name }}", { visitorName: "Ada" })).toBe("Hi Ada");
  });

  it("leaves unknown tokens unchanged", () => {
    expect(interpolateCannedBody("Hi {{visitor.nickname}}", { visitorName: "Ada" })).toBe(
      "Hi {{visitor.nickname}}",
    );
    expect(unknownCannedVariables("{{visitor.nickname}} {{visitor.name}}")).toEqual([
      "visitor.nickname",
    ]);
  });

  it("resolves missing known values to empty text by default", () => {
    expect(interpolateCannedBody("Hi {{visitor.name}}!", {})).toBe("Hi !");
    expect(interpolateCannedBody("Hi {{visitor.name}}!", {}, { missing: "token" })).toBe(
      "Hi {{visitor.name}}!",
    );
    expect(
      missingCannedVariables("Hi {{visitor.name}} {{workspace.name}}", { visitorName: "Ada" }),
    ).toEqual(["workspace.name"]);
  });

  it("extracts tokens with positions", () => {
    const matches = extractCannedVariables("a {{visitor.name}} b {{agent.name}}");
    expect(matches).toHaveLength(2);
    expect(matches[0]?.name).toBe("visitor.name");
    expect(matches[1]?.name).toBe("operator.name");
    expect(matches[1]?.token).toBe("agent.name");
  });
});

describe("slash trigger", () => {
  it("detects a trigger at start of input", () => {
    expect(detectSlashTrigger("/ref", 4)).toEqual({ query: "ref", replaceStart: 0 });
  });

  it("detects a trigger after whitespace", () => {
    expect(detectSlashTrigger("hello /ref", 10)).toEqual({ query: "ref", replaceStart: 6 });
  });

  it("opens on a bare slash", () => {
    expect(detectSlashTrigger("/", 1)).toEqual({ query: "", replaceStart: 0 });
  });

  it("ignores mid-word slashes and urls", () => {
    expect(detectSlashTrigger("and/or", 6)).toBeNull();
    expect(detectSlashTrigger("see https://example.com/docs", 28)).toBeNull();
  });

  it("closes once the query contains whitespace", () => {
    expect(detectSlashTrigger("/ref ", 5)).toBeNull();
  });

  it("only considers text before the caret", () => {
    expect(detectSlashTrigger("/ref more", 4)).toEqual({ query: "ref", replaceStart: 0 });
  });

  it("formats and normalizes shortcuts", () => {
    expect(formatShortcutDisplay("refund")).toBe("/refund");
    expect(formatShortcutDisplay("/refund")).toBe("/refund");
    expect(formatShortcutDisplay(null)).toBe("");
    expect(normalizeShortcutInput(" /Refund ")).toBe("refund");
    expect(normalizeShortcutInput("  ")).toBeNull();
    expect(isValidShortcut("/Refund")).toBe(true);
    expect(isValidShortcut("-nope")).toBe(false);
    expect(isValidShortcut(null)).toBe(true);
  });

  it("replaces the active trigger with the snippet body", () => {
    const result = replaceSlashTrigger("Hi /ref", 7, "Refund text");
    expect(result).toEqual({ body: "Hi Refund text", caret: 14 });
    expect(replaceSlashTrigger("Hi there", 8, "x")).toBeNull();
  });

  it("keeps text after the caret", () => {
    expect(replaceSlashTrigger("/ref tail", 4, "BODY")).toEqual({
      body: "BODY tail",
      caret: 4,
    });
  });
});

describe("slash search ranking", () => {
  const shared = response({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Refund policy",
    shortcut: "refund",
  });
  const personal = response({
    id: "22222222-2222-4222-8222-222222222222",
    visibility: "personal",
    owner_member_id: MEMBER_ID,
    owner_display_label: "agent@local.test",
    title: "Refund policy",
    shortcut: "refund",
  });
  const other = response({
    id: "33333333-3333-4333-8333-333333333333",
    title: "Shipping delay",
    shortcut: "shipping",
    body: "Sorry about the delay.",
  });

  it("ranks exact shortcut above prefix and title matches", () => {
    expect(scoreCannedResponse(shared, "/refund")).toBe(1);
    expect(scoreCannedResponse(shared, "/ref")).toBe(0.7);
    expect(scoreCannedResponse(other, "shipping delay")).toBe(0.5);
  });

  it("boosts favorites", () => {
    const favorited = response({ ...shared, id: shared.id, is_favorited: true });
    expect(scoreCannedResponse(favorited, "/ref")).toBeCloseTo(0.75);
  });

  it("matches body text and subsequences", () => {
    expect(scoreCannedResponse(other, "sorry")).toBe(0.2);
    expect(scoreCannedResponse(other, "shpg")).toBeGreaterThan(0);
    expect(scoreCannedResponse(other, "refund")).toBe(0);
    expect(isSubsequence("shpg", "shipping")).toBe(true);
    expect(isSubsequence("zz", "shipping")).toBe(false);
  });

  it("prefers personal over workspace on a tie", () => {
    const ranked = rankCannedResponses([shared, personal], "/refund");
    expect(ranked[0]?.id).toBe(personal.id);
    expect(findCannedResponseByShortcut([shared, personal], "refund")?.id).toBe(personal.id);
    expect(findCannedResponseByShortcut([shared], "missing")).toBeNull();
  });

  it("filters and truncates for the slash menu", () => {
    const menu = filterCannedResponsesForSlash([shared, personal, other], "ref");
    expect(menu.map((item) => item.id)).toEqual([personal.id, shared.id]);
    expect(filterCannedResponsesForSlash([shared, personal, other], "", { limit: 2 })).toHaveLength(
      2,
    );
  });
});

describe("canned merge and catch-up", () => {
  it("merges by id and keeps the newest updated_at", () => {
    const base = response({ id: "11111111-1111-4111-8111-111111111111", title: "A" });
    const newer = response({
      id: base.id,
      title: "A2",
      updated_at: "2026-08-16T13:00:00.000Z",
    });
    const stale = response({
      id: base.id,
      title: "stale",
      updated_at: "2026-08-16T11:00:00.000Z",
    });
    expect(mergeCannedResponses([base], [newer])[0]?.title).toBe("A2");
    expect(mergeCannedResponses([newer], [stale])[0]?.title).toBe("A2");
  });

  it("drops soft-deleted rows unless includeDeleted", () => {
    const deleted = response({
      id: "11111111-1111-4111-8111-111111111111",
      deleted_at: "2026-08-16T13:00:00.000Z",
    });
    expect(mergeCannedResponses([], [deleted])).toHaveLength(0);
    expect(mergeCannedResponses([], [deleted], { includeDeleted: true })).toHaveLength(1);
  });

  it("sorts responses by title then id", () => {
    const a = response({ id: "33333333-3333-4333-8333-333333333333", title: "beta" });
    const b = response({ id: "11111111-1111-4111-8111-111111111111", title: "Alpha" });
    expect(mergeCannedResponses([a, b], []).map((item) => item.title)).toEqual(["Alpha", "beta"]);
  });

  it("applies a realtime change", () => {
    const existing = response({ id: "11111111-1111-4111-8111-111111111111", title: "A" });
    const updated = response({
      id: existing.id,
      title: "B",
      updated_at: "2026-08-16T14:00:00.000Z",
    });
    expect(applyCannedRealtimeChange([existing], updated)[0]?.title).toBe("B");
  });

  it("removes tombstoned ids on authoritative catch-up", () => {
    const kept = response({ id: "11111111-1111-4111-8111-111111111111" });
    const gone = response({
      id: "22222222-2222-4222-8222-222222222222",
      deleted_at: "2026-08-16T13:00:00.000Z",
    });
    const merged = reconcileCannedCatchUp([kept, response({ id: gone.id })], [kept], [gone], {
      authoritativeReplace: true,
    });
    expect(merged.map((item) => item.id)).toEqual([kept.id]);
  });

  it("keeps CDC arrivals absent from a truncated authoritative page", () => {
    const fromCdc = response({ id: "22222222-2222-4222-8222-222222222222" });
    const fromServer = response({ id: "11111111-1111-4111-8111-111111111111" });
    const merged = reconcileCannedCatchUp([fromCdc], [fromServer], [], {
      authoritativeReplace: true,
    });
    expect(merged.map((item) => item.id).sort()).toEqual([fromServer.id, fromCdc.id].sort());
  });

  it("honours a local optimistic tombstone", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const local = localCannedTombstone({ id, workspaceId: WORKSPACE_ID });
    const merged = reconcileCannedCatchUp([], [response({ id })], [local], {
      authoritativeReplace: true,
    });
    expect(merged).toHaveLength(0);
  });

  it("merges and reconciles folders on their own watermark", () => {
    const billing = folder({ id: "11111111-1111-4111-8111-111111111111", name: "Billing" });
    const personal = folder({
      id: "22222222-2222-4222-8222-222222222222",
      visibility: "personal",
      owner_member_id: MEMBER_ID,
      owner_display_label: "agent@local.test",
      name: "Drafts",
    });
    expect(mergeCannedFolders([personal, billing], []).map((item) => item.id)).toEqual([
      billing.id,
      personal.id,
    ]);
    expect(applyCannedFolderRealtimeChange([], billing)).toHaveLength(1);

    const deletedBilling = folder({
      ...billing,
      id: billing.id,
      deleted_at: "2026-08-16T13:00:00.000Z",
      updated_at: "2026-08-16T13:00:00.000Z",
    });
    expect(
      reconcileCannedFolderCatchUp([billing, personal], [personal], [deletedBilling], {
        authoritativeReplace: true,
      }).map((item) => item.id),
    ).toEqual([personal.id]);
  });

  it("seeds and advances watermarks from server timestamps only", () => {
    const older = response({
      id: "11111111-1111-4111-8111-111111111111",
      updated_at: "2026-08-16T12:00:00.000Z",
    });
    const newer = response({
      id: "22222222-2222-4222-8222-222222222222",
      updated_at: "2026-08-16T13:00:00.000Z",
    });
    expect(seedCannedCatchUpWatermark([])).toBeNull();
    expect(seedCannedCatchUpWatermark([older, newer])).toBe("2026-08-16T13:00:00.000Z");

    expect(advanceCannedCatchUpWatermark("2026-08-16T12:30:00.000Z", [older], [], null)).toBe(
      "2026-08-16T12:30:00.000Z",
    );
    expect(advanceCannedCatchUpWatermark("2026-08-16T12:30:00.000Z", [newer], [], null)).toBe(
      "2026-08-16T13:00:00.000Z",
    );
    expect(advanceCannedCatchUpWatermark(null, [], [], "2026-08-16T14:00:00.000Z")).toBe(
      "2026-08-16T14:00:00.000Z",
    );
    expect(advanceCannedCatchUpWatermark(null, [], [])).toBeNull();
  });

  it("advances folder watermarks independently", () => {
    const folderRow = folder({
      id: "11111111-1111-4111-8111-111111111111",
      updated_at: "2026-08-16T15:00:00.000Z",
    });
    expect(advanceCannedCatchUpWatermark(null, [folderRow])).toBe("2026-08-16T15:00:00.000Z");
  });
});

describe("canned errors", () => {
  it("parses typed prefixes", () => {
    for (const raw of [
      "FORBIDDEN: Viewers cannot use canned responses.",
      "CANNED_NOT_FOUND: Canned response not found.",
      "CANNED_DELETED: Canned response is deleted.",
      "FOLDER_NOT_FOUND: Canned response folder not found.",
      "FOLDER_DELETED: Canned response folder is deleted.",
      "FOLDER_SCOPE_MISMATCH: Personal folder belongs to another member.",
      'SHORTCUT_TAKEN: Shortcut "refund" is already in use.',
      "INVALID_TITLE: Title must be 1–200 characters.",
      "INVALID_BODY: Body must be 1–4000 characters.",
      "INVALID_NAME: Folder name must be 1–100 characters.",
      "INVALID_SHORTCUT: Shortcut must be 1–64 characters.",
      'INVALID_VISIBILITY: Visibility must be "workspace" or "personal".',
      "INVALID_SORT_ORDER: sort_order must be between -100000 and 100000.",
      "INVALID_QUERY: query must be an object.",
    ]) {
      const parsed = parseCannedErrorMessage(raw);
      expect(parsed).toBeInstanceOf(CannedError);
      expect(raw.startsWith(`${String(parsed?.code)}:`)).toBe(true);
    }
  });

  it("maps workspace access and unique index failures", () => {
    expect(parseCannedErrorMessage("Workspace not accessible")?.code).toBe("FORBIDDEN");
    expect(
      parseCannedErrorMessage(
        'duplicate key value violates unique constraint "uq_canned_responses_workspace_shortcut"',
      )?.code,
    ).toBe("SHORTCUT_TAKEN");
  });

  it("returns null for unrelated errors", () => {
    expect(parseCannedErrorMessage(null)).toBeNull();
    expect(parseCannedErrorMessage("connection reset by peer")).toBeNull();
  });

  it("falls back to a default message when the detail is empty", () => {
    expect(parseCannedErrorMessage("SHORTCUT_TAKEN:")?.message).toBe(
      "That shortcut is already in use.",
    );
  });
});
