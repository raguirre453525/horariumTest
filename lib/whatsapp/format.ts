export const LINK_INSTRUCTIONS = `¡Buenas! 👋 Este número todavía no está vinculado a Horarium.

Iniciá sesión en Horarium, abrí Configuración y generá tu código de vinculación. Dura 10 minutos: mandámelo por acá y seguimos.

Si ya tenés el código, enviámelo ahora.`;

export const HELP_TEXT = `¡Dale! Puedo darte una mano con:

📚 materias y horarios · 👨‍🏫 docentes · 📝 apuntes · 📅 eventos

Probá: “mostrame mis materias”, “cuándo curso RED” o “qué tengo esta semana”. Para guardar o cambiar algo, siempre te voy a pedir un SI o NO. La confirmación dura 10 minutos.`;

export const FALLBACK_TEXT = `¡Te leo! 🤔 No terminé de entenderte. Probá con “mostrame mis materias”, “cuándo curso RED” o “qué tengo esta semana”.`;

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

function changes(payload: Record<string, unknown>, ignored: string[]): string {
  return Object.entries(payload)
    .filter(([key]) => !ignored.includes(key))
    .map(([key, value]) => `${FIELD_LABELS[key] ?? key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

export function formatConfirmSummary(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "create_note":
      return `📝 Voy a crear un apunte para ${String(payload.subject_code)}:\nTítulo: ${String(payload.title)}\nContenido: ${String(payload.content).slice(0, 200)}\n\n¿Está bien? Respondé SI para crear o NO para cancelar. Tenés 10 minutos.`;
    case "edit_note":
      return `📝 Voy a editar el apunte ${String(payload.note_id).slice(0, 8)}.\nCambios: ${changes(payload, ["note_id"])}\n\nRespondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
    case "archive_note":
      return `🗂️ Voy a archivar el apunte ${String(payload.note_id).slice(0, 8)}. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
    case "unarchive_note":
      return `🗂️ Voy a volver a activar el apunte ${String(payload.note_id).slice(0, 8)}. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
    case "delete_note":
      return `⚠️ Voy a eliminar definitivamente el apunte ${String(payload.note_id).slice(0, 8)}. No se puede deshacer. Respondé SI para eliminar o NO para cancelar. Tenés 10 minutos.`;
    case "create_event":
      return `📅 Voy a agendar “${String(payload.title)}”, tipo ${String(payload.type)}, el ${String(payload.date)}${payload.time ? ` a las ${String(payload.time)}` : ""}${payload.subject_code ? `, para ${String(payload.subject_code)}` : ""}.\n\n¿Está bien? Respondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
    case "edit_event":
      return `📅 Voy a editar el evento ${String(payload.event_id).slice(0, 8)}.\nCambios: ${changes(payload, ["event_id"])}\n\nRespondé SI para guardar o NO para cancelar. Tenés 10 minutos.`;
    case "cancel_event":
      return `📅 Voy a cancelar el evento ${String(payload.event_id).slice(0, 8)}. Queda como cancelado; no lo borro y después podés revertirlo. Respondé SI para cancelar o NO para dejarlo como está. Tenés 10 minutos.`;
    case "toggle_complete": {
      const isGroup = (payload as { event_type?: string }).event_type === "grupal";
      if (isGroup) return `✅ Voy a cambiar el estado del evento grupal ${String(payload.event_id).slice(0, 8)}. Ojo: esto afecta a todos los participantes. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
      return `✅ Voy a cambiar tu tilde de completado del evento ${String(payload.event_id).slice(0, 8)} (solo para vos). Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
    }
    default:
      return `Voy a ejecutar esa acción con los datos que vimos. Respondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`;
  }
}

export function ambiguousChoices<T>(items: T[], getLabel: (t: T, i: number) => string): string {
  const lines = items.slice(0, 10).map((it, idx) => `${idx + 1}. ${getLabel(it, idx)}`);
  return `🤔 Encontré varias opciones. Respondé con el número que corresponda:\n${lines.join("\n")}`;
}
