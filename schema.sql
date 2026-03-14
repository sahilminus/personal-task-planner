-- ═══════════════════════════════════════════════════════════
--  DayLog — Supabase Schema
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── 1. Daily Tasks ───────────────────────────────────────────
create table if not exists daily_tasks (
  id          text        primary key,
  date_key    text        not null,       -- "YYYY-MM-DD"
  name        text        not null,
  hours       integer     not null default 0,
  minutes     integer     not null default 0,
  notes       text,
  status      text        not null default 'pending'
                          check (status in ('completed','pending','in-progress')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists daily_tasks_date_key_idx on daily_tasks (date_key);

-- ── 2. Work Topics (user-defined tabs) ───────────────────
create table if not exists work_topics (
  id          text        primary key,
  name        text        not null unique,
  created_at  timestamptz not null default now()
);

-- ── 2a. Work Tasks (persistent, not date-specific) ────────────
create table if not exists work_tasks (
  id          text        primary key,
  topic       text        not null,
  name        text        not null,
  priority    text        not null default 'medium'
                          check (priority in ('high','medium','low')),
  notes       text,
  end_date    date,
  status      text        not null default 'pending'
                          check (status in ('completed','pending','in-progress')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);


-- ── 3. Learning Topics (user-defined tabs) ───────────────────
create table if not exists learn_topics (
  id          text        primary key,
  name        text        not null unique,
  created_at  timestamptz not null default now()
);

-- ── 4. Learning Tasks (inside topic tabs) ────────────────────
create table if not exists learn_notes (
  id          text        primary key,
  topic       text        not null,
  title       text        not null,
  content     text,
  tags        text[]      not null default '{}',
  status      text        not null default 'pending'
                          check (status in ('completed','pending','in-progress')),
  start_date  date,
  end_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists learn_notes_topic_idx on learn_notes (topic);

-- ── 5. Backward-compatible migrations (safe to re-run) ───────
alter table daily_tasks add column if not exists user_id uuid references auth.users(id);
alter table work_topics add column if not exists user_id uuid references auth.users(id);
alter table work_tasks  add column if not exists user_id uuid references auth.users(id);
alter table learn_topics add column if not exists user_id uuid references auth.users(id);
alter table learn_notes add column if not exists user_id uuid references auth.users(id);

alter table work_tasks add column if not exists end_date date;
alter table work_tasks add column if not exists topic text not null default 'General';
create index if not exists work_tasks_topic_idx on work_tasks (topic);
alter table learn_notes add column if not exists status text not null default 'pending';
alter table learn_notes add column if not exists start_date date;
alter table learn_notes add column if not exists end_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'learn_notes_status_check'
  ) then
    alter table learn_notes
      add constraint learn_notes_status_check
      check (status in ('completed','pending','in-progress'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'learn_notes_topic_check'
  ) then
    alter table learn_notes drop constraint learn_notes_topic_check;
  end if;
end $$;

-- ── 6. Enable Row-Level Security ───────────────────────────
alter table daily_tasks  enable row level security;
alter table work_topics  enable row level security;
alter table work_tasks   enable row level security;
alter table learn_topics enable row level security;
alter table learn_notes  enable row level security;

-- Example Policies (Run these to ensure only owners can access their data)
create policy "Owners can manage their daily_tasks" on daily_tasks for all using (auth.uid() = user_id);
create policy "Owners can manage their work_topics" on work_topics for all using (auth.uid() = user_id);
create policy "Owners can manage their work_tasks"  on work_tasks  for all using (auth.uid() = user_id);
create policy "Owners can manage their learn_topics" on learn_topics for all using (auth.uid() = user_id);
create policy "Owners can manage their learn_notes"  on learn_notes  for all using (auth.uid() = user_id);

