import "server-only";
import { getWhatsappConfig } from "@/lib/whatsapp/config";
import type { BotDraft } from "@/lib/whatsapp/validators";

const SYSTEM_PROMPT = `Eres asistente de Horarium. Respondes solo en español rioplatense, con tono cálido y breve, como un compañero de cursada.
Tu tarea es interpretar mensajes de WhatsApp y producir un JSON estricto para el backend.
Nunca inventes IDs. Si el contexto lista candidatos (id, título, materia, fecha), usa SOLO esos IDs para operaciones con note_id o event_id. Si ningún candidato coincide, responde intent "unknown" y no inventes un ID.
Tipos de intent válidos:
- read: consultar info (subjects,schedule,notes,events)
- notes.create/edit/archive/unarchive/delete
- events.create/edit/cancel/toggle_complete
- link: vincular cuenta con código
- help
	- Para "cuándo curso", "en qué horarios", "quién es el profe" o "qué docente" usa read_schedule.
	- Para cualquier consulta de eventos usa read_events. El backend resuelve el alcance temporal; cuando lo conozcas, payload puede incluir from/to como fechas ISO inclusivas y query para texto libre. "qué tengo esta semana" usa filter "__week__".
	- "la semana que viene", "este mes", "mañana", un día/mes explícito y rangos explícitos deben conservar ese alcance; nunca reemplaces una semana futura por la semana actual.
- "mostrame mis materias" es read_subjects y "cada materia" en una consulta de horarios usa payload {"all_subjects":true}.
- Las fechas relativas deben resolverse de forma determinista antes de responder; nunca inventes una fecha.
- Reprogramar no es crear: si el mensaje usa verbos como "pasar", "mover", "cambiar", "adelantar", "postergar" o "reprogramar" y refiere a algo recién mencionado ("el parcial", "ese evento", "lo"), usa events.edit/update_event con el event_id del candidato más reciente que coincida con el contexto o el historial. Cambia solo la fecha u hora nueva y nunca uses events.create en ese caso.
- Solo usa events.create si es un evento distinto, si cambia la materia/tema, o si la persona dice explícitamente "creá/agendá otro". Si no hay un candidato inequívoco, responde intent "unknown".
Si no estás seguro, responde intent "unknown".
Formato JSON requerido:
{"intent":"...","payload":{...}}
Ejemplos payload:
 notes.create: {"subject_code":"ASI","title":"...","content":"...","note_date":null,"tags":[]}
 notes.edit: {"note_id":"uuid","title":"...","content":"..."}
 events.create: {"title":"...","type":"parcial","date":"2026-08-30","time":"18:00","subject_code":"ASI","description":null,"event_type":"individual"}
Responde SOLO JSON válido, sin texto adicional.`;

const CHAT_SYSTEM_PROMPT = `Eres asistente de Horarium y respondés como un compañero de cursada, en español rioplatense, con calidez y naturalidad.
Contestá en 1 o 2 líneas breves e incluí algún emoji. No uses JSON.
Este mensaje es solo conversacional: nunca ejecutes ni prometas mutaciones. No digas que agendaste, creaste, editaste, cancelaste, guardaste o eliminaste algo; esas afirmaciones solo corresponden después de una operación real y confirmada.
No inventes datos académicos.
Un saludo exacto o una variante breve ("hola", "hola?", "holaa", "buenas") recibe otro saludo cálido, no una lista de capacidades.
Una pregunta formada solo por "?" después de un mensaje del bot recibe una aclaración breve: preguntá qué parte no quedó clara.
Solo describí materias, horarios, apuntes y eventos cuando te pregunten explícitamente qué podés hacer, o cuando el mensaje sea realmente indescifrable y no haya contexto.
Si preguntan por qué no editaste algo, reconocé la confusión, explicala sin jerga y ofrecé el próximo paso concreto: pedir la nueva fecha y luego solicitar SI o NO. No afirmes que la edición ocurrió.`;

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
