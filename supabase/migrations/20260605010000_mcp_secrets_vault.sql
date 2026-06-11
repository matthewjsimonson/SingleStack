-- ============================================================================
-- MCP connector credentials — encryption-at-rest via Supabase Vault (Phase 1.5+).
-- Upgrades the access-controlled-plaintext store: tokens now live ENCRYPTED in the
-- vault; connection_secrets keeps only a reference (secret_id). See docs/mcp-connectors.md.
--
-- Access paths (unchanged in spirit, hardened in storage):
--   • writes  → org-checked SECURITY DEFINER RPCs (set/clear) call vault.create/update.
--   • reads   → mcp_connection_token(), a DEFINER fn GATED to the service role (edge
--               functions only). No client can read a token back.
-- ============================================================================

create extension if not exists supabase_vault with schema vault;

alter table connection_secrets add column if not exists secret_id uuid;

-- Move any existing plaintext tokens into the vault, then drop the plaintext column.
do $$
declare r record; v_id uuid;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'connection_secrets' and column_name = 'token') then
    for r in select connection_id, token from public.connection_secrets where token is not null and secret_id is null loop
      v_id := vault.create_secret(r.token, 'mcp_' || r.connection_id::text, 'MCP connector token');
      update public.connection_secrets set secret_id = v_id where connection_id = r.connection_id;
    end loop;
    alter table public.connection_secrets drop column token;
  end if;
end $$;

-- Set/rotate: store the token in the vault; keep only the reference.
create or replace function public.set_connection_secret(p_connection uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_existing uuid;
begin
  select org_id into v_org from public.connections where id = p_connection;
  if v_org is null or v_org <> public.current_org_id() then raise exception 'not authorized for this connection'; end if;
  select secret_id into v_existing from public.connection_secrets where connection_id = p_connection;
  if v_existing is null then
    v_existing := vault.create_secret(p_token, 'mcp_' || p_connection::text, 'MCP connector token');
    insert into public.connection_secrets (connection_id, org_id, secret_id)
      values (p_connection, v_org, v_existing)
      on conflict (connection_id) do update set secret_id = excluded.secret_id, updated_at = now();
  else
    perform vault.update_secret(v_existing, p_token);
    update public.connection_secrets set updated_at = now() where connection_id = p_connection;
  end if;
  update public.connections set status = 'connected' where id = p_connection;
end $$;

create or replace function public.clear_connection_secret(p_connection uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.connections where id = p_connection;
  if v_org is null or v_org <> public.current_org_id() then raise exception 'not authorized for this connection'; end if;
  delete from public.connection_secrets where connection_id = p_connection;
  update public.connections set status = 'manual' where id = p_connection;
end $$;

-- Read the decrypted token — EDGE FUNCTIONS ONLY (service role). A client (anon /
-- authenticated) gets null AND lacks execute, so a token can never be read back.
create or replace function public.mcp_connection_token(p_connection uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_token text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return null; end if;
  select secret_id into v_id from public.connection_secrets where connection_id = p_connection;
  if v_id is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_id;
  return v_token;
end $$;

revoke all on function public.mcp_connection_token(uuid) from public, anon, authenticated;
grant execute on function public.mcp_connection_token(uuid) to service_role;
revoke all on function public.set_connection_secret(uuid, text) from public;
grant execute on function public.set_connection_secret(uuid, text) to authenticated;
revoke all on function public.clear_connection_secret(uuid) from public;
grant execute on function public.clear_connection_secret(uuid) to authenticated;
