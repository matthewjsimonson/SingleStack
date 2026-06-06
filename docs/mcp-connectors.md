# MCP Connectors & the Access Model

Status: living design doc. Phase 1 (this doc's first build) wires MCP connectors into
the agentic loop. Later phases add a secure credential store, a prebuilt-connector
catalog, and AI-assisted connector creation.

## Why
Frontier products (ChatGPT, Claude) let users attach **connectors** to agents/chats and
even **create connectors with AI**. SingleStack should do the same: our officers should
reach into the systems our users already run — and everything they gather still lands in
the human-ratified review queue. Connectors *amplify* the agents without weakening the
"living system of record" control story (record changes are still proposals).

## The access model (three layers)
Access is no longer an agent-level "areas" toggle. It's three clean layers:

1. **RLS — the security floor.** Every edge function runs as the caller (JWT forwarded);
   Postgres RLS scopes all data to the org. Always on, independent of agent/skill/workflow.
   *Never weaken this.*
2. **Capability = tools + skills + connectors.** What an agent can *do/reach* is the tools
   it has (`get_record`, `search_signals`, …), the skills it loads, and the **MCP
   connectors** attached to it. This is task-level, not agent-level.
3. **Focus = the skill / workflow step.** What to *consult* is the instruction in the skill
   or the workflow step (we already have per-step `signals` scope).

**Retired:** the internal-"areas" gating in `agent-chat` (`can(area)`). It was a
prompt-scoping workaround for the single-shot path; the agentic loop (`agent-run`) already
scopes by tools + RLS. (Cleanup phase below.)

## MCP runtime — how connectors actually work
The Anthropic **Messages API `mcp_servers`** parameter (beta `mcp-client-2025-11-20`) lets
Claude connect to **remote URL MCP servers** and use their tools *inside the loop*.
Anthropic executes the MCP tool calls server-side — we don't host or proxy them. We just:

- load the agent's attached MCP connections (`connections` where `kind='mcp'`),
- pass them as `mcp_servers: [{ type:'url', name, url, authorization_token? }]` on the
  model call, with the beta header,
- let the existing `agent-run` loop run; MCP tool-use/results resolve server-side and are
  preserved in the message history. Our custom tools (`read_skill`, etc.) keep working
  alongside.

Implications:
- **Reachability:** the MCP server URL must be reachable from Anthropic's infra (public
  endpoint). Self-hosted/in-VPC servers are a later option (SDK worker / managed agents).
- **`pause_turn`:** server-side tool loops can return `stop_reason:"pause_turn"`; the loop
  re-sends to resume.
- **Performance/cost:** connectors add latency + tokens. Gate strictly — only pass
  `mcp_servers` when the agent actually has connectors, so non-connector agents are
  unaffected.

## Credentials — the load-bearing decision
Most useful connectors need auth (OAuth/bearer). Storing secrets is the hard part.

- **Phase 1 (now):** support **no-auth** connectors, and an **optional bearer token** read
  from `connections.config.authorization_token`. ⚠️ This is plaintext in a row readable by
  org members — acceptable for dogfood/dev, **not** for untrusted multi-tenant production.
- **Phase 1.5 — DONE (access-control + encryption-at-rest):** tokens are stored
  **encrypted in Supabase Vault** (pgsodium); `connection_secrets` holds only a `secret_id`
  reference, and is RLS-locked. Writes go through **org-checked `SECURITY DEFINER` RPCs**
  (`set_/clear_connection_secret` → `vault.create/update_secret`). Reads happen **only via
  `mcp_connection_token()`, a `SECURITY DEFINER` RPC gated to the service role** — clients
  (anon/authenticated) lack execute *and* get null, so a token can never be read back.
  The edge function decrypts at run time to pass the token to the connector.
- **Still open — OAuth** (the next real build; see below).

## OAuth — scoped, not yet built (and why)
Most useful providers (GitHub, Notion, Linear, Slack) authenticate via **OAuth**, not a
pasted bearer token. OAuth is genuine infrastructure, and it can't be responsibly
"blind-shipped" — it needs real provider apps + live testing. What it requires:

1. **A provider OAuth app per connector** — register SingleStack with GitHub/Notion/…,
   obtaining a `client_id` + `client_secret`, configured as **edge-function secrets**
   (never in the repo/DB). One per provider.
2. **An authorize → callback flow:**
   - `connect-mcp/start` builds the provider authorize URL with **PKCE** + a signed
     **state** (CSRF + which org/agent/connection), redirects the user.
   - `connect-mcp/callback` verifies state, exchanges `code` → `{access_token,
     refresh_token, expires_at}`, and stores them via the secure store (extend the
     vault secret to hold the token set + refresh metadata).
3. **Refresh:** before a run, if the access token is near expiry, refresh it
   server-side using the stored `refresh_token` (Managed Agents' vaults do this
   automatically; on the Messages API we do it ourselves).
4. **Live testing:** OAuth bugs (state/PKCE/refresh) are only catchable against a real
   provider — so this lands when we can register an app and test end-to-end.

Until then: **bearer-token connectors work today** (stored encrypted, per above), which
covers self-hosted/PAT-style MCP servers. The OAuth providers in the catalog will say
"needs OAuth — coming" rather than silently failing.

## Multi-tenancy
Connections are per-agent (or org-level, `agent_id` null), RLS-scoped. Each org's
connectors + credentials are isolated. Connector *names* passed to the API are
sanitized/derived from the label.

## Phasing
- **P1 — wire MCP into `agent-run`** *(this build)*: attached connectors work in the loop;
  optional bearer auth from config; beta header; gated.
- **P1.5 — secure credential store**: ✅ access-control + **encryption-at-rest** (Vault).
  Bearer-token connectors work today.
- **P1.6 — OAuth** (per §OAuth above): provider apps + authorize/callback + refresh.
  Needs real provider registration + live testing.
- **P2 — prebuilt connector catalog**: one-click attach common connectors
  (GitHub, Slack, Linear, Drive, web search) to an agent or a chat.
- **P3 — "create an MCP with AI"**: an officer scaffolds a connector from a description
  (Anthropic MCP-authoring skills), then attaches it.
- **Cleanup — retire internal-area access**: drop `agent-chat`'s `can()` gating; reframe
  the Connections tab to MCP-only; fold "Alignment" into focus (not access).
- **Cross-cutting — accessibility pass**: keyboard nav, focus management, semantic
  buttons, contrast — once these surfaces settle.

## Security checklist (per phase, before exposing to untrusted tenants)
- [ ] Credentials in a secure store, never plaintext, never returned to the client.
- [ ] Connector URLs validated; no SSRF into internal hosts from server-side helpers.
- [ ] Per-tenant isolation verified (RLS on `connections` + the secret store).
- [ ] Connector tool output still routes through the review queue (no silent record writes).
- [ ] Rate/error handling: a down/slow connector degrades gracefully, never hangs the loop.
