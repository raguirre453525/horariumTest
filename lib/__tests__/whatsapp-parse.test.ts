import { describe, it, expect } from "vitest";
import { parseWhatsappPayload } from "@/lib/whatsapp/parse";

function payload(overrides: unknown = {}) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "123" },
              messages: [
                { from: "5491112345678", id: "wamid.1", timestamp: "123", type: "text", text: { body: "Hola" } },
              ],
            },
          },
        ],
      },
    ],
    ...(overrides as object),
  });
}

describe("parseWhatsappPayload", () => {
  it("parses supported inbound text messages", () => {
    const res = parseWhatsappPayload(payload());
    expect(res).toHaveLength(1);
    expect(res[0].waId).toBe("5491112345678");
    expect(res[0].providerMessageId).toBe("wamid.1");
    expect(res[0].text).toBe("Hola");
  });

  it("ignores status notifications safely", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "x", status: "delivered" }] } }] }],
    });
    expect(parseWhatsappPayload(raw)).toHaveLength(0);
  });

  it("ignores non-text types", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1" },
                messages: [{ from: "5491", id: "a", timestamp: "1", type: "image", image: {} }],
              },
            },
          ],
        },
      ],
    });
    expect(parseWhatsappPayload(raw)).toHaveLength(0);
  });

  it("throws on invalid JSON (webhook must return 400, not 200)", () => {
    expect(() => parseWhatsappPayload("not json")).toThrow(SyntaxError);
    expect(() => parseWhatsappPayload("")).toThrow(SyntaxError);
  });

  it("bounds to 10 messages max", () => {
    const msgs = Array.from({ length: 15 }, (_, i) => ({ from: "5491", id: `id-${i}`, timestamp: "1", type: "text", text: { body: `msg ${i}` } }));
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, messages: msgs } }] }],
    });
    expect(parseWhatsappPayload(raw)).toHaveLength(10);
  });

  it("trims and limits text length", () => {
    const long = "a".repeat(5000);
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, messages: [{ from: "5491", id: "x", timestamp: "1", type: "text", text: { body: long } }] } }] }],
    });
    const res = parseWhatsappPayload(raw);
    expect(res[0].text.length).toBe(2000);
  });
});
