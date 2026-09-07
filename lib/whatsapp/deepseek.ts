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

 Payloads (usá SOLO estos campos y formatos; el backend rechaza cualquier otra forma):
 - events.create: {"title":"...","type":"parcial|entrega|tarea|recuperatorio|exposición|otro","date":"AAAA-MM-DD","time":"HH:MM","subject_code":"...","description":"..."}. "title", "type" y "date" son obligatorios. "type" es siempre uno de esos 6 valores. "date" siempre AAAA-MM-DD. "time" SOLO si la persona da una hora concreta; si es día completo, OMITÍ "time" (nunca escribas texto como "día completo" ni "todo el día"). "subject_code" y "description" se omiten si no los sabés.
 - notes.create: {"subject_code":"...","title":"...","content":"...","note_date":"AAAA-MM-DD"}. "note_date" se omite si no hay fecha.

 Consultas: "cuándo curso", horarios, profesor o docente usan read_schedule; "mostrame mis materias" usa read_subjects; "cada materia" en horarios usa {"all_subjects":true}; cualquier consulta de eventos usa read_events.

 Anuncios declarativos también son acciones: "nos avisaron que el miércoles hay una tarea del TP2", "hay parcial de redes el martes" o "me dieron entrega para el viernes" usan events.create con la fecha correspondiente — nunca read_events. Solo usá read_events cuando la persona pregunta qué tiene ("qué tengo el miércoles", "mostrame mis eventos").
 Si el contexto incluye una acción pendiente de confirmación y el mensaje la reafirma ("crealo", "guardalo", "hacelo", "de una", u otra formulación del mismo pedido), devolvé el MISMO intent y payload para que se ejecute. Si pide algo distinto, actuá sobre lo nuevo.

Formato exacto: {"intent":"...","payload":{...}}. Responde SOLO JSON válido, sin explicación ni texto adicional.`;

const CHAT_SYSTEM_PROMPT = `Sos el asistente de Horarium y respondés como un compañero de cursada: natural, cálido, claro y breve, en español rioplatense.

Conversá como una persona, no como un bot de menú. Contestá en 1 a 3 líneas, sin JSON ni listas de capacidades salvo que te pregunten qué podés hacer. Usá la historia reciente para responder y para resolver referencias como "ambos", "los dos", "todo", "ese", "el primero" o "el del martes" contra los eventos o apuntes recién mencionados.

 Si el mensaje expresa una acción que el router no pudo estructurar, explicá qué entendiste en una línea y pedile a la persona que te lo mande como un pedido directo (por ejemplo "agendá el parcial de redes para el martes"), que es lo que el sistema sí puede procesar. Nunca pidas un SI o un NO: solo las propuestas del sistema aceptan SI/NO, y un SI sin propuesta del sistema no ejecuta nada. Nunca digas ni insinúes que ya agendaste, creaste, editaste, moviste, cancelaste, guardaste, archivaste, eliminaste o completaste algo: las mutaciones solo existen después de una confirmación SI y una operación real. Tampoco prometas hacerlo "ya mismo" ni en futuro ("te lo agendo", "te lo creo", "te lo guardo"): si hay una propuesta pendiente, dirigí a la persona a responder SI o NO a esa propuesta. Nunca ofrezcas recordatorios, avisos ni notificaciones antes de un evento: esa función no existe. Nunca propongas un borrado permanente: si piden borrar o eliminar, ofrecé cancelar (se puede revertir) y aclará que el borrado definitivo lo hace un admin.

No inventes datos académicos. No muestres IDs, códigos internos, fechas ISO ni estados técnicos como pending, completed o cancelled. Formateá fechas de manera natural, por ejemplo "martes 8 de septiembre". Los saludos reciben un saludo cálido; una pregunta formada solo por "?" después de un mensaje del bot recibe una aclaración breve. Si preguntan por una mutación anterior, reconocé la confusión y ofrecé el próximo paso concreto sin afirmar que ocurrió. Nunca afirmes que agendaste, guardaste, creaste, editaste o cancelaste algo: vos no ejecutás acciones, solo el sistema cuando el usuario responde SI a una propuesta explícita. Si la persona dice que no ve algo que la historia da por creado, creéle a la persona: decí que entonces no se guardó y ofrecé prepararlo de nuevo con un pedido directo.`;

export type DeepseekHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type LlmProviderName = "groq" | "deepseek";
type LlmFailureStage = "no-key" | "fetch" | "http" | "parse" | "empty";
type LlmFailure = { provider: LlmProviderName; stage: LlmFailureStage; status?: number; detail?: string };
type LlmProvider = { name: LlmProviderName; baseUrl: string; apiKey: string; model: string };

function failureCode(failure: LlmFailure): string {
  const status = typeof failure.status === "number" && Number.isFinite(failure.status) ? `:${failure.status}` : "";
  return `${failure.provider}:${failure.stage}${status}${failure.detail ? `:${failure.detail}` : ""}`;
}

function recordFailure(failureCodes: string[] | undefined, failure: LlmFailure): void {
  failureCodes?.push(failureCode(failure));
  console.warn("[whatsapp] llm failed", failure);
}

// Provider chain: Groq first (fast, free tier), DeepSeek as fallback.
// Both expose an OpenAI-compatible /chat/completions endpoint, so the call
// shape is identical. Research note: Groq free tier is 30 RPM / 1K RPD per
// model — plenty for a single-user bot, but the fallback keeps the bot alive
// if the key is missing or Groq rate-limits.
function llmProviders(): LlmProvider[] {
  const cfg = getWhatsappConfig();
  return [
    { name: "groq", baseUrl: cfg.groqBaseUrl, apiKey: cfg.groqApiKey, model: cfg.groqModel },
    { name: "deepseek", baseUrl: cfg.deepseekBaseUrl, apiKey: cfg.deepseekApiKey, model: cfg.deepseekModel },
  ];
}

async function postChatCompletion(
  provider: LlmProvider,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: true; text: string; json: unknown | null } | ({ ok: false } & LlmFailure)> {
  if (!provider.apiKey) return { ok: false, provider: provider.name, stage: "no-key" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, provider: provider.name, stage: "http", status: typeof res.status === "number" ? res.status : undefined };
    // Read text first (single body read), then parse. Minimal test doubles
    // that only expose .json() are supported via the fallback branch.
    const text = typeof res.text === "function" ? await res.text() : "";
    if (text) {
      try {
        return { ok: true, text, json: JSON.parse(text) as unknown };
      } catch {
        // Some compatible endpoints return the assistant text directly.
        return { ok: true, text, json: null };
      }
    }
    const json = await res.json().catch(() => null);
    return { ok: true, text: typeof json === "string" ? json : "", json };
  } catch {
    return { ok: false, provider: provider.name, stage: "fetch" };
  } finally {
    clearTimeout(timeout);
  }
}

function historyMessages(history: DeepseekHistoryMessage[]) {
  return history.slice(-5).map(({ role, content }) => ({ role: role === "assistant" ? "assistant" : "user", content: String(content ?? "").slice(0, 500) }));
}

export async function callDeepseekDraft(
  userText: string,
  contextHint?: string,
  history: DeepseekHistoryMessage[] = [],
  failureCodes?: string[],
): Promise<BotDraft | null> {
  const chain = llmProviders();
  const fail = (failure: LlmFailure) => {
    recordFailure(failureCodes, failure);
    return null;
  };
  for (const provider of chain) {
    const body = {
      model: provider.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + "\n\nHoy es " + new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }) + ". Resolvé todas las fechas relativas contra ese día." + (contextHint ? `\nContexto: ${contextHint}` : "") },
        ...historyMessages(history),
        { role: "user", content: userText.slice(0, 2000) },
      ],
      temperature: 0.2,
      stream: false,
      // Token guard: drafts are small JSON objects (~100 tokens). Without a
      // cap the model can ramble and we pay full output price for text we
      // discard on parse. 1500 because reasoning models think before answering
      // and that thinking consumes the same output budget; 400 starved them.
      max_tokens: 1500,
      response_format: { type: "json_object" },
    };
    const res = await postChatCompletion(provider, body, 8000);
    if (!res.ok) {
      fail(res);
      continue;
    }
    const json = res.json as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    } | null;
    const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "";
    if (!content) {
      fail({ provider: provider.name, stage: "empty", detail: String((json as { choices?: Array<{ finish_reason?: unknown }> } | null)?.choices?.[0]?.finish_reason ?? "none").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 16) + ":" + JSON.stringify(body).length });
      continue;
    }
    try {
      return JSON.parse(content) as BotDraft;
    } catch {
      fail({ provider: provider.name, stage: "parse" });
      continue;
    }
  }
  return null;
}

export async function callDeepseekChat(userText: string, history: DeepseekHistoryMessage[] = [], contextHint?: string, failureCodes?: string[]): Promise<string | null> {
  const chain = llmProviders();
  const fail = (failure: LlmFailure) => {
    recordFailure(failureCodes, failure);
    return null;
  };
  for (const provider of chain) {
    const body = {
      model: provider.model,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT + "\n\nHoy es " + new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }) + "." + (contextHint ? `\n\n${contextHint}` : "") },
        ...historyMessages(history),
        { role: "user", content: userText.slice(0, 2000) },
      ],
      temperature: 0.7,
      stream: false,
      // Token guard: chat replies are 1-3 lines by contract (~120 tokens).
      // The old code truncated client-side AFTER paying for the full
      // generation — this cap stops the meter at the source.
      max_tokens: 800,
    };
    const res = await postChatCompletion(provider, body, 8000);
    if (!res.ok) {
      fail(res);
      continue;
    }
    // Prefer the standard choices envelope; use the raw body only when the
    // endpoint returned plain text instead of JSON (res.json === null).
    let content = "";
    const json = res.json as { choices?: Array<{ message?: { content?: string } }> } | null;
    const candidate = json?.choices?.[0]?.message?.content;
    if (typeof candidate === "string" && candidate.trim()) content = candidate;
    else if (json === null) content = res.text;
    const trimmed = content.trim();
    if (!trimmed) {
      fail({ provider: provider.name, stage: "empty", detail: String((json as { choices?: Array<{ finish_reason?: unknown }> } | null)?.choices?.[0]?.finish_reason ?? "none").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 16) + ":" + JSON.stringify(body).length });
      continue;
    }
    return trimmed.split(/\r?\n/).slice(0, 2).join("\n").slice(0, 1000) || null;
  }
  return null;
}
