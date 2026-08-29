-- Horarium WhatsApp bot persistence. Run manually in Supabase SQL editor.
-- Do NOT modify existing auth/RLS migrations; this file only adds bot tables.

create extension if not exists pgcrypto;

-- identity: one active WhatsApp phone maps to at most one Horarium user
create table if not exists public.whatsapp_identities (
  phone text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_identities_user_id_idx on public.whatsapp_identities(user_id);

drop trigger if exists whatsapp_identities_set_updated_at on public.whatsapp_identities;
create trigger whatsapp_identities_set_updated_at before update on public.whatsapp_identities
for each row execute procedure public.set_updated_at();

-- one-time hashed expiring link challenges (10 min, at most one active per user)
create table if not exists public.whatsapp_link_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_link_challenges_user_id_idx on public.whatsapp_link_challenges(user_id);
create index if not exists whatsapp_link_challenges_code_hash_idx on public.whatsapp_link_challenges(code_hash);
create index if not exists whatsapp_link_challenges_expires_idx on public.whatsapp_link_challenges(expires_at);
-- at most one unused challenge per user (conservative; expiry enforced by query)
create unique index if not exists whatsapp_link_challenges_one_active_per_user on public.whatsapp_link_challenges(user_id) where used_at is null;

-- inbound/outbound message records with unique provider message id and processing/result state
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  wa_id text not null,
  direction text not null check (direction in ('inbound','outbound')),
  body text,
  status text not null default 'received' check (status in ('received','processed','failed','sent')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_wa_id_idx on public.whatsapp_messages(wa_id);
create index if not exists whatsapp_messages_user_id_idx on public.whatsapp_messages(user_id);
create index if not exists whatsapp_messages_created_idx on public.whatsapp_messages(created_at desc);

-- conversation state with pending operation/confirmation and expiry
create table if not exists public.whatsapp_conversations (
  wa_id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  pending_operation jsonb,
  pending_expires_at timestamptz,
  pending_provider_message_id text,
  awaiting_relink boolean not null default false,
  relink_target_user_id uuid references auth.users(id) on delete set null,
  relink_challenge_id uuid references public.whatsapp_link_challenges(id) on delete set null,
  relink_expires_at timestamptz,
  last_ambiguous jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- idempotent addition for existing deployments
alter table public.whatsapp_conversations add column if not exists relink_challenge_id uuid references public.whatsapp_link_challenges(id) on delete set null;
create index if not exists whatsapp_conversations_user_id_idx on public.whatsapp_conversations(user_id);

drop trigger if exists whatsapp_conversations_set_updated_at on public.whatsapp_conversations;
create trigger whatsapp_conversations_set_updated_at before update on public.whatsapp_conversations
for each row execute procedure public.set_updated_at();

-- RLS: enable and keep conservative (no browser access); bot uses service_role
alter table public.whatsapp_identities enable row level security;
alter table public.whatsapp_link_challenges enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_conversations enable row level security;

-- No policies for anon/authenticated = deny via RLS (service_role bypasses RLS)
-- If you need browser-facing read for own identity, add explicit policy later:
-- create policy "Users read own whatsapp identity" on public.whatsapp_identities for select to authenticated using (user_id = auth.uid());

-- Grants: do NOT expose to anon/authenticated via REST; service_role has implicit bypass
-- Explicitly revoke if previously granted
revoke all on public.whatsapp_identities from anon, authenticated;
revoke all on public.whatsapp_link_challenges from anon, authenticated;
revoke all on public.whatsapp_messages from anon, authenticated;
revoke all on public.whatsapp_conversations from anon, authenticated;
