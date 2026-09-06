export const LINK_INSTRUCTIONS = `¡Buenas! 👋 Este número todavía no está vinculado a Horarium.

Iniciá sesión en Horarium, abrí Configuración y generá tu código de vinculación. Dura 10 minutos: mandámelo por acá y seguimos.

Si ya tenés el código, enviámelo ahora.`;

export const HELP_TEXT = `¡Dale! Puedo darte una mano con:

📚 materias y horarios · 👨‍🏫 docentes · 📝 apuntes · 📅 eventos

Probá: “mostrame mis materias”, “cuándo curso Redes” o “qué tengo esta semana”. Para guardar o cambiar algo, siempre te voy a pedir un SI o NO. La confirmación dura 10 minutos.`;

export const FALLBACK_TEXT = `¡Te leo! 🤔 No terminé de entenderte. Probá con “mostrame mis materias”, “cuándo curso Redes” o “qué tengo esta semana”.`;

const FIELD_LABELS: Record<string, string> = {
  title: "título",
  content: "contenido",
  note_date: "fecha",
  tags: "etiquetas",
  date: "fecha",
  time: "hora",
  subject_code: "materia",
  description: "detalle",
  type: "tipo",
  status: "estado",
  event_type: "modalidad",
};

function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function formatNaturalDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "fecha sin definir";
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return "fecha sin definir";
  const parts = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.weekday ?? ""} ${values.day ?? ""} de ${values.month ?? ""}`.trim();
}

function formatTime(value: unknown): string {
  const time = String(value ?? "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : "";
}

export function formatEventLabel(event: Record<string, unknown>): string {
  const title = String(event.title ?? "").trim();
  const subject = String(event._subject_name ?? relation(event.subjects)?.name ?? "").trim();
  if (!title) return subject ? `Evento de ${subject}` : "Evento";
  if (!subject || normalize(title).includes(normalize(subject))) return title;
  return `${title} de ${subject}`;
}

export function formatEventLine(event: Record<string, unknown>): string {
  const date = formatNaturalDate(event.date);
  const time = formatTime(event.time);
  return `• ${formatEventLabel(event)} — ${date}${time ? ` a las ${time}` : ""}`;
}

function formatValue(key: string, value: unknown, subjectName?: string): string {
  if (key === "date" || key === "note_date") return formatNaturalDate(value);
  if (key === "status") return ({ pending: "pendiente", cancelled: "cancelado", completed: "completado" } as Record<string, string>)[String(value)] ?? String(value);
  if (key === "subject_code") return subjectName ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function eventGroupLabel(events: Array<Record<string, unknown>>, count: number): string {
  const labels: Record<string, [string, string]> = {
    parcial: ["parcial", "parciales"],
    entrega: ["entrega", "entregas"],
    tarea: ["tarea", "tareas"],
    recuperatorio: ["recuperatorio", "recuperatorios"],
    "exposición": ["exposición", "exposiciones"],
  };
  const types = [...new Set(events.map((event) => String(event.type ?? "")))];
  const typeLabel = types.length === 1 ? labels[types[0] ?? ""] : undefined;
  if (count === 1) return typeLabel ? `este ${typeLabel[0]}` : "este evento";
  const amount = count === 2 ? "dos" : String(count);
  return typeLabel ? `los ${amount} ${typeLabel[1]}` : `los ${amount} eventos`;
}

function changes(payload: Record<string, unknown>, ignored: string[]): string {
  return Object.entries(payload)
    .filter(([key]) => !ignored.includes(key) && !key.startsWith("_"))
    .map(([key, value]) => {
      const formatted = formatValue(key, value, typeof payload._subject_name === "string" ? payload._subject_name : undefined);
      return formatted ? `${FIELD_LABELS[key] ?? key}: ${formatted}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

export function formatConfirmSummary(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "create_note": {
      const subject = typeof payload._subject_name === "string" ? payload._subject_name : "la materia indicada";
      return `📝 Voy a crear un apunte para ${subject}:\nTítulo: ${String(payload.title)}\nContenido: ${String(payload.content).slice(0, 200)}\n\n¿Está bien? Respondé SI para crear o NO para cancelar. Tenés 10 minutos.`;
    }
    case "edit_note":
      return `📝 Voy a editar el apunte seleccionado.\nCambios: ${changes(payload, ["note_id"])}\n\nRespondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
    case "archive_note":
      return `🗂️ Voy a archivar el apunte seleccionado. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
    case "unarchive_note":
      return `🗂️ Voy a volver a activar el apunte seleccionado. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
    case "delete_note":
      return `⚠️ Voy a eliminar definitivamente el apunte seleccionado. No se puede deshacer. Respondé SI para eliminar o NO para cancelar. Tenés 10 minutos.`;
    case "create_event": {
      const subject = typeof payload._subject_name === "string" ? `, para ${payload._subject_name}` : "";
      const time = formatTime(payload.time);
      return `📅 Voy a agendar “${String(payload.title)}” el ${formatNaturalDate(payload.date)}${time ? ` a las ${time}` : ""}${subject}.\n\n¿Está bien? Respondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
    }
    case "edit_event":
      if (typeof payload._previous_date === "string" && typeof payload.date === "string" && payload._previous_date !== payload.date) {
        const title = typeof payload._previous_title === "string" ? payload._previous_title : "evento seleccionado";
        const time = formatTime(payload.time);
        return `📅 Voy a mover “${title}”.\nFecha: ${formatNaturalDate(payload._previous_date)} → ${formatNaturalDate(payload.date)}${time ? ` · hora: ${time}` : ""}\n\nRespondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
      }
      return `📅 Voy a editar el evento seleccionado.\nCambios: ${changes(payload, ["event_id"])}\n\nRespondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
    case "cancel_event":
      return `📅 Voy a cancelar el evento seleccionado. Queda guardado como cancelado y después podés revertirlo. Respondé SI para cancelar o NO para dejarlo como está. Tenés 10 minutos.`;
    case "cancel_events": {
      const events = Array.isArray(payload._events) ? payload._events.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object") : [];
      const count = Array.isArray(payload.event_ids) ? payload.event_ids.length : events.length;
      const noun = eventGroupLabel(events, count);
      const details = events.map(formatEventLine).join("\n");
      return `📅 ¿Cancelo ${noun}? Quedan guardados como cancelados y después los podés revertir.${details ? `\n${details}` : ""}\n\nRespondeme SI o NO. Tenés 10 minutos.`;
    }
    case "toggle_complete": {
      const isGroup = (payload as { event_type?: string }).event_type === "grupal";
      if (isGroup) return `✅ Voy a cambiar el estado del evento grupal seleccionado. Ojo: esto afecta a todos los participantes. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
      return `✅ Voy a cambiar tu tilde de completado del evento seleccionado (solo para vos). Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
    }
    default:
      return `Voy a ejecutar esa acción con los datos que vimos. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
  }
}

export function ambiguousChoices<T>(items: T[], getLabel: (t: T, i: number) => string): string {
  const lines = items.slice(0, 10).map((it, idx) => `${idx + 1}. ${getLabel(it, idx)}`);
  return `🤔 Encontré varias opciones. Respondé con el número que corresponda:\n${lines.join("\n")}`;
}
