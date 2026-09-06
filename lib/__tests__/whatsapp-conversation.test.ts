import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_TEXT } from "@/lib/whatsapp/format";

type Row = Record<string, unknown>;

const database = vi.hoisted(() => {
  type Filter = { column: string; operator: "eq" | "neq" | "is" | "gt" | "lte" | "in"; value: unknown };

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

const envKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_GRAPH_VERSION",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
];

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.deepseek.com")) {
    const body = JSON.parse(String(init?.body)) as { response_format?: unknown; messages: Array<{ content: string }> };
    if (body.response_format) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"unknown"}' } }] }), { status: 200 });
    }
    const text = body.messages.at(-1)?.content ?? "";
    const replies: Record<string, string> = {
      hola: "¡Hola! Qué bueno leerte 😊",
      holaaa: "¡Hola! Qué bueno leerte 😊",
      "solo te salude": "¡Qué lindo saludo! Estoy bien y listo para ayudarte 😊",
      "¿cómo estás?": "¡Muy bien, gracias! ¿Qué necesitás hoy? 😊",
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

describe("WhatsApp conversation through the webhook", () => {
  beforeEach(() => {
    database.reset();
    vi.stubGlobal("fetch", fetchMock);
    for (const key of envKeys) process.env[key] = key === "DEEPSEEK_BASE_URL" ? "https://api.deepseek.com" : "test-value";
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number";
  });

  afterEach(() => {
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
    expect(subjects.reply).toContain("ASI — Análisis de Sistemas");
    expect(subjects.reply).toContain("RED — Redes");

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
      ["mostrame mis materias", "📚 Estas son tus materias:\n• ASI — Análisis de Sistemas\n• RED — Redes"],
      ["quiero agendar un parcial de REDES el 30/09/2026", "📅 Voy a agendar “Parcial de redes”, tipo parcial, el 2026-09-30, para RED.\n\n¿Está bien? Respondé SI para guardar o NO para cancelar. Tenés 10 minutos."],
      ["si", "✅ Evento agendado."],
    ]);
  });
});
