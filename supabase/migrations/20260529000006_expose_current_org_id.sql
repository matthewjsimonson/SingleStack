-- ============================================================================
-- Expose current_org_id() as a callable RPC.
-- Plain English: the web app needs to know which org the logged-in user is in
-- so it can stamp org_id on new rows it inserts (RLS still independently
-- enforces it). The function already exists and is used inside RLS policies;
-- this just grants the API roles permission to call it over PostgREST.
-- Guarded so it also applies on a bare Postgres (CI) where these roles are absent.
-- ============================================================================

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.current_org_id() to %I', r);
    end if;
  end loop;
end
$$;
