-- ============================================================================
-- The heartbeat — scheduled invocation of the platform's background loops.
--
-- Sources have a cadence (daily | weekly) and outcomes have review horizons,
-- but until now NOTHING ticked: every pull and every outcome check was
-- hand-cranked. This wires pg_cron + pg_net to invoke two machine-only edge
-- functions hourly:
--   • scheduled-pulls — pulls sources whose cadence window has elapsed
--   • outcome-watch   — drafts verdicts for expected outcomes past their horizon
--
-- DEFENSIVE BY DESIGN: every step is wrapped so this migration NEVER fails a
-- deploy. It requires two Vault secrets to actually fire (set once, in SQL or
-- Studio → Vault):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>',        'service_role_key');
-- Until those exist, each tick is a logged no-op. See docs/SETUP-RUNBOOK.md.
-- ============================================================================

-- 1. Extensions (no-ops where unavailable; never fail the deploy).
do $$ begin
  create extension if not exists pg_cron;
exception when others then raise notice 'pg_cron unavailable: %', sqlerrm; end $$;
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net unavailable: %', sqlerrm; end $$;

-- 2. The invoker. Reads the project URL + service key from Vault AT TICK TIME
--    (no secrets baked into cron command text) and POSTs to the edge function.
--    SECURITY DEFINER so cron's role can read vault; execution is locked to
--    superuser/postgres only — app roles must NOT be able to trigger
--    service-role invocations.
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
    raise notice 'heartbeat: vault secrets project_url / service_role_key not set — skipping %', fn_name;
    return;
  end if;
  perform net.http_post(
    url     := base_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || svc_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
exception when others then
  raise notice 'heartbeat: invoking % failed: %', fn_name, sqlerrm;
end;
$$;

comment on function public.invoke_edge_function(text) is 'Heartbeat helper: cron-only invoker for machine edge functions (scheduled-pulls, outcome-watch). Reads Vault secrets at tick time. Locked away from app roles.';

revoke all on function public.invoke_edge_function(text) from public;
do $$ begin
  revoke all on function public.invoke_edge_function(text) from anon, authenticated;
exception when others then null; end $$;

-- 3. Schedule the ticks (idempotent: unschedule first). Hourly is right for
--    daily/weekly cadences and outcome horizons measured in days — the
--    functions themselves decide what is actually due and cap work per tick.
do $$ begin
  perform cron.unschedule('singlestack-scheduled-pulls');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('singlestack-scheduled-pulls', '12 * * * *', $cmd$ select public.invoke_edge_function('scheduled-pulls') $cmd$);
exception when others then raise notice 'could not schedule scheduled-pulls: %', sqlerrm; end $$;

do $$ begin
  perform cron.unschedule('singlestack-outcome-watch');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('singlestack-outcome-watch', '27 * * * *', $cmd$ select public.invoke_edge_function('outcome-watch') $cmd$);
exception when others then raise notice 'could not schedule outcome-watch: %', sqlerrm; end $$;
