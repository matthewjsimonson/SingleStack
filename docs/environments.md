# Environments — setup & runbook (2-tier: Dev + Demo)

SingleStack runs two **isolated** tiers on the Supabase free tier (2 projects).
Same code everywhere; only the Supabase project (data) and the env vars differ.

```
            git branch     Vercel env      Supabase project           data
  ────────  ───────────    ────────────    ─────────────────────────  ───────────────
  Dev       develop        Preview         singlestack-dev   (new)     none / throwaway
  Demo      main           Production      pzulufyoqvqevjrmtmfj (exist) demo data
```

**Promotion flow:** feature branch → PR into `develop` (deploys to Dev) → PR
`develop` → `main` (deploys to Demo). Each merge runs migrations against *that
tier's* DB and triggers *that tier's* Vercel deploy. Code flows forward.

> Decisions locked: 2 Supabase projects (free tier). The existing project
> `pzulufyoqvqevjrmtmfj` stays as **Demo** (it holds the GrowthStudio example).
> `singlestack-dev` is created fresh for development. A third **Production** tier
> can be added later (new project + a `production` Environment) when you outgrow
> the free tier — the workflow is written so that's a small additive change.

---

## What's already in the repo (done by code)

- `.github/workflows/deploy-supabase.yml` is **branch-aware**: it picks a GitHub
  Environment from the branch (`develop`→`development`, `main`→`demo`) and reads
  that Environment's Supabase secrets. A guard step fails loudly if an
  Environment is missing secrets — it never deploys to the wrong DB.
- `web/.env.local.example` documents the per-tier Vercel variables.

## What you do in the dashboards (one-time)

### 1. Supabase — create ONE new project
1. Create **`singlestack-dev`** (keep the existing `pzulufyoqvqevjrmtmfj` as
   **demo**). Any region is fine — the workflow maps each project to its own
   Session pooler host (see Troubleshooting), so a new region just needs its
   host added to the `case` in `deploy-supabase.yml`.
2. Set any **database password** you like — the workflow URL-encodes it, so
   special characters are safe.
3. **Connect** (top bar) → **App Frameworks**/connection info → copy the
   **Project URL** and **anon** key (for Vercel). The **project ref** is the
   subdomain of the URL / the string after `/project/` in the dashboard address
   bar, also shown under Settings → General.
4. Add the Edge Function secret **`ANTHROPIC_API_KEY`** (Project → Edge Functions
   → Secrets) — functions are per-project, so dev needs its own.
5. Confirm the existing **demo** project already has `ANTHROPIC_API_KEY` and note
   its URL / anon key / ref / DB password for the secrets below.

### 2. GitHub — create TWO Environments with secrets
GitHub → repo → Settings → **Environments** → New environment. Create
`development` and `demo`. In **each**, add three secrets:

| Secret | `development` | `demo` |
|---|---|---|
| `SUPABASE_PROJECT_REF` | dev project ref | `pzulufyoqvqevjrmtmfj` |
| `SUPABASE_DB_PASSWORD` | dev DB password | demo DB password |
| `SUPABASE_ACCESS_TOKEN` | the `sbp_…` token | the same `sbp_…` token |

> The old repo-level `SUPABASE_*` secrets can be deleted once both Environments
> exist — the workflow now reads them from the Environment.

### 3. Vercel — one project, two scopes
Vercel → Project → Settings:
- **Git**: Production Branch = `main`. (Preview deploys cover `develop` + PRs.)
- **Environment Variables** — set `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` per scope:
  - **Production** → `pzulufyoqvqevjrmtmfj` (demo) URL + anon key
  - **Preview** → `singlestack-dev` URL + anon key
- For each Supabase project → Authentication → URL Configuration, add the
  matching Vercel URL(s) to Site URL + Redirect URLs so auth redirects resolve.

### 4. Create the branch (I do this part)
From `main`: create `develop`. After that, pushing to `develop` deploys Dev and
pushing/merging to `main` deploys Demo.

---

## Daily flow

1. Branch off `develop`, build a feature, open a PR into `develop`.
2. Merge → dev DB migrates, dev Preview deploys. Verify with throwaway data.
3. PR `develop` → `main`. Merge → demo DB migrates, Production (demo) deploys.

## Guardrails
- **Migrations are forward-only and additive** by convention, so the same files
  apply cleanly to both DBs regardless of which data each holds.
- Demo data lives only in the demo project; dev is throwaway. Neither leaks into
  the other — they're separate databases.
- When a real **Production** tier is added later, `main` becomes prod and a new
  `staging` branch becomes demo; the workflow comment block notes this.

## Troubleshooting deploys

The migration step connects through the project's **Session pooler** (port
5432), because GitHub Actions runners are IPv4-only and direct DB connections
are IPv6-only on newer projects.

**`FATAL: tenant/user postgres.<ref> not found`** — the pooler host is wrong for
that project. Each project lives on a specific pooler cluster + region (e.g.
`aws-1-us-west-1`), and it is **not derivable from the ref**. Get the real host
from the dashboard: **Connect → Session pooler** (the URI ending in `:5432`),
then add/fix the project's line in the `case "$PROJECT_REF"` block in
`deploy-supabase.yml`. Current map:

| Project | Tier | Session pooler host |
|---|---|---|
| `fthnutnmpoymcrbvijku` | dev | `aws-1-us-west-1.pooler.supabase.com` |
| `pzulufyoqvqevjrmtmfj` | demo | `aws-0-us-west-2.pooler.supabase.com` |

**`FATAL: password authentication failed (28P01)`** — usually **not** a wrong
password. A special character (`@ : / # % ?`) in the password truncates the
inline connection URL. The workflow now URL-encodes the password, so this is
handled; if it still appears, the `SUPABASE_DB_PASSWORD` secret for that
Environment genuinely doesn't match — reset the DB password in Supabase and
paste the exact value into the GitHub Environment secret (watch for a trailing
space/newline).

> Note: `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` are read from the
> GitHub **Environment** for the branch's tier; a stale **repo-level** secret of
> the same name is a silent fallback, so delete repo-level copies once the
> Environment secrets exist.
