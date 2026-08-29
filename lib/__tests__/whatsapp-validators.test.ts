import { describe, it, expect } from "vitest";
import { validateDraft, ALLOWED_KINDS } from "@/lib/whatsapp/validators";

describe("validateDraft model output validation", () => {
  it("validates create_note with limits", () => {
    const v = validateDraft({ intent: "create_note", payload: { subject_code: "ASI", title: "Titulo", content: "Contenido", note_date: "2026-08-30", tags: ["a", "b"] } });
    expect(v?.kind).toBe("create_note");
    expect((v as { tags: string[] }).tags).toEqual(["a", "b"]);
  });

  it("rejects create_note with missing title", () => {
    expect(validateDraft({ intent: "create_note", payload: { subject_code: "ASI", content: "x" } })).toBeNull();
  });

  it("rejects oversized title", () => {
    expect(validateDraft({ intent: "create_note", payload: { subject_code: "ASI", title: "a".repeat(200), content: "x" } })).toBeNull();
  });

  it("rejects invalid date", () => {
    expect(validateDraft({ intent: "create_note", payload: { subject_code: "ASI", title: "t", content: "c", note_date: "not-a-date" } })).toBeNull();
  });

  it("validates create_event with enum checks", () => {
    const v = validateDraft({ intent: "create_event", payload: { title: "Parcial", type: "parcial", date: "2026-08-30", time: "18:00", subject_code: "ASI", description: null, event_type: "individual" } });
    expect(v?.kind).toBe("create_event");
  });

  it("rejects invalid event type", () => {
    expect(validateDraft({ intent: "create_event", payload: { title: "x", type: "invalido", date: "2026-08-30" } })).toBeNull();
  });

  it("rejects event deletion kind not in allowlist", () => {
    // simulate model trying to delete event permanently
    const v = validateDraft({ intent: "delete_event", payload: { event_id: "uuid" } } as unknown as { intent: string; payload: Record<string, unknown> });
    expect(v).toBeNull();
    expect(ALLOWED_KINDS.has("delete_event")).toBe(false);
  });

  it("allows cancel_event but not delete_event", () => {
    expect(ALLOWED_KINDS.has("cancel_event")).toBe(true);
    expect(ALLOWED_KINDS.has("delete_event")).toBe(false);
    const v = validateDraft({ intent: "cancel_event", payload: { event_id: "uuid-123" } });
    expect(v?.kind).toBe("cancel_event");
  });

  it("rejects generic SQL or admin intent", () => {
    expect(validateDraft({ intent: "admin", payload: {} })).toBeNull();
    expect(validateDraft({ intent: "sql", payload: { query: "select *" } })).toBeNull();
  });

  it("validates link code", () => {
    const v = validateDraft({ intent: "link", payload: { code: "123456" } });
    expect(v?.kind).toBe("link");
  });

  it("treats all model output as untrusted: rejects extra fields without allowlist", () => {
    const v = validateDraft({ intent: "create_note", payload: { subject_code: "ASI", title: "t", content: "c", attachments: ["evil"] } as unknown as Record<string, unknown> });
    // attachments not allowed, but we ignore unknown fields -> still validates core, but attachments not persisted
    expect(v?.kind).toBe("create_note");
    // ensure payload does not contain attachments after validation
    expect((v as unknown as Record<string, unknown>).attachments).toBeUndefined();
  });

  it("allowlist covers only common-user actions (no admin, no permanent deletion)", () => {
    const forbidden = ["delete_event", "admin", "sql", "attachment", "comment", "live_note"];
    for (const f of forbidden) expect(ALLOWED_KINDS.has(f)).toBe(false);
    const allowed = ["create_note", "edit_note", "archive_note", "unarchive_note", "delete_note", "create_event", "edit_event", "cancel_event", "toggle_complete"];
    for (const a of allowed) expect(ALLOWED_KINDS.has(a)).toBe(true);
  });

  it("toggle_complete validates event_id", () => {
    expect(validateDraft({ intent: "toggle_complete", payload: { event_id: "evt-1" } })?.kind).toBe("toggle_complete");
    expect(validateDraft({ intent: "toggle_complete", payload: {} })).toBeNull();
  });
});
