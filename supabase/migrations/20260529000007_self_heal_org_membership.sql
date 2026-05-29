-- ============================================================================
-- Self-healing org membership.
-- Plain English: the original handle_new_user() trigger auto-joins a new signup
-- to the single org — but only fires on INSERT into auth.users, so any user who
-- signed up before/around the trigger (or if it errored) can end up with NO
-- membership. With no membership, current_org_id() returns NULL and RLS hides
-- everything + blocks inserts ("Could not resolve your organization").
--
-- This migration:
--   1. guarantees at least one org exists,
--   2. backfills a membership for every existing auth user that lacks one,
--   3. hardens current_org_id(): if the caller has no membership yet, fall back
--      to the single org and (best-effort) create the membership, so the app
--      self-heals instead of dead-ending.
-- ============================================================================

-- 1. Ensure an org exists.
insert into public.orgs (name)
select 'SingleStack'
where not exists (select 1 from public.orgs);

-- 2. Backfill memberships for users who have none.
insert into public.memberships (org_id, user_id)
select (select id from public.orgs order by created_at limit 1), u.id
from auth.users u
where not exists (select 1 from public.memberships m where m.user_id = u.id);

-- 3. Harden current_org_id(): resolve from membership; if the caller has none
--    yet, fall back to the single org so the app never dead-ends on a missing
--    membership. Pure read (STABLE — no writes), safe to call from RLS. New
--    signups still get a real membership via the handle_new_user() trigger;
--    the backfill above covers everyone who pre-dates it.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select m.org_id from public.memberships m
       where m.user_id = auth.uid()
       order by m.created_at limit 1),
    (select id from public.orgs order by created_at limit 1)
  )
$$;

comment on function public.current_org_id() is
  'Returns the caller''s org_id from their membership; falls back to the single org if they have none yet (so the app never dead-ends). Pure read, SECURITY DEFINER to avoid RLS recursion.';
