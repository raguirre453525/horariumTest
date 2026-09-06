import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return { query, from: vi.fn(() => query) };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: supabaseMock.from })),
}));

import { getMessageHistory } from "@/lib/whatsapp/store";

describe("getMessageHistory", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    vi.clearAllMocks();
    supabaseMock.query.select.mockReturnValue(supabaseMock.query);
    supabaseMock.query.eq.mockReturnValue(supabaseMock.query);
    supabaseMock.query.neq.mockReturnValue(supabaseMock.query);
    supabaseMock.query.order.mockReturnValue(supabaseMock.query);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("loads both directions newest-first, reverses them, excludes the current row, and caps text", async () => {
    supabaseMock.query.limit.mockResolvedValue({
      data: [
        { direction: "outbound", body: "fifth" },
        { direction: "inbound", body: "fourth" },
        { direction: "outbound", body: "third" },
        { direction: "inbound", body: "second" },
        { direction: "inbound", body: "a".repeat(600) },
      ],
    });

    const result = await getMessageHistory("wa-id", "current-message");

    expect(supabaseMock.from).toHaveBeenCalledWith("whatsapp_messages");
    expect(supabaseMock.query.eq).toHaveBeenCalledWith("wa_id", "wa-id");
    expect(supabaseMock.query.neq).toHaveBeenCalledWith("provider_message_id", "current-message");
    expect(supabaseMock.query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(supabaseMock.query.limit).toHaveBeenCalledWith(5);
    expect(result).toEqual([
      { role: "user", content: "a".repeat(500) },
      { role: "user", content: "second" },
      { role: "assistant", content: "third" },
      { role: "user", content: "fourth" },
      { role: "assistant", content: "fifth" },
    ]);
  });
});
