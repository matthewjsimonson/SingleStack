# Two-tier setup — step-by-step provisioning guide (Dev + Demo)

A complete, click-by-click walkthrough to stand up **Dev** and **Demo** as two
isolated environments on the Supabase **free tier** (2 projects). Follow top to
bottom. Budget ~30 min.

> **Decisions locked**
> - 2 Supabase projects (free tier — 2 projects per org).
> - The **existing** project `pzulufyoqvqevjrmtmfj` stays as **Demo** (it already
>   holds the GrowthStudio example — fine for a demo tier).
> - You create **ONE new** project, `singlestack-dev`, for development.
> - **Production is deferred.** A 3rd tier can be added later (new project +
>   `staging` branch + `production` Environment) without reworking any of this.
>
> **What you'll end up with**
> ```
>   Tier   Git branch   Vercel env     Supabase project              Data
>   Dev    develop      Preview        singlestack-dev   (new)       throwaway
>   Demo   main         Production     pzulufyoqvqevjrmtmfj (exist)  demo data
> ```

---

## READ FIRST — how Git, GitHub, Supabase, and Vercel connect

This is the part that's easy to get wrong. Read it before clicking anything.

### There is ONE GitHub repository for everything
Both tiers live in the **single repo `matthewjsimonson/SingleStack`**. You do
**not** create a repo per environment. The tiers are **git branches**:

```
  repo: matthewjsimonson/SingleStack
    ├── branch develop   → Dev  tier
    └── branch main      → Demo tier
```

Vercel connects to this one repo and deploys each branch. The GitHub Actions
workflow in this repo runs migrations to the right Supabase project based on the
branch. Supabase projects are the **databases** — not separate code repos.

### CRITICAL: pick ONE migration-deploy mechanism, not two
Supabase migrations can be deployed two ways, and **only one may be active** or
they fight each other (double-deploys, race conditions):

- **Option 1 — GitHub Actions (what this repo uses). ✅ Chosen.**
  The `.github/workflows/deploy-supabase.yml` workflow runs the Supabase CLI and
  applies migrations to the correct project per branch, and deploys Edge
  Functions. Configured by **GitHub Environment secrets** (Part B). Nothing is
  configured on the Supabase side.

- **Option 2 — Supabase's native GitHub integration. ❌ Do NOT use.**
  A connection set up *inside the Supabase dashboard* (Project → Integrations →
  GitHub) where Supabase itself watches the repo and runs migrations. The
  existing demo project (`pzulufyoqvqevjrmtmfj`) was originally wired this way —
  that's what the `supabase/migrations/...deploy_trigger.sql` marker was a hack
  for. (That migration is now a harmless schema comment — leave it.)

**Therefore, the Git-wiring rules are:**

| Project | Connect to GitHub in the Supabase dashboard? |
|---|---|
| `singlestack-dev` (new) | **No.** Never connect it. |
| `pzulufyoqvqevjrmtmfj` (demo, existing) | **Disconnect** it — see Part A0 below. |

So, directly: **you do NOT connect any Supabase project to Git.** Supabase
deploys are driven entirely by the GitHub Actions workflow using the access
token + project refs you put in GitHub Environment secrets. The only
Supabase↔GitHub link you touch is **removing** the old one on the demo project.

### Who connects to GitHub, and how
| System | Connects to the repo? | How |
|---|---|---|
| **Vercel** | **Yes** — one Git connection | Vercel dashboard → Import/Link the `matthewjsimonson/SingleStack` repo (Part C0). Deploys branches automatically. |
| **GitHub Actions** | It *is* in the repo | Runs on push; reaches Supabase via the access token + refs in Environment secrets. |
| **Supabase** | **No** | Never connect a project to GitHub. It's a passive database the Actions workflow pushes to. |

---

You'll keep a scratchpad of values as you go. Here's the template — fill it in:

```
DEV   project ref: __________  url: https://______.supabase.co  anon key: eyJ...
DEMO  project ref: pzulufyoqvqevjrmtmfj  url: https://pzulufyoqvqevjrmtmfj.supabase.co  anon key: eyJ...

DEV   db password (alphanumeric): __________
DEMO  db password (already set):  __________   (Supabase → Demo project → Settings → Database, reset if unknown)

Supabase ACCESS TOKEN (one, account-level): sbp_______________
```

> ⚠️ **Passwords must be alphanumeric only** (letters + numbers, no symbols). The
> deploy workflow puts the password inline in a connection URL, so symbols like
> `@ : / #` would break it. Use a long random alphanumeric string (20+ chars).

---

## PART A — Supabase: create the ONE new project

### A0. FIRST — disconnect the demo project's native GitHub integration
The existing project was wired to deploy via Supabase's own GitHub integration.
Leaving it on would make it fight the GitHub Actions workflow. Turn it off:
1. Open the **`pzulufyoqvqevjrmtmfj`** (demo) project in the Supabase dashboard.
2. **Settings → Integrations** (some dashboards: **Project Settings → GitHub**).
3. If a GitHub repo connection is shown, click **Disconnect / Remove**.
   - If you don't see one, it may already be off — fine, nothing to do.
4. Do **not** reconnect it, and do **not** connect the new dev project. From
   here, all migrations flow only through GitHub Actions.

### A1. Create `singlestack-dev`
1. Go to **https://supabase.com/dashboard** → click **New project**.
2. **Organization**: your existing org (the one that owns the demo project).
3. **Name**: `singlestack-dev`
4. **Database Password**: **Generate a password**, then **edit it to be
   alphanumeric only** (remove symbols) — or paste your own 20+ char alphanumeric
   string. **Copy it into your scratchpad** (`DEV db password`).
5. **Region**: **West US (Oregon)** — this is `us-west-2`, which the deploy
   workflow's connection URL expects. (Different region → tell me, I'll update
   the workflow's pooler host.)
   - ⚠️ You MUST pick a region explicitly — leaving it blank is what caused the
     "Either db_region or region_selection must be defined" error.
6. Click **Create new project**. Wait ~2 min. (This is your 2nd project, which is
   exactly the free-tier limit — fine.)

### A2. Grab the DEV keys
1. Open the new `singlestack-dev` project → **Settings** (gear) → **API**.
2. Copy into your scratchpad:
   - **Project URL** → `DEV url` (`https://abcd….supabase.co`)
   - **Project API keys → `anon` `public`** → `DEV anon key` (the long `eyJ…`)
3. The **project ref** is the URL subdomain (the `abcd…`) — also **Settings →
   General → Reference ID**. Copy → `DEV project ref`.

### A3. Add the Edge Function secret to DEV
1. Same project → **Edge Functions** (or **Settings → Edge Functions → Secrets**)
   → **Secrets / Manage secrets**.
2. Add: **Name** `ANTHROPIC_API_KEY`, **Value** = your Anthropic API key.
   (Edge Function secrets are per-project, so dev needs its own.)

### A4. Confirm the DEMO project's values
- Open the existing `pzulufyoqvqevjrmtmfj` project → Settings → API. Copy its
  current URL + anon key to the scratchpad. If you don't know its **DB
  password**, Settings → **Database** → **Reset database password** (set an
  **alphanumeric** one) and copy it.
- Make sure it has the `ANTHROPIC_API_KEY` Edge Function secret (it should).

### A5. Create ONE Supabase access token (account-level)
1. **https://supabase.com/dashboard/account/tokens** → **Generate new token**.
2. Name it `github-actions-deploy`. **Copy the `sbp_…` value now** (shown once)
   → scratchpad. One token works for both projects (it's tied to your account).

---

## PART B — GitHub: two Environments with secrets

This is what makes the deploy workflow target the right database per branch.

### B1. Create the Environments
1. GitHub → repo **matthewjsimonson/SingleStack** → **Settings** → left sidebar
   **Environments** → **New environment**.
2. Create two, named **exactly** (lowercase): `development` and `demo`. (The
   workflow maps branch→environment by these names: `develop`→`development`,
   `main`→`demo`.)

### B2. Add secrets to each Environment
For **each** environment, open it → **Environment secrets** → **Add environment
secret** → add these three:

| Secret name | `development` | `demo` |
|---|---|---|
| `SUPABASE_PROJECT_REF` | DEV ref | `pzulufyoqvqevjrmtmfj` |
| `SUPABASE_DB_PASSWORD` | DEV db password | DEMO db password |
| `SUPABASE_ACCESS_TOKEN` | the `sbp_…` token | same `sbp_…` token |

(Names must match exactly — case-sensitive.)

### B3. Remove the old repo-level secrets (after B2)
- Settings → **Secrets and variables → Actions** → if `SUPABASE_DB_PASSWORD` /
  `SUPABASE_ACCESS_TOKEN` exist at the **repository** level from the old
  single-tier setup, delete them. The workflow now reads from Environments;
  removing the repo-level ones prevents ambiguity.

> No production approval gate yet — there's no prod tier. When you add prod
> later, that's when the Required-reviewers rule goes on the `production`
> Environment.

---

## PART C — Vercel: one project, two scopes

### C0. Connect Vercel to the repo (if not already)
1. Vercel → your **SingleStack** project → **Settings → Git**.
2. Confirm **Connected Git Repository** = `matthewjsimonson/SingleStack`.
   - If no project exists: Vercel → **Add New → Project** → **Import**
     `matthewjsimonson/SingleStack` → **Root Directory = `web`** (the Next.js app
     is in `web/`, not the repo root) → Deploy.
   - If it points at a different/old repo, relink it here.
3. Framework preset: **Next.js** (auto-detected). Root Directory must be `web`.

> Vercel is the ONLY tool you connect to GitHub. It creates a Production deploy
> for `main` and Preview deploys for `develop` + PRs.

### C1. Production branch
1. **Settings → Git** → **Production Branch** = `main`. Save. (`develop` + PRs
   become Preview deploys automatically.)

### C2. Environment variables
1. **Settings → Environment Variables.**
2. Add **two** variables, each **twice**, scoped per environment (4 saves total).
   When adding, Vercel lets you tick which environments it applies to:

   | Variable | Production (= Demo data) | Preview (= Dev data) |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | DEMO url | DEV url |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | DEMO anon key | DEV anon key |

   Concretely: add `NEXT_PUBLIC_SUPABASE_URL` = DEMO url, tick **Production**,
   Save. Again = DEV url, tick **Preview** (and Development if offered), Save.
   Repeat for the anon key.
3. **Redeploy** so the vars take effect (Deployments → ⋯ → Redeploy), or it
   applies on the next push.

### C3. Supabase auth redirect URLs
For **each** Supabase project, point its auth at the matching Vercel URL so
sign-in redirects resolve:
1. Supabase project → **Authentication → URL Configuration**.
2. **Site URL** + **Redirect URLs**: add that tier's Vercel URL.
   - DEMO project → your Production Vercel URL (the `…vercel.app` prod URL and/or
     a custom domain).
   - DEV project → `http://localhost:3000` (local dev) and the `develop` Preview
     URL (e.g. `https://singlestack-git-develop-….vercel.app`).

---

## PART D — Hand back to me

When Parts A–C are done, **paste me (in chat) only the non-secret identifiers**:

```
DEV  project ref + url
DEMO project ref + url   (pzulufyoqvqevjrmtmfj)
Region used (should be us-west-2 / West US (Oregon))
Confirm: GitHub Environments development + demo each have all 3 secrets ✅
Confirm: Vercel has the 2 vars scoped Production=Demo, Preview=Dev ✅
Confirm: demo project's native Supabase GitHub integration is disconnected ✅
```

> Do **not** paste DB passwords, anon keys, or the access token into chat — those
> live only in the dashboards. I only need the refs/urls to sanity-check wiring.

Then I will:
1. Create the `develop` branch off `main`.
2. Open the PR to merge this environment structure into `main`.
3. Walk you through verifying each tier's first deploy goes green.

---

## Quick verification (after I create the branch)

- Push a trivial commit to `develop` → GitHub Actions runs the **development**
  job → migrations land on `singlestack-dev` → the dev Preview shows an empty
  Foundation (0% filled). ✅ isolation proven (demo untouched).
- Merge `develop`→`main` → **demo** job → `pzulufyoqvqevjrmtmfj`. The demo
  deploy reflects the change.

## Troubleshooting
- **"Either db_region or region_selection must be defined"** → you didn't pick a
  Region on the New Project form. Select **West US (Oregon)** and retry.
- **Workflow fails at "Guard — required secrets present"** → that Environment is
  missing one of the three secrets, or a name is misspelled. Re-check B2.
- **`db push` auth error** → DB password has a non-alphanumeric char, or the
  project ref is wrong for that environment.
- **Wrong region** → the workflow URL says `aws-0-us-west-2`. If a project is in
  another region, tell me its pooler host (Supabase → Settings → Database →
  Connection pooling) and I'll branch the URL per tier.
- **Auth redirect loops / "invalid redirect"** → add the exact Vercel URL to that
  Supabase project's Authentication → URL Configuration (Part C3).
- **Free-tier "project limit reached"** → you already have 2 projects. This setup
  needs exactly 2 (dev + the existing demo), so you shouldn't hit it; if you do,
  you may have an extra old project to pause/delete.
