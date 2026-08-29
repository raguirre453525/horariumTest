export const LINK_INSTRUCTIONS = `Tu número no está vinculado a Horarium.

Para vincularlo:
1. Iniciá sesión en Horarium en tu navegador.
2. Andá a Configuración o tocá tu avatar arriba a la derecha.
3. Generá un código de vinculación (válido 10 minutos).
4. Enviame ese código por aquí.

Si ya tenés un código, envialo ahora.`;

export const HELP_TEXT = `Puedo ayudarte con:

• Materias y horarios: "mostrame mis materias", "horario de ASI"
• Apuntes: "mis apuntes", "crear apunte para RED título ...", "archivar apunte"
• Eventos: "próximos eventos", "crear evento parcial fecha ...", "cancelar evento"

Para acciones que cambian datos te pediré confirmar con SI o NO.
Los cambios expiran en 10 minutos si no confirmás.`;

export function formatConfirmSummary(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "create_note":
      return `Vas a crear un apunte para ${String(payload.subject_code)}:\nTítulo: ${String(payload.title)}\nContenido: ${String(payload.content).slice(0, 200)}\n¿Confirmás? Respondé SI para crear o NO para cancelar.`;
    case "edit_note":
      return `Vas a editar el apunte ${String(payload.note_id).slice(0, 8)} con: ${JSON.stringify(payload)}\n¿Confirmás? Respondé SI o NO.`;
    case "archive_note":
      return `Vas a archivar el apunte ${String(payload.note_id).slice(0, 8)}. Respondé SI para confirmar o NO para cancelar.`;
    case "unarchive_note":
      return `Vas a desarchivar el apunte ${String(payload.note_id).slice(0, 8)}. Respondé SI para confirmar o NO para cancelar.`;
    case "delete_note":
      return `Vas a eliminar definitivamente el apunte ${String(payload.note_id).slice(0, 8)}. Esta acción no se puede deshacer. Respondé SI para eliminar o NO para cancelar.`;
    case "create_event":
      return `Vas a crear un evento "${String(payload.title)}" tipo ${String(payload.type)} el ${String(payload.date)}${payload.time ? ` a las ${String(payload.time)}` : ""} ${payload.subject_code ? `para ${String(payload.subject_code)}` : ""}.\n¿Confirmás? SI/NO`;
    case "edit_event":
      return `Vas a editar el evento ${String(payload.event_id).slice(0, 8)} con: ${JSON.stringify(payload)}.\n¿Confirmás? SI/NO`;
    case "cancel_event":
      return `Vas a cancelar el evento ${String(payload.event_id).slice(0, 8)}. El evento quedará como cancelado (no se elimina permanentemente) y se podrá revertir. Respondé SI para cancelar o NO para mantenerlo.`;
    case "toggle_complete": {
      const isGroup = (payload as { event_type?: string }).event_type === "grupal";
      if (isGroup) return `Vas a cambiar el estado de completado grupal del evento ${String(payload.event_id).slice(0, 8)}. Atención: esto afecta a todos los participantes. Respondé SI para confirmar o NO para cancelar.`;
      return `Vas a cambiar tu tilde de completado para el evento ${String(payload.event_id).slice(0, 8)} (solo para vos). Respondé SI o NO.`;
    }
    default:
      return `Vas a ejecutar ${kind} con ${JSON.stringify(payload)}. Respondé SI para confirmar o NO para cancelar.`;
  }
}

export function ambiguousChoices<T>(items: T[], getLabel: (t: T, i: number) => string): string {
  const lines = items.slice(0, 10).map((it, idx) => `${idx + 1}. ${getLabel(it, idx)}`);
  return `Encontré varias opciones. Respondé con el número:\n${lines.join("\n")}`;
}
