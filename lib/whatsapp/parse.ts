export type ParsedInbound = {
  waId: string;
  providerMessageId: string;
  text: string;
  timestamp: string;
  phoneNumberId: string | null;
};

type RawPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string }>;
        messages?: Array<{ from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }>;
        statuses?: unknown[];
      };
    }>;
  }>;
};

export function parseWhatsappPayload(raw: string): ParsedInbound[] {
  let json: RawPayload;
  try {
    json = JSON.parse(raw) as RawPayload;
  } catch (e) {
    throw new SyntaxError(`malformed whatsapp payload: ${(e as Error).message}`);
  }
  if (!json.entry || !Array.isArray(json.entry)) return [];
  const out: ParsedInbound[] = [];
  for (const entry of json.entry) {
    const changes = entry.changes ?? [];
    for (const ch of changes) {
      if (ch.field !== "messages") continue;
      const val = ch.value;
      if (!val) continue;
      // ignore statuses safely
      if (val.statuses && (!val.messages || val.messages.length === 0)) continue;
      const phoneNumberId = val.metadata?.phone_number_id ?? null;
      const msgs = val.messages ?? [];
      for (const m of msgs) {
        if (m.type !== "text") continue;
        const body = m.text?.body;
        if (typeof body !== "string") continue;
        const waId = typeof m.from === "string" ? m.from : "";
        const id = typeof m.id === "string" ? m.id : "";
        if (!waId || !id) continue;
        const trimmed = body.trim();
        if (!trimmed) continue;
        // bounded: limit text length 2000
        out.push({
          waId,
          providerMessageId: id,
          text: trimmed.slice(0, 2000),
          timestamp: typeof m.timestamp === "string" ? m.timestamp : String(Date.now()),
          phoneNumberId,
        });
      }
    }
  }
  // bounded: max 10 messages per payload
  return out.slice(0, 10);
}
