-- ============================================================================
-- people — the org's assignable humans, and ownership of work.
--
-- Plain English: decisions and initiatives need an OWNER (a real person), and
-- agents need a roster of humans to suggest owners from. `people` is that
-- canonical list of profiles: name/title/area, with an OPTIONAL link to a real
-- login (user_id). You can add a teammate before they have an account; when a
-- real user joins the org (a membership row), a person profile is created
-- automatically and linked — so the two never drift. assignee_id on decisions
-- and initiatives is who owns it (NULL = unassigned, a gap agents can flag).
-- ============================================================================

create table people (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users (id) on delete set null,  -- linked login (optional)
  name       text not null,
  email      text,
  title      text,
  area       text,                                  -- product | gtm | eng | exec | other
  is_active  boolean not null default true,

  unique (org_id, user_id)                          -- one profile per login per org (NULLs allowed)
);

comment on table people is 'Assignable humans in an org (profiles). user_id links to a real login when they have one; auto-created on membership. Owners of decisions/initiatives reference this.';

create index people_org_id_idx on people (org_id);

alter table people enable row level security;
create policy people_org_isolation on people for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- ownership: who owns a decision / an initiative ------------------------
alter table decisions   add column if not exists assignee_id uuid references people (id) on delete set null;
alter table initiatives add column if not exists assignee_id uuid references people (id) on delete set null;
create index if not exists decisions_assignee_idx   on decisions (assignee_id);
create index if not exists initiatives_assignee_idx on initiatives (assignee_id);

-- ---- auto-sync: a real user joining the org becomes an assignable person ----
create or replace function public.sync_person_from_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text;
  v_email text;
begin
  select u.email, coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
    into v_email, v_name
    from auth.users u where u.id = new.user_id;

  insert into people (org_id, user_id, name, email)
  values (new.org_id, new.user_id, coalesce(v_name, 'Teammate'), v_email)
  on conflict (org_id, user_id) do nothing;

  return new;
end
$$;

create trigger memberships_sync_person
  after insert on memberships
  for each row execute function public.sync_person_from_membership();

comment on function public.sync_person_from_membership() is
  'On a new membership, ensure an assignable person profile exists for that user (idempotent via unique(org_id,user_id)).';
