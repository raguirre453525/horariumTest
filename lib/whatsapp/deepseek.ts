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
- Para "qué tengo esta semana" usa read_events con filter "__week__".
- "mostrame mis materias" es read_subjects y "cada materia" en una consulta de horarios usa payload {"all_subjects":true}.
- Las fechas relativas deben resolverse de forma determinista antes de responder; nunca inventes una fecha.
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
No inventes datos académicos. Si te preguntan qué podés hacer, mencioná brevemente materias, horarios, apuntes y eventos.`;

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
  if (!cfg.deepseekApiKey) return null;
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
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "";
    if (!content) return null;
    const parsed = JSON.parse(content) as BotDraft;
    return parsed;
  } catch {
    return null;
  }
}

export async function callDeepseekChat(userText: string, history: DeepseekHistoryMessage[] = []): Promise<string | null> {
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
        { role: "system", content: CHAT_SYSTEM_PROMPT },
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
