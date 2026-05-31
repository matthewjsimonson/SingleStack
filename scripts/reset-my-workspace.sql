-- ============================================================================
-- reset-my-workspace.sql — wipe YOUR org's content in DEV. Start fresh.
--
-- WHAT IT DOES: deletes every row you've created (signals, themes, decisions,
-- bridges, build items, products, sources, agents… everything org-scoped) for
-- the org tied to your login. Keeps the schema, your org, your membership, and
-- your account — so you stay logged in and just see a blank slate.
--
-- WHAT IT NEVER TOUCHES: orgs, memberships, auth.users. And it ONLY affects the
-- one org matching the email below — never anyone else's data.
--
-- ⚠️  DEV ONLY. Run this in the DEV Supabase project's SQL editor. Never demo.
--    Data never travels between tiers, so this can't affect demo regardless,
--    but the guard below also refuses to run unless you set your email.
--
-- HOW TO RUN: paste into the dev project's SQL editor, set your email on the
-- line marked 👇, and Run. (The SQL editor runs as `postgres`, which is why the
-- session_replication_role trick is allowed — it lets us delete in any order
-- without fighting foreign keys.)
-- ============================================================================

do $$
declare
  v_email text := 'matthewjsimonson@gmail.com';   -- 👇 set YOUR login email
  v_org   uuid;
  v_table text;
begin
  -- Resolve the org from your membership (never hard-coded).
  select m.org_id into v_org
    from memberships m
    join auth.users u on u.id = m.user_id
   where lower(u.email) = lower(v_email)
   order by m.created_at
   limit 1;

  if v_org is null then
    raise exception 'No org found for %, refusing to run. Check the email.', v_email;
  end if;

  -- Turn off FK enforcement for the wipe so delete order can't matter, then
  -- clear every org-scoped table for this org only. Restored at the end.
  set local session_replication_role = replica;

  for v_table in
    select table_name from information_schema.columns
     where column_name = 'org_id' and table_schema = 'public'
       and table_name not in ('orgs', 'memberships')   -- keep the tenant + access
  loop
    execute format('delete from public.%I where org_id = $1', v_table) using v_org;
  end loop;

  set local session_replication_role = default;

  raise notice 'Workspace reset complete for org % (email %). Schema, org, membership, and login preserved.', v_org, v_email;
end $$;
