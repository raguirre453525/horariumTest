"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export function WhatsappLinkCard() {
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      const token = (session as { access_token?: string } | null)?.access_token ?? null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/whatsapp/link-code", { method: "POST", headers });
      const json = (await res.json().catch(() => ({}))) as { code?: string; expires_at?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo generar el código");
      setCode(json.code ?? null);
      setExpires(json.expires_at ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="font-semibold text-[var(--ink)]">Vincular WhatsApp</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Generá un código de un solo uso válido por 10 minutos. Enviá ese código al bot por WhatsApp para vincular tu número.</p>
      <button type="button" onClick={() => void generate()} disabled={loading} className="mt-3 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
        {loading ? "Generando..." : code ? "Regenerar código" : "Generar código"}
      </button>
      {error ? <p role="alert" className="mt-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs text-rose-600">{error}</p> : null}
      {code ? (
        <div className="mt-3 rounded-xl bg-[var(--soft)] p-3">
          <p className="text-xs text-[var(--muted)]">Tu código (mostrado solo una vez)</p>
          <p className="mt-1 text-2xl font-bold tracking-widest text-[var(--ink)]">{code}</p>
          {expires ? <p className="mt-1 text-xs text-[var(--muted)]">Expira: {new Date(expires).toLocaleString("es-AR")}</p> : null}
          <p className="mt-2 text-xs text-[var(--muted)]">Enviá este código por WhatsApp al número del bot.</p>
        </div>
      ) : null}
    </div>
  );
}
