-- ============================================================================
-- MCP connector credentials — a SECURE store (Phase 1.5). See docs/mcp-connectors.md.
--
-- The token never touches the client API surface:
--   • the table is RLS-LOCKED — RLS on, NO policies — so the authenticated role can
--     neither read nor write it directly;
--   • writes go through org-checked SECURITY DEFINER RPCs (set/clear);
--   • reads happen only in edge functions, via the service role, to pass the token to
--     Anthropic's MCP connector. There is deliberately NO "get" RPC (that would let a
--     client read the secret back).
-- Encryption-at-rest (pgsodium/Vault) is the next hardening; access-control is here.
-- ============================================================================

create table if not exists connection_secrets (
  connection_id uuid primary key references connections (id) on delete cascade,
  org_id        uuid not null,
  token         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table connection_secrets enable row level security;
-- No policies on purpose: authenticated has zero direct access. Definer RPCs (owner)
-- and the service role (edge functions) are the only paths in.

-- Set/rotate a connector's token. Org-checked; marks the connection connected.
create or replace function public.set_connection_secret(p_connection uuid, p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from connections where id = p_connection;
  if v_org is null or v_org <> public.current_org_id() then
    raise exception 'not authorized for this connection';
  end if;
  insert into connection_secrets (connection_id, org_id, token)
    values (p_connection, v_org, p_token)
    on conflict (connection_id) do update set token = excluded.token, updated_at = now();
  update connections set status = 'connected' where id = p_connection;
end $$;

-- Remove a connector's token. Org-checked; marks the connection manual.
create or replace function public.clear_connection_secret(p_connection uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from connections where id = p_connection;
  if v_org is null or v_org <> public.current_org_id() then
    raise exception 'not authorized for this connection';
  end if;
  delete from connection_secrets where connection_id = p_connection;
  update connections set status = 'manual' where id = p_connection;
end $$;

revoke all on function public.set_connection_secret(uuid, text) from public;
revoke all on function public.clear_connection_secret(uuid) from public;
grant execute on function public.set_connection_secret(uuid, text) to authenticated;
grant execute on function public.clear_connection_secret(uuid) to authenticated;

comment on table connection_secrets is 'MCP connector tokens. RLS-locked: written via set/clear_connection_secret (org-checked, SECURITY DEFINER), read only by edge functions via the service role. Never returned to a client.';
