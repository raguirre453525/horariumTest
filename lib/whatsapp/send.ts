import "server-only";
import { getWhatsappConfig } from "@/lib/whatsapp/config";

export async function sendWhatsappText(to: string, body: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const cfg = getWhatsappConfig();
  if (!cfg.accessToken || !cfg.phoneNumberId) {
    return { ok: false, error: "WhatsApp not configured" };
  }
  const text = body.slice(0, 4096);
  // ponytail: Meta test-number allowlist compares `to` LITERALLY against its
  // stored form. AR inbound wa_id arrives as 549… but the panel stores the
  // domestic form (no 9, 15 after area code). Without-9 alone still missed,
  // so send the exact stored string. DEV-ONLY: production has no allowlist
  // and accepts plain E.164 — delete this block when graduating to a real
  // number. Revisit if non-AR recipients hit 131030 (MX adds 1, BR adds 9).
  const recipient =
    to === "5493812211115" ? "54381152211115" : to.replace(/^549(\d+)$/, "54$1");
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
