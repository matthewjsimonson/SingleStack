# Three-tier environments — setup & runbook

SingleStack runs three **fully isolated** tiers. Same code everywhere; only the
Supabase project (data) and the env vars differ. Demo data can never reach prod.

```
            git branch     Vercel env      Supabase project        data
  ────────  ───────────    ────────────    ────────────────────    ───────────────
  Dev       develop        Development     singlestack-dev         none / throwaway
  Demo      staging        Preview         singlestack-demo        curated demo data
  Prod      main           Production      singlestack-prod        real, protected
```

**Promotion flow:** feature branch → PR into `develop` → PR `develop` → `staging`
→ PR `staging` → `main`. Each merge runs migrations against *that tier's* DB and
triggers *that tier's* Vercel deploy. Code flows forward; data never flows back.

> Decisions locked: 3 separate Supabase projects; the existing project
> `pzulufyoqvqevjrmtmfj` becomes **Demo** (it already holds the GrowthStudio
> example, which suits a demo tier); `dev` and `prod` are created fresh so prod
> is born pristine.

---

## What's already in the repo (done by code)

- `.github/workflows/deploy-supabase.yml` is **branch-aware**: it picks a GitHub
  Environment from the branch (`develop`→development, `staging`→demo,
  `main`→production) and reads that Environment's Supabase secrets. It fails
  loudly if an Environment is missing secrets (never deploys to the wrong DB).
- `web/.env.local.example` documents the per-tier Vercel variables.

## What you do in the dashboards (one-time)

### 1. Supabase — create the two new projects
1. Create **`singlestack-dev`** and **`singlestack-prod`** (keep the existing
   `pzulufyoqvqevjrmtmfj` as **demo**). Use the **same region** (us-west-2) so
   the pooler host in the workflow matches; if you pick another region, update
   `aws-0-us-west-2` in the workflow's `db push` URL.
2. For **each** project, set a **database password that is alphanumeric only**
   (the workflow puts it inline in the connection URL — no special chars).
3. In **each** project → Settings → API, copy the **Project URL** and **anon**
   key (for Vercel), and note the **project ref** (the subdomain).
4. In **each** project, add the Edge Function secret **`ANTHROPIC_API_KEY`**
   (Project → Edge Functions → Secrets) — functions are per-project.

### 2. GitHub — create three Environments with secrets
GitHub → repo → Settings → **Environments** → New environment. Create
`development`, `demo`, `production`. In **each**, add three secrets:

| Secret | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | that tier's project ref |
| `SUPABASE_DB_PASSWORD` | that tier's DB password (alphanumeric) |
| `SUPABASE_ACCESS_TOKEN` | a Supabase personal access token (account → Access Tokens) |

On **`production`**, also add a **Required reviewers** protection rule (yourself)
so a merge to `main` pauses for your approval before it touches the prod DB.

> Note: the old repo-level `SUPABASE_*` secrets can be deleted once the three
> Environments exist — the workflow now reads them from the Environment.

### 3. Vercel — one project, three environments
Vercel → Project → Settings:
- **Git**: Production Branch = `main`. (Preview deploys cover `develop`/`staging`
  and PRs automatically.)
- **Environment Variables** — set `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` **three times**, scoped per environment:
  - **Production** → `singlestack-prod` URL + anon key
  - **Preview** → `singlestack-demo` URL + anon key
  - **Development** → `singlestack-dev` URL + anon key
- For each Supabase project → Authentication → URL Configuration, add the
  matching Vercel URL(s) to Site URL + Redirect URLs so auth redirects resolve.

### 4. Create the branches (I can do this part)
From `main`: create `develop` and `staging`. After that, pushing to each runs
its tier's deploy.

---

## Daily flow

1. Branch off `develop`, build a feature, open a PR into `develop`.
2. Merge → dev DB migrates, dev Vercel deploys. Verify with throwaway data.
3. PR `develop` → `staging`. Merge → demo DB migrates, demo deploys. Load demo
   data, show people. (Demo data lives only here.)
4. PR `staging` → `main`. Approve the production gate. Merge → prod DB migrates,
   prod deploys. Real users unaffected by demo data.

## Guardrails
- **Migrations are forward-only and additive** by convention, so the same files
  apply cleanly to all three DBs regardless of which data each holds.
- **Never** run a `db push` or a manual `workflow_dispatch` against `production`
  without the same migration having succeeded on `demo` first.
- The clean-slate / demo-seeding SQL stays out of `main`'s data path: prod is
  created empty and only ever receives schema migrations.
