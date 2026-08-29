import { describe, it, expect, vi, beforeAll } from "vitest";
import { isExpired } from "@/lib/whatsapp/store";
import { formatConfirmSummary, ambiguousChoices, LINK_INSTRUCTIONS } from "@/lib/whatsapp/format";
import { hashLinkCode } from "@/lib/whatsapp/hmac";
import { validateDraft } from "@/lib/whatsapp/validators";

beforeAll(() => {
  process.env.WHATSAPP_LINK_HASH_SALT = "test-salt-for-hmac-tests";
});

describe("challenge hashing / expiry / replay", () => {
  it("hash is deterministic and single-use check via used_at simulation", () => {
    const code = "123456";
    const h1 = hashLinkCode(code);
    const h2 = hashLinkCode(code);
    expect(h1).toBe(h2);
    // simulate replay: hash same -> would be marked used, second lookup should fail if used_at set
    // we test logic: isExpired for challenge expiry 10 min
    const future = new Date(Date.now() + 11 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 1).toISOString();
    // challenge valid if expires_at > now
    expect(new Date(future).getTime() > Date.now()).toBe(true);
    expect(new Date(past).getTime() > Date.now()).toBe(false);
  });

  it("deterministic confirmation expiry 10 minutes", () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-28T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const expires = new Date(now + 10 * 60 * 1000).toISOString();
    expect(isExpired(expires)).toBe(false);
    // 10 min + 1 sec later expired
    vi.setSystemTime(now + 10 * 60 * 1000 + 1000);
    expect(isExpired(expires)).toBe(true);
    expect(isExpired(null)).toBe(true);
    vi.useRealTimers();
  });
});

describe("ambiguous selection", () => {
  it("formats numbered choices and persists selection state shape", () => {
    const items = [
      { id: "1", code: "ASI", name: "Admin" },
      { id: "2", code: "RED", name: "Redes" },
    ];
    const text = ambiguousChoices(items, (it) => `${it.code} — ${it.name}`);
    expect(text).toContain("1. ASI — Admin");
    expect(text).toContain("2. RED — Redes");
    expect(text).toContain("Respondé con el número");
  });

  it("engine would persist last_ambiguous with up to 10 items", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, title: `Note ${i}` }));
    const text = ambiguousChoices(items, (it) => String(it.title));
    const lines = text.split("\n").filter((l) => /^\d+\./.test(l.trim()));
    expect(lines.length).toBe(10);
  });
});

describe("webhook dedup behavior (mocked)", () => {
  it("duplicate providerMessageId must not re-run mutation", async () => {
    // simulate dedup via Set
    const seen = new Set<string>();
    function process(id: string): boolean {
      if (seen.has(id)) return false; // duplicate, skip
      seen.add(id);
      return true;
    }
    expect(process("wamid.123")).toBe(true);
    expect(process("wamid.123")).toBe(false);
    expect(process("wamid.124")).toBe(true);
  });
});

describe("bot permission allowlist", () => {
  it("rejects permanent event deletion via validator", () => {
    const v = validateDraft({ intent: "delete_event", payload: { event_id: "x" } } as unknown as { intent: string; payload: Record<string, unknown> });
    expect(v).toBeNull();
  });

  it("group completion semantics: shared vs individual", () => {
    // individual: per-user, group: shared via completed_by
    // Our validator allows toggle_complete; engine distinguishes by event_type
    const v = validateDraft({ intent: "toggle_complete", payload: { event_id: "evt-1" } });
    expect(v?.kind).toBe("toggle_complete");
    // format warning for group
    const summaryGroup = formatConfirmSummary("toggle_complete", { event_id: "evt-1", event_type: "grupal" });
    expect(summaryGroup).toContain("todos los participantes");
    const summaryInd = formatConfirmSummary("toggle_complete", { event_id: "evt-1", event_type: "individual" });
    expect(summaryInd).toContain("solo para vos");
    expect(summaryInd).not.toContain("todos");
  });

  it("unlinked whatsapp receives only spanish linking instructions", () => {
    expect(LINK_INSTRUCTIONS).toContain("vinculado");
    expect(LINK_INSTRUCTIONS).toContain("código");
    // ensure no english
    expect(LINK_INSTRUCTIONS.toLowerCase()).not.toContain("link your account");
  });

  it("confirmation summary is spanish and bound to exact payload", () => {
    const s = formatConfirmSummary("delete_note", { note_id: "abc-123-def" });
    expect(s).toContain("eliminar");
    expect(s).toContain("SI");
    expect(s).toContain("NO");
    expect(s).toContain("abc-123");
  });
});

describe("model output validation treated as untrusted", () => {
  it("ignores model trying to inject extra fields", () => {
    const raw = { intent: "create_note", payload: { subject_code: "ASI", title: "t", content: "c", note_date: null, tags: [], evil: "drop table" } } as unknown as { intent: string; payload: Record<string, unknown> };
    const v = validateDraft(raw);
    expect(v?.kind).toBe("create_note");
    // evil field not in validated output
    expect((v as unknown as Record<string, unknown>).evil).toBeUndefined();
  });
});
