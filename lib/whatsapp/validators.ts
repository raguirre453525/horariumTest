export const NOTE_STATUS = ["active", "archived"] as const;
export const EVENT_TYPES = ["parcial", "entrega", "tarea", "recuperatorio", "exposición", "otro"] as const;
export const EVENT_STATUS = ["pending", "completed", "cancelled"] as const;
export const EVENT_TYPE_MODE = ["individual", "grupal"] as const;

export type BotDraft = {
  intent: string;
  payload?: Record<string, unknown>;
};

export type ValidatedDraft =
  | { kind: "read_subjects" }
  | { kind: "read_subject"; subject_code: string }
  | { kind: "read_schedule"; subject_code?: string }
  | { kind: "read_notes"; subject_code?: string; query?: string }
  | { kind: "read_events"; filter?: string }
  | { kind: "create_note"; subject_code: string; title: string; content: string; note_date: string | null; tags: string[] }
  | { kind: "edit_note"; note_id: string; title?: string; content?: string; note_date?: string | null; tags?: string[] }
  | { kind: "archive_note"; note_id: string }
  | { kind: "unarchive_note"; note_id: string }
  | { kind: "delete_note"; note_id: string }
  | { kind: "create_event"; title: string; type: (typeof EVENT_TYPES)[number]; date: string; time: string | null; subject_code: string | null; description: string | null; event_type: (typeof EVENT_TYPE_MODE)[number] }
  | { kind: "edit_event"; event_id: string; title?: string; type?: (typeof EVENT_TYPES)[number]; date?: string; time?: string | null; subject_code?: string | null; description?: string | null; status?: (typeof EVENT_STATUS)[number]; event_type?: (typeof EVENT_TYPE_MODE)[number] }
  | { kind: "cancel_event"; event_id: string }
  | { kind: "toggle_complete"; event_id: string }
  | { kind: "link"; code: string }
  | { kind: "help" }
  | { kind: "unknown" };

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}
function isValidTime(s: string): boolean {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}
function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}
function requireStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) return null;
  return t;
}

export function validateDraft(raw: BotDraft): ValidatedDraft | null {
  if (!raw || typeof raw.intent !== "string") return null;
  const intent = raw.intent.trim().toLowerCase();
  const p = (raw.payload ?? {}) as Record<string, unknown>;

  // read
  if (intent === "read_subjects" || intent === "read.subjects") return { kind: "read_subjects" };
  if (intent === "read_subject") {
    const code = typeof p.subject_code === "string" ? p.subject_code.trim().toUpperCase().slice(0, 20) : "";
    if (!code) return null;
    return { kind: "read_subject", subject_code: code };
  }
  if (intent === "read_schedule") {
    const code = typeof p.subject_code === "string" ? p.subject_code.trim().toUpperCase().slice(0, 20) : undefined;
    return { kind: "read_schedule", subject_code: code || undefined };
  }
  if (intent === "read_notes") {
    const code = typeof p.subject_code === "string" ? p.subject_code.trim().toUpperCase().slice(0, 20) : undefined;
    const q = typeof p.query === "string" ? p.query.trim().slice(0, 100) : undefined;
    return { kind: "read_notes", subject_code: code || undefined, query: q || undefined };
  }
  if (intent === "read_events") {
    const f = typeof p.filter === "string" ? p.filter.trim().slice(0, 100) : undefined;
    return { kind: "read_events", filter: f || undefined };
  }
  if (intent === "help") return { kind: "help" };
  if (intent === "unknown") return { kind: "unknown" };

  // link
  if (intent === "link") {
    const code = typeof p.code === "string" ? p.code.trim() : typeof (raw as unknown as { code?: string }).code === "string" ? String((raw as unknown as { code?: string }).code).trim() : "";
    // also allow raw payload code or direct
    const final = code || (typeof p.code === "string" ? p.code : "");
    const c = String(final).trim().slice(0, 20);
    if (!c) return null;
    return { kind: "link", code: c };
  }

  // notes mutations
  if (intent === "notes.create" || intent === "create_note") {
    const subject_code = typeof p.subject_code === "string" ? p.subject_code.trim().toUpperCase().slice(0, 20) : "";
    const title = requireStr(p.title, 120);
    const content = requireStr(p.content, 2000);
    if (!subject_code || !title || !content) return null;
    const note_date = typeof p.note_date === "string" && p.note_date.trim() ? p.note_date.trim() : null;
    if (note_date && !isValidDate(note_date)) return null;
    const tagsRaw = Array.isArray(p.tags) ? (p.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 30)) : [];
    return { kind: "create_note", subject_code, title, content, note_date, tags: tagsRaw };
  }
  if (intent === "notes.edit" || intent === "edit_note") {
    const note_id = typeof p.note_id === "string" ? p.note_id.trim() : "";
    if (!note_id) return null;
    const out: ValidatedDraft & { kind: "edit_note" } = { kind: "edit_note", note_id } as ValidatedDraft & { kind: "edit_note" };
    if (p.title !== undefined) {
      const t = clampStr(p.title, 120);
      if (t) (out as unknown as Record<string, unknown>).title = t;
      else return null;
    }
    if (p.content !== undefined) {
      const c = clampStr(p.content, 2000);
      if (c) (out as unknown as Record<string, unknown>).content = c;
      else return null;
    }
    if (p.note_date !== undefined) {
      if (p.note_date === null) (out as unknown as Record<string, unknown>).note_date = null;
      else if (typeof p.note_date === "string" && p.note_date.trim() === "") (out as unknown as Record<string, unknown>).note_date = null;
      else if (typeof p.note_date === "string" && isValidDate(p.note_date.trim())) (out as unknown as Record<string, unknown>).note_date = p.note_date.trim();
      else return null;
    }
    if (p.tags !== undefined) {
      if (!Array.isArray(p.tags)) return null;
      (out as unknown as Record<string, unknown>).tags = (p.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 30));
    }
    if (!("title" in out) && !("content" in out) && !("note_date" in out) && !("tags" in out)) return null;
    return out;
  }
  if (intent === "notes.archive" || intent === "archive_note") {
    const id = typeof p.note_id === "string" ? p.note_id.trim() : "";
    if (!id) return null;
    return { kind: "archive_note", note_id: id };
  }
  if (intent === "notes.unarchive" || intent === "unarchive_note") {
    const id = typeof p.note_id === "string" ? p.note_id.trim() : "";
    if (!id) return null;
    return { kind: "unarchive_note", note_id: id };
  }
  if (intent === "notes.delete" || intent === "delete_note") {
    const id = typeof p.note_id === "string" ? p.note_id.trim() : "";
    if (!id) return null;
    return { kind: "delete_note", note_id: id };
  }

  // events mutations
  if (intent === "events.create" || intent === "create_event") {
    const title = requireStr(p.title, 160);
    const type = typeof p.type === "string" ? p.type.trim() : "";
    const date = typeof p.date === "string" ? p.date.trim() : "";
    if (!title || !type || !date) return null;
    if (!(EVENT_TYPES as readonly string[]).includes(type)) return null;
    if (!isValidDate(date)) return null;
    let time: string | null = null;
    if (p.time !== undefined && p.time !== null && String(p.time).trim() !== "") {
      const t = String(p.time).trim().slice(0, 5);
      if (!isValidTime(t)) return null;
      time = t;
    }
    const subject_code = typeof p.subject_code === "string" && p.subject_code.trim() ? p.subject_code.trim().toUpperCase().slice(0, 20) : null;
    const description = typeof p.description === "string" && p.description.trim() ? p.description.trim().slice(0, 2000) : null;
    const event_type = typeof p.event_type === "string" && (EVENT_TYPE_MODE as readonly string[]).includes(p.event_type) ? (p.event_type as (typeof EVENT_TYPE_MODE)[number]) : "individual";
    return { kind: "create_event", title, type: type as (typeof EVENT_TYPES)[number], date, time, subject_code, description, event_type };
  }
  if (intent === "events.edit" || intent === "edit_event") {
    const event_id = typeof p.event_id === "string" ? p.event_id.trim() : "";
    if (!event_id) return null;
    const out: Record<string, unknown> = { kind: "edit_event", event_id };
    if (p.title !== undefined) {
      const t = clampStr(p.title, 160);
      if (!t) return null;
      out.title = t;
    }
    if (p.type !== undefined) {
      const t = String(p.type).trim();
      if (!(EVENT_TYPES as readonly string[]).includes(t)) return null;
      out.type = t;
    }
    if (p.date !== undefined) {
      const d = String(p.date).trim();
      if (!isValidDate(d)) return null;
      out.date = d;
    }
    if (p.time !== undefined) {
      if (p.time === null || String(p.time).trim() === "") out.time = null;
      else {
        const t = String(p.time).trim().slice(0, 5);
        if (!isValidTime(t)) return null;
        out.time = t;
      }
    }
    if (p.subject_code !== undefined) {
      if (p.subject_code === null || String(p.subject_code).trim() === "") out.subject_code = null;
      else out.subject_code = String(p.subject_code).trim().toUpperCase().slice(0, 20);
    }
    if (p.description !== undefined) {
      if (p.description === null || String(p.description).trim() === "") out.description = null;
      else out.description = String(p.description).trim().slice(0, 2000);
    }
    if (p.status !== undefined) {
      const s = String(p.status).trim();
      // only pending/cancelled allowed via edit_event; completion must use toggle_complete
      if (s !== "pending" && s !== "cancelled") return null;
      out.status = s;
    }
    if (p.event_type !== undefined) {
      const et = String(p.event_type).trim();
      if (!(EVENT_TYPE_MODE as readonly string[]).includes(et)) return null;
      out.event_type = et;
    }
    // must have at least one field besides event_id
    const keys = Object.keys(out).filter((k) => k !== "kind" && k !== "event_id");
    if (keys.length === 0) return null;
    return out as unknown as ValidatedDraft;
  }
  if (intent === "events.cancel" || intent === "cancel_event") {
    const id = typeof p.event_id === "string" ? p.event_id.trim() : "";
    if (!id) return null;
    return { kind: "cancel_event", event_id: id };
  }
  if (intent === "events.toggle_complete" || intent === "toggle_complete") {
    const id = typeof p.event_id === "string" ? p.event_id.trim() : "";
    if (!id) return null;
    return { kind: "toggle_complete", event_id: id };
  }

  return null;
}

// allowlist check for bot permission
export const ALLOWED_KINDS = new Set<string>([
  "read_subjects",
  "read_subject",
  "read_schedule",
  "read_notes",
  "read_events",
  "create_note",
  "edit_note",
  "archive_note",
  "unarchive_note",
  "delete_note",
  "create_event",
  "edit_event",
  "cancel_event",
  "toggle_complete",
  "link",
  "help",
  "unknown",
]);

export function isDeletionKind(kind: string): boolean {
  // event permanent deletion is never allowed; we only allow cancel
  return kind === "delete_event";
}
