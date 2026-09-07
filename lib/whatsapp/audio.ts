import "server-only";
import { getWhatsappConfig } from "@/lib/whatsapp/config";

export type WhatsappAudioRef = { mediaId: string; mimeType?: string; voice?: boolean; url?: string };

// Bounds: Groq free tier accepts 25MB per request; stay comfortably below so a
// voice note never burns a full transcription call just to be rejected.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8000;
const TRANSCRIBE_TIMEOUT_MS = 25000;

function withTimeout(ms: number): { controller: AbortController; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

/**
 * Download WhatsApp media bytes.
 *
 * Flow per Meta Media API: GET /{media-id} (?phone_number_id= ownership check)
 * returns a short-lived URL (5 min), then GET that URL WITH the Bearer token
 * returns the binary. An unauthorized GET revokes the URL, so the token is
 * always sent — which is also why we never hand the Meta URL to a third
 * party (Groq would fetch it without our token and kill it).
 */
export async function downloadWhatsappAudio(
  ref: WhatsappAudioRef,
  phoneNumberId: string | null,
): Promise<{ ok: true; bytes: ArrayBuffer; mimeType: string } | { ok: false; code: string }> {
  const cfg = getWhatsappConfig();
  if (!cfg.accessToken) return { ok: false, code: "meta:no-token" };
  const headers = { Authorization: `Bearer ${cfg.accessToken}` };

  try {
    let mediaUrl = ref.url ?? null;
    if (!mediaUrl) {
      const lookup = `https://graph.facebook.com/${cfg.graphVersion}/${ref.mediaId}${phoneNumberId ? `?phone_number_id=${encodeURIComponent(phoneNumberId)}` : ""}`;
      const t = withTimeout(DOWNLOAD_TIMEOUT_MS);
      try {
        const res = await fetch(lookup, { headers, signal: t.controller.signal });
        const json = (await res.json().catch(() => ({}))) as { url?: string; error?: unknown };
        if (!res.ok || typeof json.url !== "string" || !json.url) {
          return { ok: false, code: `meta:media-url:http:${res.status}` };
        }
        mediaUrl = json.url;
      } finally {
        t.done();
      }
    }
    const d = withTimeout(DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(mediaUrl, { headers, signal: d.controller.signal });
      if (!res.ok) return { ok: false, code: `meta:media-download:http:${res.status}` };
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) return { ok: false, code: "meta:media-download:empty" };
      if (buf.byteLength > MAX_AUDIO_BYTES) return { ok: false, code: "meta:media-download:too-large" };
      return { ok: true, bytes: buf, mimeType: res.headers.get("content-type") ?? ref.mimeType ?? "audio/ogg" };
    } finally {
      d.done();
    }
  } catch (e) {
    return { ok: false, code: e instanceof Error && e.name === "AbortError" ? "meta:media-download:timeout" : "meta:media-download:fetch" };
  }
}

/**
 * Transcribe audio bytes with Groq-hosted Whisper.
 * Model is text-out only: Spanish input, plain-text output, temperature 0.
 */
export async function transcribeWhatsappAudio(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<{ ok: true; text: string } | { ok: false; code: string }> {
  const cfg = getWhatsappConfig();
  if (!cfg.groqApiKey) return { ok: false, code: "groq-stt:no-key" };
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), `voice.${ext}`);
  form.append("model", cfg.groqSttModel);
  form.append("language", "es");
  form.append("response_format", "text");
  form.append("temperature", "0");
  const t = withTimeout(TRANSCRIBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.groqBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.groqApiKey}` },
      body: form,
      signal: t.controller.signal,
    });
    const text = (await res.text()).trim();
    if (!res.ok) return { ok: false, code: `groq-stt:http:${res.status}` };
    if (!text) return { ok: false, code: "groq-stt:empty" };
    return { ok: true, text: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, code: e instanceof Error && e.name === "AbortError" ? "groq-stt:timeout" : "groq-stt:fetch" };
  } finally {
    t.done();
  }
}
