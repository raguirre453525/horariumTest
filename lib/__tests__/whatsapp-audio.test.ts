import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseWhatsappPayload } from "@/lib/whatsapp/parse";
import { downloadWhatsappAudio, transcribeWhatsappAudio } from "@/lib/whatsapp/audio";

function payloadWith(messages: unknown[]) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "123" },
              messages,
            },
          },
        ],
      },
    ],
  });
}

const audioMsg = (audio: unknown) => ({ from: "5491112345678", id: "wamid.audio1", timestamp: "123", type: "audio", audio });

describe("parseWhatsappPayload audio", () => {
  it("extracts the media reference from a voice note", () => {
    const res = parseWhatsappPayload(
      payloadWith([audioMsg({ id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true })]),
    );
    expect(res).toHaveLength(1);
    expect(res[0].text).toBe("");
    expect(res[0].audio).toEqual({ mediaId: "media-1", mimeType: "audio/ogg; codecs=opus", voice: true, url: undefined });
  });

  it("keeps the embedded download URL when Meta includes it", () => {
    const res = parseWhatsappPayload(
      payloadWith([audioMsg({ id: "media-2", mime_type: "audio/ogg; codecs=opus", voice: true, url: "https://lookaside/x" })]),
    );
    expect(res[0].audio?.url).toBe("https://lookaside/x");
  });

  it("skips audio without a media id and keeps text messages", () => {
    const res = parseWhatsappPayload(
      payloadWith([
        audioMsg({ mime_type: "audio/ogg" }),
        { from: "5491112345678", id: "wamid.2", timestamp: "124", type: "text", text: { body: "hola" } },
      ]),
    );
    expect(res).toHaveLength(1);
    expect(res[0].text).toBe("hola");
  });
});

describe("downloadWhatsappAudio", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_GRAPH_VERSION = "v23.0";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_GRAPH_VERSION;
  });

  it("fails without an access token", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    expect(await downloadWhatsappAudio({ mediaId: "m" }, "123")).toEqual({ ok: false, code: "meta:no-token" });
  });

  it("uses the embedded URL directly with the Bearer token", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "audio/ogg" } }),
    );
    const res = await downloadWhatsappAudio({ mediaId: "m", url: "https://lookaside/x" }, "123");
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://lookaside/x");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("retrieves the URL via media id with the phone_number_id check", async () => {
    const calls: string[] = [];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      calls.push(url);
      if (url.includes("/media-9")) return Promise.resolve(new Response(JSON.stringify({ url: "https://dl/y" }), { status: 200 }));
      return Promise.resolve(new Response(new Uint8Array([9]).buffer, { status: 200 }));
    });
    const res = await downloadWhatsappAudio({ mediaId: "media-9" }, "123");
    expect(res.ok).toBe(true);
    expect(calls[0]).toContain("/v23.0/media-9?phone_number_id=123");
    expect(calls[1]).toBe("https://dl/y");
  });

  it("reports lookup failures with the HTTP status", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await downloadWhatsappAudio({ mediaId: "gone" }, null)).toEqual({
      ok: false,
      code: "meta:media-url:http:404",
    });
  });

  it("rejects oversized media", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array(21 * 1024 * 1024).buffer, { status: 200 }),
    );
    expect(await downloadWhatsappAudio({ mediaId: "m", url: "https://dl/big" }, null)).toEqual({
      ok: false,
      code: "meta:media-download:too-large",
    });
  });
});

describe("transcribeWhatsappAudio", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.GROQ_API_KEY = "test-groq";
    process.env.GROQ_BASE_URL = "https://api.groq.com/openai/v1";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_BASE_URL;
  });

  it("fails without a Groq key", async () => {
    delete process.env.GROQ_API_KEY;
    expect(await transcribeWhatsappAudio(new ArrayBuffer(8), "audio/ogg")).toEqual({
      ok: false,
      code: "groq-stt:no-key",
    });
  });

  it("posts multipart audio with Spanish language and returns trimmed text", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("  agendame el tp el miércoles  ", { status: 200 }));
    const res = await transcribeWhatsappAudio(new ArrayBuffer(8), "audio/ogg; codecs=opus");
    expect(res).toEqual({ ok: true, text: "agendame el tp el miércoles" });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("es");
    expect(form.get("response_format")).toBe("text");
  });

  it("reports provider errors and empty results", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await transcribeWhatsappAudio(new ArrayBuffer(8), "audio/ogg")).toEqual({
      ok: false,
      code: "groq-stt:http:401",
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("   ", { status: 200 }));
    expect(await transcribeWhatsappAudio(new ArrayBuffer(8), "audio/ogg")).toEqual({
      ok: false,
      code: "groq-stt:empty",
    });
  });
});
