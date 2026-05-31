# Connectivity — bringing the world's signals in, easily and securely

Status: **design** · Owner: SingleStack
Connectivity is a **product goal**, not just an agent feature. SingleStack's
whole premise — compounding intelligence — is only as good as what flows in. So
"connect a source" has to be **easy** (a few clicks, no engineering) and
**secure** (we're handling other companies' credentials and data). This doc is
the strategy + the phased build.

## The principle
A company already generates and has access to enormous signal: product analytics,
call transcripts, support tickets, competitor moves, market/review data, news.
Today SingleStack only ingests what a human types. The goal: **make the firehose
addressable** — turn external systems into living sources that feed signals →
themes → bridges automatically, with the human curating, not transcribing.

Three honest truths shape the approach:
1. **We should not build N bespoke integrations.** That's a treadmill. Prefer a
   small number of *general* ingestion mechanisms.
2. **MCP is the right primary bet** — it's a standard protocol for exposing tools
   & data to AI, it's how this very session reaches G2, and it turns "integrate
   vendor X" into "point at an MCP server." But MCP is young; not everything has
   a server yet.
3. **Security is the hard part, and it's non-negotiable.** Credentials and
   third-party data are the crown jewels. Get this wrong once and trust is gone.

## The shape of a "source" (what already exists)
The schema already has the bones:
- **`connections`** — `kind` (`internal` | `mcp`), `mcp_url`, `status`
  (`manual` | `connected` | `disconnected`), `config` jsonb. *Built, not wired.*
- **`sources`** — the named inputs that signals attach to (`kind`, `status`,
  `rules`, optional `competitor_id` / `market_lens`, and now `product_id`).
- **`tracking_topics`** — natural-language "what to watch" (`category`:
  signals | competitive | market; `prompt`; `focus`). The instruction layer.

So a fully-wired source = a **connection** (how we reach it) + a **source** (the
named input) + **tracking_topics** (what to pull) → produces **signals**.

## Connectivity tiers (general mechanisms, not per-vendor)
We support a spectrum, easiest-to-richest, so something works on day one and the
ceiling is high:

**Tier 0 — Manual / paste (works today).** A human logs a signal, or pastes a
chunk (a review, a transcript, a competitor page) and we extract signals from it.
Zero integration risk; the floor.

**Tier 1 — Assisted pull (works today, via me).** The agent (me, or an in-app
agent later) reaches a source it can access — G2 over MCP, the web, a public
repo — and drafts signals the human ratifies. This is the bridge until Tier 2.

**Tier 2 — MCP connectors (the primary bet, to build).** The user adds an MCP
server URL (+ auth) as a `connection`. SingleStack lists its tools, the user
picks what to pull and writes a `tracking_topic`, and a server-side runner calls
the MCP tools on a schedule, normalizes results into signals. "Integrate vendor
X" becomes "paste vendor X's MCP URL."

**Tier 3 — Native ingestion for the few sources without MCP.** A thin set of
first-party connectors (webhook intake, email-in, CSV/API) for high-value
sources that lack an MCP server. Kept deliberately small.

## Security model (non-negotiable, designed up front)
This is the part we will not cut corners on. Principles:

1. **Never store raw credentials in `config`.** The schema comment already says
   this. Secrets go to a dedicated secret store (Supabase Vault / a KMS-backed
   table), referenced by handle. `connections.config` holds only non-secret
   settings (URL, which tools, scopes).
2. **Least privilege & read-only by default.** A connection requests the minimum
   scope; default to read-only. Surface exactly what a source can access.
3. **Per-org isolation extends to connections.** RLS already scopes
   `connections`/`sources` to the org. The *runner* must also execute with the
   org's secrets only — never cross-tenant. (Note: fix the `current_org_id()`
   fallback before any multi-customer connectivity — a misresolved org + a live
   connector is a data-leak path.)
4. **Outbound allowlist + egress control.** MCP servers are arbitrary URLs. The
   runner must enforce an allowlist / SSRF protection so a malicious URL can't
   pivot into our infra. Treat every MCP response as **untrusted data**, never
   instructions (prompt-injection defense — exactly the class of attack we've
   already seen in tooling).
5. **Auditable.** Every pull is an `agent_runs`-style record: what was fetched,
   when, how many signals produced, cost. The human can see and revoke.
6. **Revocable & transparent.** One click to disconnect; clear "last synced /
   what it pulled" on every source. Disconnect must stop the runner immediately.

## What to build, in order (slices)
1. **Connect-a-source UI (Tier 0/1 made first-class).** A real "Add source" flow
   on Signals/Competitive/Market: pick a type, name it, write a tracking topic
   ("track Productboard's positioning + pricing changes"). For now it queues for
   *assisted* pull; this makes the manual/assisted path feel like a product, and
   captures the user's intent as data.
2. **Secret store + connection plumbing.** Vault-backed secret handles;
   `connections` gains a secret reference; the security model above, enforced.
3. **MCP runner (Tier 2 core).** A server-side function that, given a connection
   + tracking_topics, calls MCP tools, normalizes → signals, logs the run,
   respects allowlist/egress/untrusted-data rules. Start read-only, scheduled.
4. **Source health + audit UI.** Last sync, items pulled, errors, revoke — on
   every source. Trust is a feature.
5. **Tier 3 native intake** (webhook/email/CSV) for high-value MCP-less sources.

## Kickstart for the dogfood (what we do TODAY)
We don't wait for the runner. To get real signals flowing now:
- **G2 (assisted):** I pull category/competitor/buyer-intent data via my live G2
  connection and draft signals → you ratify. Real market + competitive signals,
  today.
- **GitHub (assisted):** I read our repo's releases/changelog → product signals.
- **Web (assisted):** I search competitor launches/funding/positioning → signals.
- Each becomes a `source` (so provenance is real) + the findings become
  `signals`. You experience the *destination* of connectivity while we build the
  *pipe*.

This both seeds Phase 3 of the dogfood AND lets you feel exactly where the
in-product "connect a source" experience needs to land — which is goal #2.
