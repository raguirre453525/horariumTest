import "server-only";
import { getWhatsappConfig } from "@/lib/whatsapp/config";
import type { BotDraft } from "@/lib/whatsapp/validators";

const SYSTEM_PROMPT = `Sos el intérprete de Horarium. Entendé cada mensaje como una conversación real en español rioplatense, no como una orden de menú, y producí únicamente el JSON que necesita el backend.

Reglas prioritarias:
- Usá la historia reciente y el contexto de candidatos para entender pronombres y referencias. "ambos", "los dos", "todo", "ese", "el primero", "el segundo" y "el del martes" se refieren a los apuntes o eventos recién listados o mencionados. Si el referente es inequívoco, resolvelo sin preguntar "¿cuál?".
- Si una referencia no es inequívoca, devolvé intent "unknown". Nunca inventes IDs, materias ni fechas; para note_id, event_id y event_ids usá solamente IDs del contexto de candidatos.
- "borrar", "eliminar" o "cancelar" eventos usa events.cancel con payload {"event_ids":["..."]}. El bot SOLO cancela: es reversible, los eventos quedan guardados como cancelados. El borrado permanente es solo de admin y no tiene intent — nunca generes ni propongas JSON para borrar. Requiere confirmación posterior; no lo ejecutes desde este JSON.
- Reprogramar no es crear: "pasar", "mover", "cambiar", "adelantar", "postergar" o "reprogramar" algo recién mencionado usa events.edit/update_event con el event_id correcto y modifica solo la fecha u hora nueva.
- Usá events.create únicamente para un evento nuevo. No dupliques un evento recién mencionado salvo que la persona pida explícitamente crear/agendar otro.
- Las fechas relativas, días, meses y rangos deben conservar exactamente el alcance pedido. El backend normaliza las fechas; nunca reemplaces una semana futura por la actual.

Intents válidos:
- read_subjects, read_subject, read_schedule, read_notes, read_events
- notes.create/edit/archive/unarchive/delete
- events.create/edit/update/cancel/toggle_complete
- link, help, unknown

Consultas: "cuándo curso", horarios, profesor o docente usan read_schedule; "mostrame mis materias" usa read_subjects; "cada materia" en horarios usa {"all_subjects":true}; cualquier consulta de eventos usa read_events.

Formato exacto: {"intent":"...","payload":{...}}. Responde SOLO JSON válido, sin explicación ni texto adicional.`;

const CHAT_SYSTEM_PROMPT = `Sos el asistente de Horarium y respondés como un compañero de cursada: natural, cálido, claro y breve, en español rioplatense.

Conversá como una persona, no como un bot de menú. Contestá en 1 a 3 líneas, sin JSON ni listas de capacidades salvo que te pregunten qué podés hacer. Usá la historia reciente para responder y para resolver referencias como "ambos", "los dos", "todo", "ese", "el primero" o "el del martes" contra los eventos o apuntes recién mencionados.

Si el mensaje expresa una acción que el router no pudo estructurar, explicá qué entendiste y hacé una pregunta concreta sobre el siguiente paso. Podés proponer una acción futura —por ejemplo, "¿Querés que los cancele? Decime SI y lo hago"—, pero nunca digas ni insinúes que ya agendaste, creaste, editaste, moviste, cancelaste, guardaste, archivaste, eliminaste o completaste algo: las mutaciones solo existen después de una confirmación SI y una operación real. Nunca propongas un borrado permanente: si piden borrar o eliminar, ofrecé cancelar (se puede revertir) y aclará que el borrado definitivo lo hace un admin.

No inventes datos académicos. No muestres IDs, códigos internos, fechas ISO ni estados técnicos como pending, completed o cancelled. Formateá fechas de manera natural, por ejemplo "martes 8 de septiembre". Los saludos reciben un saludo cálido; una pregunta formada solo por "?" después de un mensaje del bot recibe una aclaración breve. Si preguntan por una mutación anterior, reconocé la confusión y ofrecé el próximo paso concreto sin afirmar que ocurrió.`;

export type DeepseekHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function callDeepseekDraft(
  userText: string,
  contextHint?: string,
  history: DeepseekHistoryMessage[] = [],
): Promise<BotDraft | null> {
  const cfg = getWhatsappConfig();
  if (!cfg.deepseekApiKey) {
    console.warn("[whatsapp] draft skipped", { stage: "no-key" });
    return null;
  }
  const fail = (stage: string, status?: number) => {
    console.warn("[whatsapp] draft failed", status === undefined ? { stage } : { stage, status });
    return null;
  };
  try {
    const body = {
      model: cfg.deepseekModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + (contextHint ? `\nContexto: ${contextHint}` : "") },
        ...history.slice(-5).map(({ role, content }) => ({ role, content: content.slice(0, 500) })),
        { role: "user", content: userText.slice(0, 2000) },
      ],
      temperature: 0.2,
      stream: false,
      response_format: { type: "json_object" },
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${cfg.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.deepseekApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return fail("http", res.status);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "";
    if (!content) return fail("empty");
    try {
      return JSON.parse(content) as BotDraft;
    } catch {
      return fail("parse");
    }
  } catch {
    return fail("fetch");
  }
}

export async function callDeepseekChat(userText: string, history: DeepseekHistoryMessage[] = [], contextHint?: string): Promise<string | null> {
  const cfg = getWhatsappConfig();
  const fail = () => {
    console.warn("[whatsapp] DeepSeek chat failed", { inputLength: userText.length });
    return null;
  };
  if (!cfg.deepseekApiKey) return fail();
  try {
    const body = {
      model: cfg.deepseekModel,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT + (contextHint ? `\n\n${contextHint}` : "") },
        ...history.slice(-5).map(({ role, content }) => ({ role, content: content.slice(0, 500) })),
        { role: "user", content: userText.slice(0, 2000) },
      ],
      temperature: 0.7,
      stream: false,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${cfg.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.deepseekApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return fail();
    const raw = typeof res.text === "function" ? await res.text() : JSON.stringify(await res.json()) ?? "";
    let content = raw;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string") content = parsed;
      else if (parsed && typeof parsed === "object") {
        const candidate = (parsed as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
        content = typeof candidate === "string" ? candidate : "";
      } else content = "";
    } catch {
      // Some compatible endpoints return the assistant text directly.
    }
    const trimmed = content.trim();
    if (!trimmed) return fail();
    return trimmed.split(/\r?\n/).slice(0, 2).join("\n").slice(0, 1000) || null;
  } catch {
    return fail();
  }
}
