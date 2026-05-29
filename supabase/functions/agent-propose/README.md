# `agent-propose` — the first working agent

Embed → retrieve → Claude → **propose**. Given an agent and a target record, it
retrieves relevant document chunks (RAG), asks Claude to propose a concrete
change, and writes that as a `proposal` (+ `proposal_changes`) for human
approval — logging the run in `agent_runs`. This is the loop the prototype
demoed, running against the real schema.

Runs as the **caller**: the user's JWT is forwarded to Supabase, so every read
and write is fenced to their org by RLS.

## Request

`POST` with a Supabase user JWT in `Authorization: Bearer …`:

```json
{
  "agent_key": "cpo",            // which agent (agents.key, must be active)
  "gtm_record_id": "uuid",       // target — exactly ONE of gtm_record_id / product_id
  "product_id": "uuid",
  "instruction": "optional extra steer, e.g. 'tighten the positioning'",
  "top_k": 6                     // optional, # of chunks to retrieve (default 6)
}
```

## Response

```json
{
  "run_id": "uuid",
  "proposal_id": "uuid",
  "retrieved": 6,
  "proposal": { "title": "...", "rationale": "...", "conf_level": 0.82,
                "conf_label": "High", "changes": [...], "changes_saved": 2 }
}
```

On failure the `agent_runs` row is marked `failed` with the error, and the
response is `{ "error": "...", "run_id": "..." }`.

## Secrets

Set as Supabase function secrets (`supabase secrets set …`):

- `ANTHROPIC_API_KEY` — Claude (the reasoning). Model defaults to
  `claude-opus-4-8`; override per-agent via `agents.model`.
- `OPENAI_API_KEY` — embeddings (`text-embedding-3-small`, 1536-dim, matching
  `document_chunks.embedding`).

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically.

## Deploy

```sh
supabase functions deploy agent-propose
```

`verify_jwt` is on by default, which is what we want — the function needs a real
user JWT so RLS scopes everything to the caller's org.
