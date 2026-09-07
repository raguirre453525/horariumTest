import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveTestRecipient, sendWhatsappText } from "@/lib/whatsapp/send";

describe("resolveTestRecipient (Meta allowlist literal form)", () => {
  it("maps known 381 wa_ids to the dashboard stored form (54 + area + 15 + local)", () => {
    expect(resolveTestRecipient("5493812211115")).toBe("54381152211115");
    expect(resolveTestRecipient("5493813651201")).toBe("54381153651201");
    expect(resolveTestRecipient("5493815113529")).toBe("54381155113529");
  });

  it("keeps the legacy strip-9 fallback for other AR numbers", () => {
    expect(resolveTestRecipient("5491101234567")).toBe("541101234567");
  });

  it("passes non-AR numbers through untouched", () => {
    expect(resolveTestRecipient("15551234567")).toBe("15551234567");
  });
});

describe("sendWhatsappText uses the resolved recipient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends `to` in the stored form Meta expects", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1311430818719322";
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.x" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendWhatsappText("5493815113529", "hola");
    expect(res.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.to).toBe("54381155113529");
  });
});
