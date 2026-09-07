import "server-only";
import { getWhatsappConfig } from "@/lib/whatsapp/config";

// ponytail: Meta test-number allowlist compares `to` LITERALLY against its
// stored form. Verified from the dashboard's own curl preview: inbound
// wa_id 5493815113529 is stored as 54381155113529, i.e. 54 + area + 15 +
// local (domestic mobile form, no 9). The old strip-9 produced 543815113529
// (missing the 15) -> 131030 for every number except one hardcoded special
// case. DEV-ONLY: production has no allowlist and accepts plain E.164 —
// delete this block when graduating to a real number.
export function resolveTestRecipient(to: string): string {
  return to.replace(/^549381(\d{7})$/, "5438115$1").replace(/^549(\d+)$/, "54$1");
}

export async function sendWhatsappText(to: string, body: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const cfg = getWhatsappConfig();
  if (!cfg.accessToken || !cfg.phoneNumberId) {
    return { ok: false, error: "WhatsApp not configured" };
  }
  const text = body.slice(0, 4096);
  const recipient = resolveTestRecipient(to);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body: text, preview_url: false },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: unknown };
    if (!res.ok) return { ok: false, error: JSON.stringify(json) };
    const pid = json.messages?.[0]?.id ?? undefined;
    return { ok: true, providerId: pid };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
