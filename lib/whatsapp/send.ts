import "server-only";
import { getWhatsappConfig } from "@/lib/whatsapp/config";

export async function sendWhatsappText(to: string, body: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const cfg = getWhatsappConfig();
  if (!cfg.accessToken || !cfg.phoneNumberId) {
    return { ok: false, error: "WhatsApp not configured" };
  }
  const text = body.slice(0, 4096);
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
          to,
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
