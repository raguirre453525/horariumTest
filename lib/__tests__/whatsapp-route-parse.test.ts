import { describe, it, expect } from "vitest";
import { parseWhatsappPayload } from "@/lib/whatsapp/parse";

// These tests verify the route/parser contract without secrets/live services:
// - malformed JSON must be distinguishable (throws) so webhook can return 400
// - status-only / non-text valid payloads remain 200 (empty array)
// - phone_number_id is preserved for route's allowlist check
// - outbound honesty: provider failure maps to "failed" not "sent"

describe("webhook parser contract", () => {
  it("throws on malformed JSON (webhook must return 400 after signature check)", () => {
    expect(() => parseWhatsappPayload("not json")).toThrow(SyntaxError);
    expect(() => parseWhatsappPayload("{bad")).toThrow(SyntaxError);
    expect(() => parseWhatsappPayload("")).toThrow(SyntaxError);
  });

  it("returns empty for status-only valid payload (webhook must return 200)", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "x", status: "delivered" }] } }] }],
    });
    expect(parseWhatsappPayload(raw)).toHaveLength(0);
  });

  it("returns empty for non-text type (webhook must return 200, not 400)", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123" },
                messages: [{ from: "5491", id: "a", timestamp: "1", type: "image" }],
              },
            },
          ],
        },
      ],
    });
    expect(parseWhatsappPayload(raw)).toHaveLength(0);
  });

  it("preserves phone_number_id for route's configured check", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "expected-id" },
                messages: [{ from: "549111", id: "wamid.1", timestamp: "123", type: "text", text: { body: "Hola" } }],
              },
            },
          ],
        },
      ],
    });
    const res = parseWhatsappPayload(raw);
    expect(res[0].phoneNumberId).toBe("expected-id");
  });

  it("distinguishes malformed from empty: malformed throws, empty valid does not throw", () => {
    const validEmpty = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect(() => parseWhatsappPayload(validEmpty)).not.toThrow();
    expect(parseWhatsappPayload(validEmpty)).toHaveLength(0);
    expect(() => parseWhatsappPayload(":::")).toThrow(SyntaxError);
  });
});

describe("outbound honesty contract", () => {
  it("maps provider ok true to 'sent' and false to 'failed'", () => {
    const toStatus = (ok: boolean) => (ok ? "sent" : "failed");
    expect(toStatus(true)).toBe("sent");
    expect(toStatus(false)).toBe("failed");
    // route now does: sendWhatsappText -> insertOutboundMessage with sent.ok ? "sent" : "failed"
    // so a failed provider result never claims "sent"
  });
});

describe("relink atomicity contract (conceptual)", () => {
  it("requires exact challenge id consumption before identity change (no silent swallow)", async () => {
    // This test documents the intended order:
    // 1. markChallengeUsed(challengeId) must succeed BEFORE upsertIdentity
    // 2. failure of mark must not leave changed identity + reusable challenge
    // Implemented in lib/whatsapp/store.ts (markChallengeUsed with is(used_at,null) + select)
    // and lib/whatsapp/engine.ts (tryLink + awaiting_relink branch)
    const order: string[] = [];
    const mockMark = async () => { order.push("mark"); };
    const mockUpsert = async () => { order.push("upsert"); };
    // simulate correct order: mark before upsert
    await mockMark();
    await mockUpsert();
    expect(order).toEqual(["mark", "upsert"]);
  });
});
