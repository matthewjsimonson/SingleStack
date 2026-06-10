-- ============================================================================
-- Heartbeat, +1 beat: hourly account scoring. Reuses the vault-reading
-- invoke_edge_function helper (migration 20260609000001) — same defensive
-- pattern, no-ops until the project_url / service_role_key Vault secrets exist.
-- :42 keeps it clear of scheduled-pulls (:12) and outcome-watch (:27).
-- ============================================================================
do $$ begin
  perform cron.unschedule('singlestack-score-accounts');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('singlestack-score-accounts', '42 * * * *', $cmd$ select public.invoke_edge_function('score-accounts') $cmd$);
exception when others then raise notice 'could not schedule score-accounts: %', sqlerrm; end $$;
