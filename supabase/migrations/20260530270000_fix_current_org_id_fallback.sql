-- ============================================================================
-- SECURITY P0: remove the cross-tenant fallback from current_org_id().
--
-- 20260529000007_self_heal_org_membership.sql hardened current_org_id() with a
-- fallback: if the caller has NO membership, return the oldest org. That was a
-- reasonable belt-and-suspenders while exactly one org existed — but it is a
-- cross-tenant DATA LEAK the moment a second org exists: any authenticated user
-- without a membership row would resolve into the first org and could read/write
-- its data, and connector-runner would stamp pulled signals into the wrong org.
-- docs/CONNECTIVITY.md and docs/SECURITY.md both flag this as must-fix before
-- multi-customer.
--
-- The legitimate self-heal does NOT depend on this fallback:
--   • new signups get a membership from the on_auth_user_created trigger
--     (handle_new_user, 20260528000012), and
--   • every pre-existing user was backfilled by step 2 of the self-heal migration.
-- So we restore the SAFE definition: resolve strictly from membership, and return
-- NULL when there is none. NULL makes every RLS policy (org_id = current_org_id())
-- deny by default — fail CLOSED, never into someone else's tenant.
--
-- A membership-less caller now correctly sees nothing (rather than a stranger's
-- org). If that ever surfaces in practice it is an onboarding bug to fix on an
-- explicit, audited provisioning path — never silently in RLS resolution.
-- ============================================================================

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
  'Returns the caller''s org_id strictly from their membership; NULL if none (RLS then denies — fail closed, never cross-tenant). SECURITY DEFINER to avoid RLS recursion on memberships. The on_auth_user_created trigger provisions membership for new signups; do not reintroduce an org fallback here.';
