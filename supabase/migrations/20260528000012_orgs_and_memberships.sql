-- ============================================================================
-- orgs + memberships — the multi-tenant root, and the real wiring for RLS.
-- Plain English: until now every table carried an org_id, but nothing said
-- which org a user belongs to. This migration adds:
--   * orgs        — one row per tenant organization.
--   * memberships — links an authenticated user to an org.
-- It then swaps current_org_id() to resolve the caller's org FROM their
-- membership (the swap promised in the setup migration), and adds a trigger
-- that auto-joins every new signup to the single org so RLS "just works".
--
-- Judgment call: orgs is the tenant root, so its own id IS the org identity —
-- it deliberately has no redundant org_id column. RLS on orgs scopes by id.
-- ============================================================================

-- The tenant root.
create table orgs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null
);

comment on table orgs is 'Tenant root. Its id is the org identity used by every other table''s org_id. No redundant org_id column here.';

alter table orgs enable row level security;

create policy orgs_member_access on orgs
  for all
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- Links an authenticated user to an org.
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),

  unique (org_id, user_id)
);

comment on table memberships is 'Links an auth user to an org. Drives org resolution for RLS via current_org_id().';

create index memberships_org_id_idx on memberships (org_id);
create index memberships_user_id_idx on memberships (user_id);

alter table memberships enable row level security;

create policy memberships_org_access on memberships
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- Swap current_org_id() to resolve from membership (was: a JWT claim).
-- SECURITY DEFINER so reading memberships here bypasses RLS — this is what
-- prevents the policy-on-memberships from recursing into itself.
-- Single active membership today; narrow by an active-org claim for multi-org.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1
$$;

comment on function public.current_org_id() is
  'Returns the current user''s org_id from their membership. SECURITY DEFINER to avoid RLS recursion. Resolves a single membership today; narrow by an active-org claim when multi-org arrives.';

-- Auto-join every new authenticated user to the single org.
-- While there is one org this is unambiguous; revisit for multi-org signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select id into v_org from public.orgs order by created_at limit 1;
  if v_org is not null then
    insert into public.memberships (org_id, user_id)
    values (v_org, new.id)
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
