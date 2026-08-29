import "server-only";
import { randomInt } from "node:crypto";
import { getAuthUser, getServiceClient } from "@/lib/supabase-server";
import { hashLinkCode } from "@/lib/whatsapp/hmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(req: Request) {
  const { user } = await getAuthUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  try {
    const service = getServiceClient();
    const code = String(randomInt(100000, 1000000)); // 6 digits
    const hash = hashLinkCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // at most one active per user: delete previous unused
    await service.from("whatsapp_link_challenges").delete().eq("user_id", user.id).is("used_at", null);
    const { error } = await service.from("whatsapp_link_challenges").insert({
      user_id: user.id,
      code_hash: hash,
      expires_at: expiresAt,
    });
    if (error) throw error;

    return json({ code, expires_at: expiresAt }, 200);
  } catch (e) {
    console.error("[link-code] error", e);
    return json({ error: "No se pudo generar el código" }, 500);
  }
}
