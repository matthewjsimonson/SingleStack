-- ============================================================================
-- The heartbeat gets a PULSE you can see: every tick writes a bookkeeping row.
--
-- Until now a dormant heartbeat (Vault secrets unset) only RAISEd a notice —
-- visible in Postgres logs, invisible to the product. "Armed vs dormant"
-- must be a queryable fact so the app can answer "is the network pulling on
-- its own?" in one read (singlestack-ui non-negotiable: status is always
-- answerable). This adds:
--
--   • heartbeat_ticks — one row per cron tick per function: invoked, or
--     skipped/failed with the reason. Instance-level operational metadata
--     (no org data, no secrets); readable by any signed-in user. 7-day
--     retention, pruned by the writer itself.
--   • invoke_edge_function — replaced to record its outcome each tick.
--     Same security posture as before: SECURITY DEFINER, revoked from app
--     roles; only cron (postgres) executes it.
--
-- Defensive like the original: the bookkeeping write is wrapped so a logging
-- failure can never break the tick itself.
-- ============================================================================

create table if not exists heartbeat_ticks (
  id        uuid primary key default gen_random_uuid(),
  fired_at  timestamptz not null default now(),
  fn_name   text not null,                  -- scheduled-pulls | outcome-watch
  status    text not null,                  -- invoked | skipped | failed
  reason    text                            -- why, when skipped/failed
);

comment on table heartbeat_ticks is 'One row per heartbeat cron tick per machine function: invoked, or skipped/failed with the reason. Instance-level operational pulse (no org data); the app reads it to show automation health. 7-day retention, pruned by the writer.';

create index if not exists heartbeat_ticks_fired_idx on heartbeat_ticks (fn_name, fired_at desc);

-- Operational metadata, not tenant data: every signed-in user may read the
-- pulse; nothing but the cron-only writer (postgres, bypasses RLS) may write.
alter table heartbeat_ticks enable row level security;
do $$ begin
  create policy heartbeat_ticks_read on heartbeat_ticks for select to authenticated using (true);
exception when others then null; end $$;

-- Replace the invoker: same behavior + a bookkeeping row per tick.
create or replace function public.invoke_edge_function(fn_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  svc_key  text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into svc_key  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if base_url is null or svc_key is null then
    begin
      insert into heartbeat_ticks (fn_name, status, reason)
        values (fn_name, 'skipped', 'Vault secrets project_url / service_role_key not set — heartbeat is dormant');
      delete from heartbeat_ticks where fired_at < now() - interval '7 days';
    exception when others then null; end;
    raise notice 'heartbeat: vault secrets project_url / service_role_key not set — skipping %', fn_name;
    return;
  end if;
  perform net.http_post(
    url     := base_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || svc_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  begin
    insert into heartbeat_ticks (fn_name, status) values (fn_name, 'invoked');
    delete from heartbeat_ticks where fired_at < now() - interval '7 days';
  exception when others then null; end;
exception when others then
  begin
    insert into heartbeat_ticks (fn_name, status, reason) values (fn_name, 'failed', sqlerrm);
  exception when others then null; end;
  raise notice 'heartbeat: invoking % failed: %', fn_name, sqlerrm;
end;
$$;

comment on function public.invoke_edge_function(text) is 'Heartbeat helper: cron-only invoker for machine edge functions (scheduled-pulls, outcome-watch). Reads Vault secrets at tick time, records every tick in heartbeat_ticks. Locked away from app roles.';

-- Re-assert the lock (CREATE OR REPLACE preserves grants, but be explicit).
revoke all on function public.invoke_edge_function(text) from public;
do $$ begin
  revoke all on function public.invoke_edge_function(text) from anon, authenticated;
exception when others then null; end $$;
