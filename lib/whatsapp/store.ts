import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

// identity
export async function getIdentityByPhone(phone: string) {
  const s = service();
  const { data } = await s.from("whatsapp_identities").select("phone, user_id").eq("phone", phone).maybeSingle();
  return data as { phone: string; user_id: string } | null;
}

export async function getIdentityByUserId(userId: string) {
  const s = service();
  const { data } = await s.from("whatsapp_identities").select("phone, user_id").eq("user_id", userId).maybeSingle();
  return data as { phone: string; user_id: string } | null;
}

export async function upsertIdentity(phone: string, userId: string) {
  const s = service();
  // phone is primary key, upsert
  const { error } = await s.from("whatsapp_identities").upsert({ phone, user_id: userId, updated_at: new Date().toISOString() }, { onConflict: "phone" });
  if (error) throw error;
}

export async function deleteIdentity(phone: string) {
  const s = service();
  const { error } = await s.from("whatsapp_identities").delete().eq("phone", phone);
  if (error) throw error;
}

// challenges
export async function createChallenge(userId: string, codeHash: string, expiresAt: string) {
  const s = service();
  // enforce at most one active per user: delete previous unused if exists
  await s.from("whatsapp_link_challenges").delete().eq("user_id", userId).is("used_at", null);
  const { error } = await s.from("whatsapp_link_challenges").insert({ user_id: userId, code_hash: codeHash, expires_at: expiresAt });
  if (error) throw error;
}

export async function findValidChallengeByHash(codeHash: string) {
  const s = service();
  const now = new Date().toISOString();
  const { data } = await s
    .from("whatsapp_link_challenges")
    .select("id, user_id, code_hash, expires_at, used_at")
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  return data as { id: string; user_id: string; code_hash: string; expires_at: string; used_at: string | null } | null;
}

export async function findValidChallengeByUserId(userId: string) {
  const s = service();
  const now = new Date().toISOString();
  const { data } = await s
    .from("whatsapp_link_challenges")
    .select("id, user_id, code_hash, expires_at, used_at")
    .eq("user_id", userId)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  return data as { id: string; user_id: string; code_hash: string; expires_at: string; used_at: string | null } | null;
}

export async function markChallengeUsed(id: string) {
  const s = service();
  const now = new Date().toISOString();
  const { data, error } = await s
    .from("whatsapp_link_challenges")
    .update({ used_at: now })
    .eq("id", id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: existing } = await s.from("whatsapp_link_challenges").select("used_at").eq("id", id).maybeSingle();
    if (existing && (existing as { used_at: string | null }).used_at) throw new Error("Challenge already used");
    throw new Error("Challenge not found or already used");
  }
}

// messages dedup
export async function isDuplicateProviderMessage(providerId: string): Promise<boolean> {
  const s = service();
  const { data } = await s.from("whatsapp_messages").select("id").eq("provider_message_id", providerId).maybeSingle();
  return Boolean(data);
}

export async function insertInboundMessage(waId: string, providerId: string, body: string, userId: string | null) {
  const s = service();
  const { error } = await s.from("whatsapp_messages").insert({
    provider_message_id: providerId,
    wa_id: waId,
    direction: "inbound",
    body,
    status: "received",
    user_id: userId,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return false; // duplicate
    throw error;
  }
  return true;
}

export async function insertOutboundMessage(
  waId: string,
  body: string,
  providerId: string | null,
  userId: string | null,
  status: "sent" | "failed" = "sent",
) {
  const s = service();
  await s.from("whatsapp_messages").insert({
    provider_message_id: providerId ?? `out-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    wa_id: waId,
    direction: "outbound",
    body,
    status,
    user_id: userId,
  });
}

// conversation state
export type ConversationState = {
  wa_id: string;
  user_id: string | null;
  pending_operation: Record<string, unknown> | null;
  pending_expires_at: string | null;
  pending_provider_message_id: string | null;
  awaiting_relink: boolean;
  relink_target_user_id: string | null;
  relink_challenge_id: string | null;
  relink_expires_at: string | null;
  last_ambiguous: unknown | null;
  updated_at: string;
};

export async function getConversation(waId: string): Promise<ConversationState | null> {
  const s = service();
  const { data } = await s.from("whatsapp_conversations").select("*").eq("wa_id", waId).maybeSingle();
  return (data as ConversationState | null) ?? null;
}

export async function upsertConversation(waId: string, patch: Partial<ConversationState>) {
  const s = service();
  const existing = await getConversation(waId);
  if (!existing) {
    const { error } = await s.from("whatsapp_conversations").insert({
      wa_id: waId,
      user_id: patch.user_id ?? null,
      pending_operation: patch.pending_operation ?? null,
      pending_expires_at: patch.pending_expires_at ?? null,
      pending_provider_message_id: patch.pending_provider_message_id ?? null,
      awaiting_relink: patch.awaiting_relink ?? false,
      relink_target_user_id: patch.relink_target_user_id ?? null,
      relink_challenge_id: patch.relink_challenge_id ?? null,
      relink_expires_at: patch.relink_expires_at ?? null,
      last_ambiguous: patch.last_ambiguous ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return;
  }
  const { error } = await s
    .from("whatsapp_conversations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("wa_id", waId);
  if (error) throw error;
}

export async function clearPending(waId: string) {
  await upsertConversation(waId, {
    pending_operation: null,
    pending_expires_at: null,
    pending_provider_message_id: null,
  });
}

export async function setPending(waId: string, op: Record<string, unknown>, providerMessageId: string) {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await upsertConversation(waId, {
    pending_operation: op,
    pending_expires_at: expires,
    pending_provider_message_id: providerMessageId,
  });
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}
