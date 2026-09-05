import "server-only";
import { verifyHmacSha256 } from "@/lib/whatsapp/hmac";
import { parseWhatsappPayload } from "@/lib/whatsapp/parse";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { handleWhatsappMessage } from "@/lib/whatsapp/engine";
import { isDuplicateProviderMessage, insertInboundMessage, insertOutboundMessage } from "@/lib/whatsapp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCfg() {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const cfg = getCfg();
  if (mode === "subscribe" && token && challenge && cfg.verifyToken && token === cfg.verifyToken) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const cfg = getCfg();
  const signature = req.headers.get("x-hub-signature-256") ?? req.headers.get("X-Hub-Signature-256");
  const raw = await req.text();

  // bounded: reject huge payloads
  if (raw.length > 1_000_000) {
    return new Response("Payload too large", { status: 413 });
  }

  if (!verifyHmacSha256(raw, signature, cfg.appSecret)) {
    const reason = !cfg.appSecret ? "missing_app_secret" : !signature ? "missing_signature" : "signature_mismatch";
    console.warn("[whatsapp] webhook unauthorized", {
      reason,
      hasAppSecret: Boolean(cfg.appSecret),
      hasSignature: Boolean(signature),
      signatureLength: signature?.length ?? 0,
      bodyLength: raw.length,
    });
    return new Response("Invalid signature", { status: 401 });
  }

  let parsed: ReturnType<typeof parseWhatsappPayload>;
  try {
    parsed = parseWhatsappPayload(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Ignore status-only notifications: parsed will be empty -> still 200
  if (parsed.length === 0) {
    return new Response("OK", { status: 200 });
  }

  // Reject mismatched phone_number_id when configured (after signature verified)
  if (cfg.phoneNumberId) {
    for (const m of parsed) {
      if (m.phoneNumberId && m.phoneNumberId !== cfg.phoneNumberId) {
        console.warn("[whatsapp] webhook unauthorized", {
          reason: "invalid_phone_number_id",
          hasConfiguredPhoneNumberId: true,
          hasPhoneNumberId: Boolean(m.phoneNumberId),
        });
        return new Response("Invalid phone_number_id", { status: 401 });
      }
      if (!m.phoneNumberId) {
        console.warn("[whatsapp] webhook unauthorized", {
          reason: "missing_phone_number_id",
          hasConfiguredPhoneNumberId: true,
          hasPhoneNumberId: false,
        });
        return new Response("Missing phone_number_id", { status: 401 });
      }
    }
  }

  // Process each inbound safely — preserve provider retry on persistence failures
  for (const msg of parsed) {
    // dedup by provider id: fail closed, let provider retry
    let duplicate: boolean;
    try {
      duplicate = await isDuplicateProviderMessage(msg.providerMessageId);
    } catch (e) {
      console.error("[whatsapp] dedup error", e);
      return new Response("Retry", { status: 500 });
    }
    if (duplicate) continue;

    let inserted = false;
    try {
      inserted = await insertInboundMessage(msg.waId, msg.providerMessageId, msg.text, null);
    } catch (e) {
      console.error("[whatsapp] insert inbound error", e);
      return new Response("Retry", { status: 500 });
    }
    if (!inserted) continue; // duplicate via unique constraint

    let reply = "";
    try {
      const res = await handleWhatsappMessage(msg.waId, msg.text, msg.providerMessageId);
      reply = res.reply;
    } catch (e) {
      reply = "Ocurrió un error procesando tu mensaje. Probá de nuevo en unos minutos.";
      console.error("[whatsapp] engine error", e);
    }

    if (reply) {
      let sent: { ok: boolean; providerId?: string | undefined; error?: string };
      try {
        sent = await sendWhatsappText(msg.waId, reply);
        if (!sent.ok) {
          console.warn("[whatsapp] send failed", { error: sent.error ?? "unknown" });
        }
      } catch (e) {
        console.error("[whatsapp] send error", e);
        sent = { ok: false };
      }
      try {
        await insertOutboundMessage(msg.waId, reply, sent.providerId ?? null, null, sent.ok ? "sent" : "failed");
      } catch (e) {
        console.error("[whatsapp] insert outbound error", e);
        return new Response("Retry", { status: 500 });
      }
    }
  }

  return new Response("OK", { status: 200 });
}
