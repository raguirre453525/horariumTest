import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callDeepseekChat, callDeepseekDraft } from "@/lib/whatsapp/deepseek";

describe("callDeepseekDraft conversation history", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"intent":"unknown"}' } }] }),
    });
  });

  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the latest five messages in chronological order and caps each message", async () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${index}-${"x".repeat(600)}`,
    }));

    await callDeepseekDraft("current", undefined, history);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.slice(1, -1)).toEqual(history.slice(1).map(({ role, content }) => ({ role, content: content.slice(0, 500) })));
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "current" });
  });

  it("uses a free-text request for chat replies", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "¡Hola! 😊" } }] }),
    });

    const reply = await callDeepseekChat("hola", [{ role: "user", content: "buenas" }]);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ role: string; content: string }>; response_format?: unknown };
    expect(body.response_format).toBeUndefined();
    expect((body as { stream?: boolean }).stream).toBe(false);
    expect(body.messages[0]?.content).toContain("compañero de cursada");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "hola" });
    expect(reply).toBe("¡Hola! 😊");
  });
});
