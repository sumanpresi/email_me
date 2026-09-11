-- Notewire cloud sync schema.
-- Run this once in your Supabase project: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.

create extension if not exists "pgcrypto";

-- ---------- settings (one row per user) ----------
create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sending_account text,
  whatsapp_number text,
  country_code text default '91',
  updated_at timestamptz not null default now()
);

-- ---------- contacts ----------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  photo text,
  favourite boolean not null default false,
  source text default 'local',
  google_resource_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_user_id_idx on public.contacts (user_id);

-- ---------- groups ----------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists groups_user_id_idx on public.groups (user_id);

-- ---------- group_members ----------
create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);
create index if not exists group_members_user_id_idx on public.group_members (user_id);

-- ---------- notes (history) ----------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text,
  method text not null,          -- 'email' | 'whatsapp'
  status text not null,          -- 'pending' | 'sent' | 'gmail_opened' | 'whatsapp_opened' | 'failed'
  category text,
  cc text,
  bcc text,
  subject text,
  error text,
  note_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists notes_user_id_idx on public.notes (user_id);

-- ---------- note_recipients ----------
create table if not exists public.note_recipients (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  email text,
  phone text,
  wa_status text,                -- 'ready' | 'opened' | 'skipped' (WhatsApp notes only)
  created_at timestamptz not null default now()
);
create index if not exists note_recipients_note_id_idx on public.note_recipients (note_id);
create index if not exists note_recipients_user_id_idx on public.note_recipients (user_id);

-- ================= Row Level Security =================
-- Every table: a user can only ever see/change their own rows.

alter table public.settings enable row level security;
alter table public.contacts enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.notes enable row level security;
alter table public.note_recipients enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contacts" on public.contacts;
create policy "own contacts" on public.contacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own groups" on public.groups;
create policy "own groups" on public.groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own group_members" on public.group_members;
create policy "own group_members" on public.group_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own note_recipients" on public.note_recipients;
create policy "own note_recipients" on public.note_recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
