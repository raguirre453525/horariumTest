import { DEFAULT_WHATSAPP_TIME_ZONE, resolveEventDateRange, resolveNaturalDate, type EventDateRange } from "@/lib/whatsapp/dates";

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

const EVENT_READ_TERMS = /\b(?:evento|eventos|fecha|fechas|parcial|entrega|tarea|recuperatorio|exposicion)\b/;
const EVENT_READ_STOP_WORDS = new Set([
  "al",
  "busca",
  "buscame",
  "buscar",
  "calendario",
  "como",
  "con",
  "de",
  "del",
  "desde",
  "fecha",
  "fechas",
  "el",
  "en",
  "entre",
  "esta",
  "este",
  "dame",
  "eventos",
  "evento",
  "hay",
  "hoy",
  "la",
  "las",
  "lista",
  "listar",
  "los",
  "manana",
  "mes",
  "mis",
  "mostrame",
  "mostrar",
  "pasado",
  "para",
  "pero",
  "por",
  "proxima",
  "proximo",
  "proximas",
  "proximos",
  "que",
  "semana",
  "si",
  "tengo",
  "tambien",
  "entonces",
  "una",
  "un",
  "ver",
  "y",
  "viene",
  "hasta",
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  ...Object.keys({ enero: 1, febrero: 1, marzo: 1, abril: 1, mayo: 1, junio: 1, julio: 1, agosto: 1, septiembre: 1, setiembre: 1, octubre: 1, noviembre: 1, diciembre: 1 }),
]);

export function isEventReadRequest(text: string, hasPreviousRange = false): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/\b(?:agend\w*|anot\w*|apunt\w*|registr\w*|cre\w*|nuevo|nueva)\b/.test(normalized)) return false;
  if (/\bque\b.*\b(?:tengo|hay)\b/.test(normalized)) return true;
  if (/\b(?:tengo|hay)\b.*\b(?:evento|eventos)\b/.test(normalized)) return true;
  if (/\b(?:mis eventos|proximos eventos|ver eventos|lista de eventos)\b/.test(normalized)) return true;
  if (/\b(?:busca\w*|mostra\w*|ver|lista\w*|dame)\b/.test(normalized) && (EVENT_READ_TERMS.test(normalized) || (hasPreviousRange && /\b(?:calendario|fecha|fechas|semana|mes|manana|hoy|domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.test(normalized)))) return true;
  return hasPreviousRange && /\b(?:y|pero|tambien)\b/.test(normalized) && (EVENT_READ_TERMS.test(normalized) || /\b(?:tengo|hay|manana|hoy|semana|mes|domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.test(normalized));
}

export function extractEventSearchQuery(text: string): string | undefined {
  const tokens = normalizeText(text).match(/[a-z0-9áéíóúüñ]+/g) ?? [];
  const query = tokens.filter((token) => !EVENT_READ_STOP_WORDS.has(token) && !/^\d+$/.test(token)).join(" ");
  return query || undefined;
}

export function isFallbackText(text: string): boolean {
  return /^(?:[¿?!.…]+)$/.test(text.trim());
}

function isRescheduleRequest(text: string): boolean {
  return /\b(?:pasar|pasaron|paso|pasa|pasame|mover|movi|mueve|movelo|cambiar|cambia\w*|adelantar|adelanta\w*|postergar|posterga\w*|reprogramar|reprograma\w*)\b/.test(text);
}

export function detectLocalDraft(text: string, timeZone = DEFAULT_WHATSAPP_TIME_ZONE, previousRange?: EventDateRange): LocalDraft | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (/^\d{6}$/.test(normalized)) return { intent: "link", payload: { code: normalized } };
  if (/^(ayuda|help|menu)$/.test(normalized)) return { intent: "help" };

  if (isEventReadRequest(normalized, Boolean(previousRange))) {
    const eventRange = resolveEventDateRange(normalized, new Date(), timeZone, previousRange);
    const query = extractEventSearchQuery(normalized);
    const payload: Record<string, unknown> = {};
    if (eventRange) {
      if (/\besta semana\b/.test(normalized)) payload.filter = "__week__";
      else {
        payload.from = eventRange.from;
        payload.to = eventRange.to;
      }
    }
    if (query) payload.query = query;
    return { intent: "read_events", payload: Object.keys(payload).length > 0 ? payload : undefined };
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
