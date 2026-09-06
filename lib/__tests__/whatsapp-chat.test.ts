import { beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_TEXT } from "@/lib/whatsapp/format";

const mocks = vi.hoisted(() => ({
  callDeepseekDraft: vi.fn(),
  callDeepseekChat: vi.fn(),
  getIdentityByPhone: vi.fn(),
  getConversation: vi.fn(),
  getMessageHistory: vi.fn(),
  upsertConversation: vi.fn(),
  getIdentityByUserId: vi.fn(),
  upsertIdentity: vi.fn(),
  findValidChallengeByHash: vi.fn(),
  findValidChallengeByUserId: vi.fn(),
  markChallengeUsed: vi.fn(),
  setPending: vi.fn(),
  clearPending: vi.fn(),
  isExpired: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/whatsapp/deepseek", () => ({
  callDeepseekDraft: mocks.callDeepseekDraft,
  callDeepseekChat: mocks.callDeepseekChat,
}));

vi.mock("@/lib/whatsapp/store", () => ({
  getIdentityByPhone: mocks.getIdentityByPhone,
  getIdentityByUserId: mocks.getIdentityByUserId,
  upsertIdentity: mocks.upsertIdentity,
  findValidChallengeByHash: mocks.findValidChallengeByHash,
  findValidChallengeByUserId: mocks.findValidChallengeByUserId,
  markChallengeUsed: mocks.markChallengeUsed,
  getConversation: mocks.getConversation,
  getMessageHistory: mocks.getMessageHistory,
  upsertConversation: mocks.upsertConversation,
  setPending: mocks.setPending,
  clearPending: mocks.clearPending,
  isExpired: mocks.isExpired,
}));

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: mocks.getServiceClient,
}));

import { handleWhatsappMessage } from "@/lib/whatsapp/engine";

const history = [{ role: "user" as const, content: "buenas" }];

function mockServiceClient() {
  mocks.getServiceClient.mockReturnValue({
    from: vi.fn(() => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.order.mockReturnValue(chain);
      chain.limit.mockResolvedValue({ data: [] });
      return chain;
    }),
  });
}

describe("WhatsApp conversational fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceClient();
    mocks.getIdentityByPhone.mockResolvedValue({ phone: "wa-1", user_id: "user-1" });
    mocks.getConversation.mockResolvedValue({ user_id: "user-1", pending_operation: null, pending_expires_at: null, awaiting_relink: false });
    mocks.getMessageHistory.mockResolvedValue(history);
  });

  it.each(["hola", "solo te salude"])("returns a chat reply for %s", async (text) => {
    mocks.callDeepseekDraft.mockResolvedValue({ intent: "unknown" });
    mocks.callDeepseekChat.mockResolvedValue("¡Hola! Qué bueno leerte 😊");

    const result = await handleWhatsappMessage("wa-1", text, `provider-${text}`);

    expect(result).toEqual({ reply: "¡Hola! Qué bueno leerte 😊", handled: true });
    expect(mocks.callDeepseekChat).toHaveBeenCalledWith(text, history, undefined, expect.any(Array));
  });

  it("uses the LLM draft for valid action intents", async () => {
    mocks.callDeepseekDraft.mockResolvedValue({ intent: "help" });

    const result = await handleWhatsappMessage("wa-1", "ayuda", "provider-help");

    expect(result).toEqual({ reply: HELP_TEXT, handled: true });
    expect(mocks.callDeepseekDraft).toHaveBeenCalledWith("ayuda", undefined, history, expect.any(Array));
    expect(mocks.callDeepseekChat).not.toHaveBeenCalled();
  });

  it("reports when both LLM legs fail for meaningful input", async () => {
    mocks.callDeepseekDraft.mockImplementation((_text, _hint, _history, failureCodes: string[]) => {
      failureCodes.push("groq:http:401", "deepseek:empty");
      return null;
    });
    mocks.callDeepseekChat.mockImplementation((_text, _history, _hint, failureCodes: string[]) => {
      failureCodes.push("groq:fetch", "deepseek:http:503");
      return Promise.reject(new Error("timeout"));
    });

    const result = await handleWhatsappMessage("wa-1", "hola", "provider-failure");

    expect(result).toEqual({ reply: "No pude conectarme con el modelo (groq:http:401, deepseek:empty, groq:fetch, deepseek:http:503). Intentá de nuevo en un rato.", handled: true });
  });

  it("includes only safe provider failure codes in the model fallback", async () => {
    mocks.callDeepseekDraft.mockImplementation((_text, _hint, _history, failureCodes: string[]) => {
      failureCodes.push("groq:http:401", "Authorization: Bearer sk-secret");
      return null;
    });
    mocks.callDeepseekChat.mockImplementation((_text, _history, _hint, failureCodes: string[]) => {
      failureCodes.push("deepseek:empty", "https://api.example.test", "gsk_secret");
      return Promise.resolve(null);
    });

    const result = await handleWhatsappMessage("wa-1", "hola", "provider-safe-failure");

    expect(result.reply).toBe("No pude conectarme con el modelo (groq:http:401, deepseek:empty). Intentá de nuevo en un rato.");
    expect(result.reply).not.toMatch(/Authorization|Bearer|sk-|gsk_/i);
  });

  it("passes through mutation claims from the chat response", async () => {
    mocks.callDeepseekDraft.mockResolvedValue({ intent: "unknown" });
    mocks.callDeepseekChat.mockResolvedValue("Listo, ya lo agendé ✅");

    const result = await handleWhatsappMessage("wa-1", "agendalo", "provider-unsafe");

    expect(result).toEqual({ reply: "Listo, ya lo agendé ✅", handled: true });
  });

  it("allows a proposed action without treating it as completed", async () => {
    mocks.callDeepseekDraft.mockResolvedValue({ intent: "unknown" });
    mocks.callDeepseekChat.mockResolvedValue("¿Querés que los borre? Decime SI y lo hago 🙂");

    const result = await handleWhatsappMessage("wa-1", "borra esos eventos", "provider-proposal");

    expect(result).toEqual({ reply: "¿Querés que los borre? Decime SI y lo hago 🙂", handled: true });
  });
});
