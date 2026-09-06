import { DEFAULT_WHATSAPP_TIME_ZONE, resolveNaturalDate } from "@/lib/whatsapp/dates";

export type LocalDraft = { intent: string; payload?: Record<string, unknown> };

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function subjectReference(text: string): string | undefined {
  return text.match(/\b(asi|redes?|ics|ta|pad|ago)\b/i)?.[1];
}

function eventType(text: string): string | null {
  const match = text.match(/\b(parcial|entrega|tarea|recuperatorio|exposicion)\b/);
  if (!match) return null;
  return match[1] === "exposicion" ? "exposición" : match[1];
}

export function isFallbackText(text: string): boolean {
  return /^(?:[¿?!.…]+)$/.test(text.trim());
}

function isRescheduleRequest(text: string): boolean {
  return /\b(?:pasar|pasaron|paso|pasa|pasame|mover|movi|mueve|movelo|cambiar|cambia\w*|adelantar|adelanta\w*|postergar|posterga\w*|reprogramar|reprograma\w*)\b/.test(text);
}

export function detectLocalDraft(text: string, timeZone = DEFAULT_WHATSAPP_TIME_ZONE): LocalDraft | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (/^\d{6}$/.test(normalized)) return { intent: "link", payload: { code: normalized } };
  if (/^(ayuda|help|menu)$/.test(normalized)) return { intent: "help" };

  if (/\b(que tengo|mis eventos|proximos eventos|ver eventos|lista de eventos)\b/.test(normalized)) {
    return { intent: "read_events", payload: normalized.includes("esta semana") ? { filter: "__week__" } : undefined };
  }
  if (/\b(esta semana|esta semana que tengo)\b/.test(normalized) && /\b(tengo|hay)\b/.test(normalized)) {
    return { intent: "read_events", payload: { filter: "__week__" } };
  }

  if (/\b(cuando curso|horario|horarios|se dicta|quien dicta|profe|profesor|docente)\b/.test(normalized)) {
    const reference = subjectReference(normalized);
    const allSubjects = /\b(cada|todas?|materias)\b/.test(normalized) && !reference;
    return {
      intent: "read_schedule",
      payload: { ...(reference ? { subject_code: reference } : {}), ...(allSubjects ? { all_subjects: true } : {}) },
    };
  }
  if (/\b(materias|subjects)\b/.test(normalized)) return { intent: "read_subjects" };
  if (/\b(apuntes|notas)\b/.test(normalized) && /\b(mis|ver|listar)\b/.test(normalized)) return { intent: "read_notes" };

  const type = eventType(normalized);
  const eventRequest = Boolean(type) || /\b(evento|anota|anotalo|agend|apunta|apuntalo|registra|crea|crear|nuevo)\b/.test(normalized);
  const date = resolveNaturalDate(normalized, new Date(), timeZone);
  if (eventRequest && date && !isRescheduleRequest(normalized)) {
    const reference = subjectReference(normalized);
    const label = type ?? "evento";
    return {
      intent: "create_event",
      payload: {
        title: `${label.charAt(0).toUpperCase()}${label.slice(1)}${reference ? ` de ${reference}` : ""}`,
        type: type ?? "otro",
        date,
        time: null,
        subject_code: reference ?? null,
        description: null,
        event_type: "individual",
      },
    };
  }

  return null;
}
