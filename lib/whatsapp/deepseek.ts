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
