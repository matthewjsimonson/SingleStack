-- ============================================================================
-- MCP ingestion: link a source to the MCP connection that pulls its data.
-- The agent loop already reaches MCP servers (agent-run passes mcp_servers); the
-- missing half is INGESTION — pulling from an MCP source on a schedule into
-- signals. A source declares WHAT it is + how to aim (targets/guidance); the
-- connection declares HOW to reach the server (mcp_url + a vault-stored token).
-- connection_id ties them so connector-runner can pull. on delete set null: a
-- removed connection leaves the source defined but un-pullable, not deleted.
-- ============================================================================

alter table sources add column if not exists connection_id uuid references connections (id) on delete set null;
comment on column sources.connection_id is 'The MCP connection (kind=mcp) that pulls this source''s data. Required for auth_mode=mcp sources; the connector-runner reaches the server via the connection''s mcp_url + vault token.';
create index if not exists sources_connection_id_idx on sources (connection_id);
