import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_TEXT } from "@/lib/whatsapp/format";

type Row = Record<string, unknown>;

const database = vi.hoisted(() => {
  type Filter = { column: string; operator: "eq" | "neq" | "is" | "gt" | "gte" | "lte" | "in"; value: unknown };

  const tables = new Map<string, Row[]>();
  let sequence = 0;

  class FakeQuery {
    private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    private payload: Row | Row[] | null = null;
    private filters: Filter[] = [];
    private orders: Array<{ column: string; ascending: boolean }> = [];
    private maxRows: number | null = null;
    private singleResult = false;
    private selected = false;

    constructor(private readonly table: string) {}

    select(_columns?: string) {
      void _columns;
      this.selected = true;
      return this;
    }

    insert(payload: Row | Row[]) {
      this.operation = "insert";
      this.payload = payload;
      return this;
    }

    update(payload: Row) {
      this.operation = "update";
      this.payload = payload;
      return this;
    }

    delete() {
      this.operation = "delete";
      return this;
    }

    upsert(payload: Row | Row[]) {
      this.operation = "upsert";
      this.payload = payload;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, operator: "eq", value });
      return this;
    }

    neq(column: string, value: unknown) {
      this.filters.push({ column, operator: "neq", value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ column, operator: "is", value });
      return this;
    }

    gt(column: string, value: unknown) {
      this.filters.push({ column, operator: "gt", value });
      return this;
    }

    gte(column: string, value: unknown) {
      this.filters.push({ column, operator: "gte", value });
      return this;
    }

    lte(column: string, value: unknown) {
      this.filters.push({ column, operator: "lte", value });
      return this;
    }

    in(column: string, value: unknown[]) {
      this.filters.push({ column, operator: "in", value });
      return this;
    }

    order(column: string, options?: { ascending?: boolean }) {
      this.orders.push({ column, ascending: options?.ascending ?? true });
      return this;
    }

    limit(value: number) {
      this.maxRows = value;
      return this;
    }

    maybeSingle() {
      this.singleResult = true;
      return this;
    }

    single() {
      this.singleResult = true;
      return this;
    }

    then(onFulfilled?: (value: { data: unknown; error: { code?: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
    }

    private matches(row: Row) {
      return this.filters.every(({ column, operator, value }) => {
        const actual = row[column];
        if (operator === "eq") return actual === value;
        if (operator === "neq") return actual !== value;
        if (operator === "is") return actual === value;
        if (operator === "gt") return String(actual) > String(value);
        if (operator === "gte") return String(actual) >= String(value);
        if (operator === "lte") return String(actual) <= String(value);
        return Array.isArray(value) && value.includes(actual);
      });
    }

    private execute() {
      const rows = tables.get(this.table) ?? [];

      if (this.operation === "insert") {
        const inserted = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
        if (this.table === "whatsapp_messages" && inserted.some((row) => rows.some((existing) => existing.provider_message_id === row.provider_message_id))) {
          return { data: null, error: { code: "23505" } };
        }
        const created = inserted.map((input) => {
          const row = { ...input };
          sequence += 1;
          row.id ??= `${this.table}-${sequence}`;
          row.created_at ??= new Date(sequence * 1000).toISOString();
          rows.push(row);
          return row;
        });
        return { data: this.singleResult ? created[0] ?? null : this.selected ? created : null, error: null };
      }

      if (this.operation === "upsert") {
        const values = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
        const key = this.table === "whatsapp_identities" ? "phone" : "id";
        for (const input of values) {
          const existing = rows.find((row) => row[key] === input[key]);
          if (existing) Object.assign(existing, input);
          else rows.push({ ...input });
        }
        return { data: null, error: null };
      }

      const matched = rows.filter((row) => this.matches(row));

      if (this.operation === "update") {
        for (const row of matched) Object.assign(row, this.payload ?? {});
        return { data: this.selected ? matched : null, error: null };
      }

      if (this.operation === "delete") {
        for (const row of matched) {
          const index = rows.indexOf(row);
          if (index >= 0) rows.splice(index, 1);
        }
        return { data: null, error: null };
      }

      let result = matched.slice();
      for (const { column, ascending } of this.orders) {
        result.sort((left, right) => {
          const a = String(left[column] ?? "");
          const b = String(right[column] ?? "");
          return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      if (this.maxRows !== null) result = result.slice(0, this.maxRows);
      return { data: this.singleResult ? result[0] ?? null : result, error: null };
    }
  }

  const client = {
    from: (table: string) => new FakeQuery(table),
  };

  return {
    createClient: vi.fn(() => client),
    reset() {
      tables.clear();
      sequence = 0;
      tables.set("subjects", [
        { id: "subject-asi", code: "ASI", name: "Análisis de Sistemas", accent: "#000000" },
        { id: "subject-red", code: "RED", name: "Redes", accent: "#000000" },
      ]);
      tables.set("whatsapp_identities", [{ phone: "wa-1", user_id: "user-1" }]);
      tables.set("whatsapp_messages", []);
      tables.set("whatsapp_conversations", []);
      tables.set("notes", []);
      tables.set("academic_events", []);
      tables.set("schedules", []);
    },
    rows(table: string) {
      return tables.get(table) ?? [];
    },
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: database.createClient,
}));

import { POST } from "@/app/api/whatsapp/webhook/route";

// Failure injection for the DeepSeek legs: the production "hola" bug was the
// draft returning null (http/garbage/throw) and falling back without ever
// trying chat. These flags reproduce each draft failure mode.
let draftFailure: null | "http" | "garbage" | "throw" = null;
let chatFailure = false;
let groqFailure = false;
let lastChatSystemPrompt = "";
let hosts: string[] = [];
let lastDraftBody: { max_tokens?: unknown } | null = null;
let lastChatBody: { max_tokens?: unknown } | null = null;

const envKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_GRAPH_VERSION",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "GROQ_MODEL",
];

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.deepseek.com") || url.includes("api.groq.com")) {
    hosts.push(url.includes("api.groq.com") ? "groq" : "deepseek");
    if (url.includes("api.groq.com") && groqFailure) return new Response("Server error", { status: 500 });
    const body = JSON.parse(String(init?.body)) as { response_format?: unknown; max_tokens?: unknown; messages: Array<{ content: string }> };
    const text = body.messages.at(-1)?.content ?? "";
    if (body.response_format) {
      lastDraftBody = body;
      if (draftFailure === "http") return new Response("Unauthorized", { status: 401 });
      if (draftFailure === "garbage") {
        return new Response(JSON.stringify({ choices: [{ message: { content: "hola, ¿qué tal todo por ahí?" } }] }), { status: 200 });
      }
      if (draftFailure === "throw") throw new Error("deepseek down");
      if (text === "me pasaron el parcial para el jueves") {
        const eventId = String(database.rows("academic_events")[0]?.id ?? "missing-event");
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "update_event", payload: { event_id: eventId, date: "2026-09-10" } }) } }] }), { status: 200 });
      }
      if (text === "el del jueves no, solo el del martes") {
        const eventId = String(database.rows("academic_events")[0]?.id ?? "missing-event");
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "events.cancel", payload: { event_ids: [eventId] } }) } }] }), { status: 200 });
      }
      if (text === "pero creame el evento") {
        // Screenshot-loop re-affirmation: the drafter (LLM in prod, mock here)
        // resolves the pending action to the SAME intent/payload so the engine
        // executes it instead of stacking a duplicate proposal. Fixed date
        // matches "miercoles" under the 2026-09-06 fake clock used below.
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "events.create", payload: { title: "Tarea", type: "tarea", date: "2026-09-09", time: null, subject_code: null, description: null, event_type: "individual" } }) } }] }), { status: 200 });
      }
      if (text === "borra ambos" || text === "borrá el primero" || text === "el del jueves no, solo el del martes") {
        const eventIds = text === "borra ambos"
          ? database.rows("academic_events").map((row) => String(row.id))
          : [String(database.rows("academic_events")[0]?.id ?? "missing-event")];
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "events.cancel", payload: { event_ids: eventIds } }) } }] }), { status: 200 });
      }
      const drafts: Record<string, string> = {
        "mostrame mis materias": JSON.stringify({ intent: "read_subjects" }),
        "quiero agendar un parcial de REDES el 30/09/2026": JSON.stringify({ intent: "events.create", payload: { title: "Parcial de redes", type: "parcial", date: "2026-09-30", time: null, subject_code: "redes", description: null, event_type: "individual" } }),
        "parcial de redes el martes": JSON.stringify({ intent: "events.create", payload: { title: "Parcial de redes", type: "parcial", date: "2026-09-08", time: null, subject_code: "redes", description: null, event_type: "individual" } }),
        "entrega de redes el jueves": JSON.stringify({ intent: "events.create", payload: { title: "Entrega de redes", type: "entrega", date: "2026-09-10", time: null, subject_code: "redes", description: null, event_type: "individual" } }),
        "agendame una tarea para el miercoles": JSON.stringify({ intent: "events.create", payload: { title: "Tarea", type: "tarea", date: "2026-09-09", time: null, subject_code: null, description: null, event_type: "individual" } }),
        "bien, ahora nos avisan que el miercoles hay una tarea del tp2": JSON.stringify({ intent: "events.create", payload: { title: "Tarea", type: "tarea", date: "2026-09-09", time: null, subject_code: null, description: null, event_type: "individual" } }),
      };
      if (drafts[text]) {
        return new Response(JSON.stringify({ choices: [{ message: { content: drafts[text] } }] }), { status: 200 });
      }
      const readDrafts: Record<string, string> = {
        "que eventos tengo para la semana que viene?": JSON.stringify({ intent: "read_events", payload: { filter: "semana que viene" } }),
        "pero si tengo 2 eventos para la semana que viene": JSON.stringify({ intent: "read_events", payload: { filter: "__week__" } }),
        "buscame el parcial de redes": JSON.stringify({ intent: "read_events", payload: { filter: "parcial de redes" } }),
        "dame el calendario de la semana que viene": JSON.stringify({ intent: "read_events", payload: { filter: "__week__" } }),
        "qué tengo esta semana": JSON.stringify({ intent: "read_events", payload: { filter: "__week__" } }),
        "qué tengo el jueves": JSON.stringify({ intent: "read_events", payload: { from: "2026-09-10", to: "2026-09-10" } }),
      };
      if (readDrafts[text]) {
        return new Response(JSON.stringify({ choices: [{ message: { content: readDrafts[text] } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"unknown"}' } }] }), { status: 200 });
    }
    if (chatFailure) return new Response("Server error", { status: 500 });
    lastChatBody = body;
    lastChatSystemPrompt = body.messages[0]?.content ?? "";
    const replies: Record<string, string> = {
      hola: "¡Hola! Qué bueno leerte 😊",
      "hola?": "¡Hola! Qué bueno leerte 😊",
      holaaa: "¡Hola! Qué bueno leerte 😊",
      "solo te salude": "¡Qué lindo saludo! Estoy bien y listo para ayudarte 😊",
      "¿cómo estás?": "¡Muy bien, gracias! ¿Qué necesitás hoy? 😊",
      "?": "¿Qué parte no quedó clara? Decime y te lo explico 🙂",
      "¿por qué no me editaste el evento que acababas de crear?": "Tenés razón: no tomé tu pedido. Decime la nueva fecha y te pido SI o NO 🙂",
      "necesito que me avises": "Dale, te aviso media hora antes del evento. ¿Va?",
    };
    return new Response(replies[text] ?? "¡Te escucho! 😊", { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  if (url.includes("graph.facebook.com")) {
    return new Response(JSON.stringify({ messages: [{ id: `out-${fetchMock.mock.calls.length}` }] }), { status: 200 });
  }

  throw new Error(`Unexpected fetch URL: ${url}`);
});

function signedPayload(providerMessageId: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-number" },
          messages: [{ from: "wa-1", id: providerMessageId, type: "text", text: { body: text } }],
        },
      }],
    }],
  });
}

async function sendTurn(text: string, providerMessageId: string) {
  const raw = signedPayload(providerMessageId, text);
  const signature = createHmac("sha256", "app-secret").update(raw).digest("hex");
  const response = await POST(new Request("https://horarium.test/api/whatsapp/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body: raw,
  }));
  const outbound = database.rows("whatsapp_messages").filter((row) => row.direction === "outbound").at(-1);
  return { status: response.status, reply: String(outbound?.body ?? "") };
}

async function seedTwoNextWeekEvents() {
  await sendTurn("parcial de redes el martes", "provider-delete-seed-tue");
  await sendTurn("SI", "provider-delete-seed-tue-confirm");
  await sendTurn("entrega de redes el jueves", "provider-delete-seed-thu");
  await sendTurn("SI", "provider-delete-seed-thu-confirm");
  await sendTurn("qué eventos tengo para la semana que viene?", "provider-delete-list");
}

describe("WhatsApp conversation through the webhook", () => {
  beforeEach(() => {
    database.reset();
    draftFailure = null;
    chatFailure = false;
    groqFailure = false;
    lastChatSystemPrompt = "";
    hosts = [];
    lastDraftBody = null;
    lastChatBody = null;
    vi.stubGlobal("fetch", fetchMock);
    for (const key of envKeys) process.env[key] = key === "DEEPSEEK_BASE_URL" ? "https://api.deepseek.com" : "test-value";
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number";
    // Groq chain disabled by default so the 212 pre-existing tests keep
    // exercising the DeepSeek path; the new provider tests opt in.
    process.env.GROQ_API_KEY = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const key of envKeys) delete process.env[key];
  });

  it("handles greetings, questions, reads, mutations, and confirmation turn by turn", async () => {
    const transcript: Array<[string, string]> = [];

    const greeting = await sendTurn("hola", "provider-hola");
    transcript.push(["hola", greeting.reply]);
    expect(greeting.status).toBe(200);
    expect(greeting.reply).not.toBe(FALLBACK_TEXT);

    const extendedGreeting = await sendTurn("holaaa", "provider-holaaa");
    transcript.push(["holaaa", extendedGreeting.reply]);
    expect(extendedGreeting.reply).not.toBe(FALLBACK_TEXT);

    const greetingFollowUp = await sendTurn("solo te salude", "provider-solo-te-salude");
    transcript.push(["solo te salude", greetingFollowUp.reply]);
    expect(greetingFollowUp.reply).not.toBe(FALLBACK_TEXT);

    const question = await sendTurn("¿cómo estás?", "provider-como-estas");
    transcript.push(["¿cómo estás?", question.reply]);
    expect(question.reply).not.toBe(FALLBACK_TEXT);

    const subjects = await sendTurn("mostrame mis materias", "provider-materias");
    transcript.push(["mostrame mis materias", subjects.reply]);
    expect(subjects.reply).toContain("• Análisis de Sistemas");
    expect(subjects.reply).toContain("• Redes");

    const event = await sendTurn("quiero agendar un parcial de REDES el 30/09/2026", "provider-evento");
    transcript.push(["quiero agendar un parcial de REDES el 30/09/2026", event.reply]);
    expect(event.reply).toContain("Respondé SI para guardar");
    expect(event.reply).toContain("NO para cancelar");

    const confirmation = await sendTurn("si", "provider-confirmacion");
    transcript.push(["si", confirmation.reply]);
    expect(confirmation.reply).toBe("✅ Evento agendado.");
    expect(database.rows("academic_events")).toHaveLength(1);
    expect(database.rows("academic_events")[0]).toMatchObject({ type: "parcial", date: "2026-09-30", time: null, subject_id: "subject-red" });

    expect(transcript).toEqual([
      ["hola", "¡Hola! Qué bueno leerte 😊"],
      ["holaaa", "¡Hola! Qué bueno leerte 😊"],
      ["solo te salude", "¡Qué lindo saludo! Estoy bien y listo para ayudarte 😊"],
      ["¿cómo estás?", "¡Muy bien, gracias! ¿Qué necesitás hoy? 😊"],
      ["mostrame mis materias", "📚 Estas son tus materias:\n• Análisis de Sistemas\n• Redes"],
      ["quiero agendar un parcial de REDES el 30/09/2026", "📅 Voy a agendar “Parcial de redes” el miércoles 30 de septiembre, para Redes.\n\n¿Está bien? Respondé SI para guardar o NO para cancelar. Tenés 10 minutos."],
      ["si", "✅ Evento agendado."],
    ]);
  });

  it("answers hola through chat when the draft leg fails in any mode", async () => {
    for (const mode of ["http", "garbage", "throw"] as const) {
      draftFailure = mode;
      const turn = await sendTurn("hola", `provider-hola-${mode}`);
      expect(turn.status).toBe(200);
      expect(turn.reply).toBe("¡Hola! Qué bueno leerte 😊");
    }
  });

  it("reports when both LLM legs fail for meaningful input", async () => {
    draftFailure = "http";
    chatFailure = true;
    const turn = await sendTurn("hola", "provider-hola-down");
    expect(turn.status).toBe(200);
    expect(turn.reply).toBe("No pude conectarme con el modelo (groq:no-key, deepseek:http:401, groq:no-key, deepseek:http:500). Intentá de nuevo en un rato.");
  });

  it("reschedules the most recent event instead of creating a duplicate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));

    const create = await sendTurn("parcial de redes el martes", "provider-reschedule-create");
    expect(create.reply).toContain("martes 8 de septiembre");
    expect(create.reply).toContain("Respondé SI");

    const created = await sendTurn("SI", "provider-reschedule-create-confirm");
    expect(created.reply).toBe("✅ Evento agendado.");
    expect(database.rows("academic_events")).toHaveLength(1);
    expect(database.rows("academic_events")[0]).toMatchObject({ date: "2026-09-08", title: "Parcial de redes" });

    const proposal = await sendTurn("me pasaron el parcial para el jueves", "provider-reschedule-edit");
    expect(proposal.reply).toContain("Fecha: martes 8 de septiembre → jueves 10 de septiembre");
    expect(proposal.reply).toContain("Respondé SI");
    expect(proposal.reply).toContain("NO");
    expect(proposal.reply).not.toContain("Voy a agendar");
    expect(database.rows("academic_events")).toHaveLength(1);

    const updated = await sendTurn("SI", "provider-reschedule-edit-confirm");
    expect(updated.reply).toBe("✅ Evento actualizado.");
    expect(database.rows("academic_events")).toHaveLength(1);
    expect(database.rows("academic_events")[0]).toMatchObject({ date: "2026-09-10", title: "Parcial de redes" });
  });

  it("reproduces the reported next-week read and follow-up failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));
    await sendTurn("parcial de redes el martes", "provider-seed-next-tue");
    await sendTurn("SI", "provider-seed-next-tue-confirm");
    await sendTurn("entrega de redes el jueves", "provider-seed-next-thu");
    await sendTurn("SI", "provider-seed-next-thu-confirm");
    expect(database.rows("academic_events")).toHaveLength(2);

    const nextWeek = await sendTurn("que eventos tengo para la semana que viene?", "provider-next-week");
    expect(nextWeek.reply).toContain("martes 8 de septiembre");
    expect(nextWeek.reply).toContain("jueves 10 de septiembre");
    expect(nextWeek.reply).not.toMatch(/2026-09-\d{2}/);
    expect(nextWeek.reply).not.toContain("pending");
    expect(nextWeek.reply).not.toContain("Respondé SI");

    const llmRange = await sendTurn("dame el calendario de la semana que viene", "provider-next-week-llm-range");
    expect(llmRange.reply).toContain("martes 8 de septiembre");
    expect(llmRange.reply).toContain("jueves 10 de septiembre");

    const followUp = await sendTurn("pero si tengo 2 eventos para la semana que viene", "provider-next-week-follow-up");
    expect(followUp.reply).toContain("martes 8 de septiembre");
    expect(followUp.reply).toContain("jueves 10 de septiembre");
    expect(followUp.reply).not.toContain("Esta semana no tenés eventos");

    const thursday = await sendTurn("qué tengo el jueves", "provider-next-week-thursday");
    expect(thursday.reply).toContain("jueves 10 de septiembre");
    expect(thursday.reply).not.toContain("martes 8 de septiembre");
  });

  it("answers event reads for an empty current week and text searches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));

    const emptyWeek = await sendTurn("qué tengo esta semana", "provider-empty-current-week");
    expect(emptyWeek.reply).toBe("Esta semana no tenés eventos agendados 📅.");

    database.rows("academic_events").push(
      { id: "event-search", title: "Parcial 1", type: "parcial", date: "2026-09-08", time: "18:00", subject_id: "subject-red", subjects: { code: "RED" }, description: "Evaluación de redes", status: "pending", created_by: "user-1" },
      { id: "event-other-user", title: "Parcial ajeno", type: "parcial", date: "2026-09-08", time: "19:00", subject_id: "subject-red", subjects: { code: "RED" }, description: "Evaluación de redes", status: "pending", created_by: "user-2" },
    );
    const search = await sendTurn("buscame el parcial de redes", "provider-event-search");
    expect(search.reply).toContain("Parcial 1");
    expect(search.reply).toContain("martes 8 de septiembre");
    expect(search.reply).not.toContain("Parcial ajeno");
  });

  it("resolves ambos from the last listing, confirms once, and cancels both after SI", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));
    await seedTwoNextWeekEvents();

    const confirmation = await sendTurn("borra ambos", "provider-delete-both");
    expect(confirmation.reply).toContain("Parcial de redes");
    expect(confirmation.reply).toContain("Entrega de redes");
    expect(confirmation.reply).toContain("martes 8 de septiembre");
    expect(confirmation.reply).toContain("jueves 10 de septiembre");
    expect(confirmation.reply).toContain("SI");
    expect(confirmation.reply).toContain("NO");
    expect(confirmation.reply).not.toBe(FALLBACK_TEXT);
    expect(database.rows("academic_events")).toHaveLength(2);
    expect(database.rows("whatsapp_messages").filter((row) => row.direction === "outbound" && String(row.body).includes("¿Cancelo")).length).toBe(1);

    const cancelled = await sendTurn("SI", "provider-delete-both-confirm");
    expect(cancelled.reply).toBe("✅ Cancelé 2 eventos. Quedan guardados y los podés revertir.");
    expect(database.rows("academic_events")).toHaveLength(2);
    expect(database.rows("academic_events").every((row) => row.status === "cancelled")).toBe(true);
  });

  it("resolves el primero from the last listing without asking which event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));
    await seedTwoNextWeekEvents();

    const confirmation = await sendTurn("borrá el primero", "provider-delete-first");
    expect(confirmation.reply).toContain("Parcial de redes");
    expect(confirmation.reply).not.toContain("Entrega de redes");
    expect(confirmation.reply).not.toContain("¿Cuál");
    expect(confirmation.reply).toContain("Respondeme SI o NO");

    await sendTurn("SI", "provider-delete-first-confirm");
    expect(database.rows("academic_events")).toHaveLength(2);
    expect(database.rows("academic_events")[0]).toMatchObject({ title: "Parcial de redes", status: "cancelled" });
    expect(database.rows("academic_events")[1]).toMatchObject({ title: "Entrega de redes", status: "pending" });
  });

  it("keeps only the explicitly included event in a partial reference", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));
    await seedTwoNextWeekEvents();

    const confirmation = await sendTurn("el del jueves no, solo el del martes", "provider-delete-partial");
    expect(confirmation.reply).toContain("Parcial de redes");
    expect(confirmation.reply).not.toContain("Entrega de redes");
    expect(confirmation.reply).not.toContain("jueves 10 de septiembre");

    await sendTurn("SI", "provider-delete-partial-confirm");
    expect(database.rows("academic_events")).toHaveLength(2);
    expect(database.rows("academic_events")[0]).toMatchObject({ title: "Parcial de redes", status: "cancelled" });
    expect(database.rows("academic_events")[1]).toMatchObject({ title: "Entrega de redes", status: "pending" });
  });

  it("answers a mutation meta-question with the last confirmed mutation in chat context", async () => {
    const create = await sendTurn("quiero agendar un parcial de REDES el 30/09/2026", "provider-meta-create");
    expect(create.reply).toContain("Respondé SI");
    await sendTurn("SI", "provider-meta-create-confirm");

    const meta = await sendTurn("¿por qué no me editaste el evento que acababas de crear?", "provider-meta-question");

    expect(meta.reply).toBe("Tenés razón: no tomé tu pedido. Decime la nueva fecha y te pido SI o NO 🙂");
    expect(lastChatSystemPrompt).toContain("Resumen factual de la última mutación confirmada");
    expect(lastChatSystemPrompt).toContain("Evento agendado");
    expect(lastChatSystemPrompt).toContain("miércoles 30 de septiembre");
  });

  it("greets hola? instead of dumping capabilities", async () => {
    const turn = await sendTurn("hola?", "provider-hola-question-mark");

    expect(turn.reply).toBe("¡Hola! Qué bueno leerte 😊");
    expect(turn.reply).not.toContain("materias y horarios");
  });

  it("clarifies a lone question mark after a bot message", async () => {
    await sendTurn("hola", "provider-clarifier-greeting");

    const turn = await sendTurn("?", "provider-clarifier-question");

    expect(turn.reply).toBe("¿Qué parte no quedó clara? Decime y te lo explico 🙂");
    expect(turn.reply).not.toBe(FALLBACK_TEXT);
  });

  it("keeps the generic fallback for genuinely empty or gibberish input", async () => {
    const turn = await sendTurn("???", "provider-gibberish");

    expect(turn.reply).toBe(FALLBACK_TEXT);
  });

  it("heals duplicate conversation rows and still executes SI", async () => {
    // Legacy duplicates (same wa_id twice) used to make getConversation read a
    // stale row, so every turn re-proposed and SI never executed.
    database.rows("whatsapp_conversations").push(
      { wa_id: "wa-1", user_id: "user-1", pending_operation: null, pending_expires_at: null, updated_at: "2020-01-01T00:00:00.000Z" },
      { wa_id: "wa-1", user_id: "user-1", pending_operation: null, pending_expires_at: null, updated_at: "2020-01-02T00:00:00.000Z" },
    );

    const proposal = await sendTurn("agendame una tarea para el miercoles", "provider-dupe-propose");
    expect(proposal.reply).toContain("Respondé SI");
    expect(database.rows("whatsapp_conversations")).toHaveLength(1);

    const done = await sendTurn("SI", "provider-dupe-confirm");
    expect(done.reply).toBe("✅ Evento agendado.");
    expect(database.rows("academic_events")).toHaveLength(1);
  });

  it("executes a re-affirmed action instead of stacking a duplicate proposal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));

    const proposal = await sendTurn("agendame una tarea para el miercoles", "provider-reaffirm-propose");
    expect(proposal.reply).toContain("Respondé SI");
    expect(proposal.reply).toContain("miércoles 9 de septiembre");

    // "pero creame el evento" is not SI, but it asks for the same action that
    // is already pending → the screenshot loop used to re-propose here.
    const done = await sendTurn("pero creame el evento", "provider-reaffirm-repeat");
    expect(done.reply).toBe("✅ Evento agendado.");
    expect(done.reply).not.toContain("Respondé SI");
    expect(database.rows("academic_events")).toHaveLength(1);
  });

  it("accepts colloquial dale and mejor no as confirmation answers", async () => {
    const proposal = await sendTurn("agendame una tarea para el miercoles", "provider-colloquial-propose");
    expect(proposal.reply).toContain("Respondé SI");

    const done = await sendTurn("dale", "provider-colloquial-yes");
    expect(done.reply).toBe("✅ Evento agendado.");

    await sendTurn("agendame una tarea para el miercoles", "provider-colloquial-propose-2");
    const cancelled = await sendTurn("mejor no", "provider-colloquial-no");
    expect(cancelled.reply).toBe("Listo, cancelé la operación. No cambié nada 🙂.");
    expect(database.rows("academic_events")).toHaveLength(1);
  });

  it("passes through chat replies that promise reminders", async () => {
    const turn = await sendTurn("necesito que me avises", "provider-reminder-hallucination");

    expect(turn.reply).toBe("Dale, te aviso media hora antes del evento. ¿Va?");
  });

  it("treats a third-party announcement as a create, not as a read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));

    // Screenshot bug: "nos avisan que ... hay una tarea" was read as a query
    // ("No tenés eventos...") instead of proposing to save the news.
    const turn = await sendTurn("bien, ahora nos avisan que el miercoles hay una tarea del tp2", "provider-announcement");

    expect(turn.reply).toContain("Respondé SI");
    expect(turn.reply).toContain("miércoles 9 de septiembre");
    expect(turn.reply).not.toContain("No tenés eventos");
  });

  it("tries Groq first and falls back to DeepSeek, capping output tokens", async () => {
    process.env.GROQ_API_KEY = "groq-test";
    process.env.GROQ_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.GROQ_MODEL = "llama-3.3-70b-versatile";

    const viaGroq = await sendTurn("hola", "provider-groq-hola");
    expect(viaGroq.reply).toBe("¡Hola! Qué bueno leerte 😊");
    expect(hosts[0]).toBe("groq");
    expect(lastChatBody?.max_tokens).toBe(250);

    groqFailure = true;
    const viaDeepseek = await sendTurn("hola", "provider-groq-fallback");
    expect(viaDeepseek.reply).toBe("¡Hola! Qué bueno leerte 😊");
    expect(hosts).toContain("deepseek");

    await sendTurn("agendame una tarea para el miercoles", "provider-groq-draft-cap");
    expect(lastDraftBody?.max_tokens).toBe(400);
  });
});
