import { describe, expect, it } from "vitest";

import type { GlobalSearchHit } from "@site-chat/shared";

import { hrefForSearchHit } from "./href";

const base = (overrides: Partial<GlobalSearchHit>): GlobalSearchHit => ({
  type: "contact",
  id: "11111111-1111-1111-1111-111111111111",
  title: "T",
  subtitle: null,
  snippet: null,
  timestamp: null,
  conversation_id: null,
  contact_id: null,
  message_id: null,
  rank: 1,
  ...overrides,
});

describe("hrefForSearchHit", () => {
  it("routes contacts to profile", () => {
    expect(hrefForSearchHit("acme", base({ type: "contact" }))).toBe(
      "/app/acme/contacts/11111111-1111-1111-1111-111111111111",
    );
  });

  it("routes messages with focus query", () => {
    expect(
      hrefForSearchHit(
        "acme",
        base({
          type: "message",
          id: "22222222-2222-2222-2222-222222222222",
          conversation_id: "33333333-3333-3333-3333-333333333333",
          message_id: "22222222-2222-2222-2222-222222222222",
        }),
      ),
    ).toBe(
      "/app/acme/inbox/33333333-3333-3333-3333-333333333333?message=22222222-2222-2222-2222-222222222222",
    );
  });

  it("routes notes to notes tab", () => {
    expect(
      hrefForSearchHit(
        "acme",
        base({
          type: "note",
          id: "44444444-4444-4444-4444-444444444444",
          conversation_id: "33333333-3333-3333-3333-333333333333",
        }),
      ),
    ).toBe(
      "/app/acme/inbox/33333333-3333-3333-3333-333333333333?tab=notes&note=44444444-4444-4444-4444-444444444444",
    );
  });
});
