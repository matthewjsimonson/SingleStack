# Three-tier setup — step-by-step provisioning guide

A complete, click-by-click walkthrough to stand up **Dev / Demo / Production**
as three fully isolated environments. Follow top to bottom. Budget ~45–60 min.

> **Decisions already locked**
> - 3 **separate** Supabase projects (true isolation).
> - The **existing** project `pzulufyoqvqevjrmtmfj` becomes **Demo** (it already
>   holds the GrowthStudio example — fine for a demo tier).
> - `singlestack-dev` and `singlestack-prod` are created **fresh**, so prod is
>   born pristine.
>
> **What you'll end up with**
> ```
>   Tier   Git branch   Vercel env     Supabase project              Data
>   Dev    develop      Development    singlestack-dev   (new)       throwaway
>   Demo   staging      Preview        pzulufyoqvqevjrmtmfj (exist)  demo data
>   Prod   main         Production     singlestack-prod  (new)       real
> ```

---

## READ FIRST — how Git, GitHub, Supabase, and Vercel connect

This is the part that's easy to get wrong. Read it before clicking anything.

### There is ONE GitHub repository for everything
All three tiers live in the **single repo `matthewjsimonson/SingleStack`**. You
do **not** create a repo per environment. The tiers are **git branches** in this
one repo:

```
  repo: matthewjsimonson/SingleStack
    ├── branch develop   → Dev   tier
    ├── branch staging   → Demo  tier
    └── branch main      → Prod  tier
```

Vercel connects to this one repo and deploys each branch to its environment.
The GitHub Actions workflow in this repo runs migrations to the right Supabase
project based on the branch. Supabase projects are the **databases** — they are
not separate code repos.

### CRITICAL: pick ONE migration-deploy mechanism, not two
Supabase migrations can be deployed two different ways, and **only one may be
active** or they fight each other (double-deploys, race conditions):

- **Option 1 — GitHub Actions (what this repo uses). ✅ Chosen.**
  The `.github/workflows/deploy-supabase.yml` workflow runs the Supabase CLI and
  applies migrations to the correct project per branch, with a production
  approval gate and Edge Function deploys. Configured by **GitHub Environment
  secrets** (Part B). Nothing is configured on the Supabase side.

- **Option 2 — Supabase's native GitHub integration. ❌ Do NOT use.**
  A connection set up *inside the Supabase dashboard* (Project → Integrations →
  GitHub) where Supabase itself watches the repo and runs migrations. It has no
  production approval gate and doesn't deploy our Edge Functions. The existing
  demo project (`pzulufyoqvqevjrmtmfj`) was originally wired this way — that's
  what the `supabase/migrations/...deploy_trigger.sql` marker was a hack for.
  (That migration is now just a harmless schema comment — it applies cleanly to
  all three projects and needs no action. Leave it.)

**Therefore, the Git-wiring rules are:**

| Project | Connect to GitHub in the Supabase dashboard? |
|---|---|
| `singlestack-dev` (new) | **No.** Never connect it. |
| `singlestack-prod` (new) | **No.** Never connect it. |
| `pzulufyoqvqevjrmtmfj` (demo, existing) | **Disconnect** it — see Part A0 below. |

So to answer the question directly: **you do NOT connect your new Supabase
projects to Git.** Supabase deploys are driven entirely by the GitHub Actions
workflow using the access token + project refs you put in GitHub Environment
secrets. The only Supabase↔GitHub link you touch is **removing** the old one on
the demo project.

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
PROD  project ref: __________  url: https://______.supabase.co  anon key: eyJ...

DEV   db password (alphanumeric): __________
PROD  db password (alphanumeric): __________
DEMO  db password (already set):  __________   (Supabase → Demo project → Settings → Database, reset if unknown)

Supabase ACCESS TOKEN (one, account-level): sbp_______________
```

> ⚠️ **Passwords must be alphanumeric only** (letters + numbers, no symbols). The
> deploy workflow puts the password inline in a connection URL, so symbols like
> `@ : / #` would break it. Use a long random alphanumeric string (20+ chars).

---

## PART A — Supabase: create the two new projects

### A0. FIRST — disconnect the demo project's native GitHub integration
The existing project was wired to deploy via Supabase's own GitHub integration.
Leaving it on would make it fight the GitHub Actions workflow. Turn it off:
1. Open the **`pzulufyoqvqevjrmtmfj`** (demo) project in the Supabase dashboard.
2. **Settings → Integrations** (some dashboards: **Project Settings → GitHub**).
3. If a GitHub repo connection is shown, click **Disconnect / Remove**.
   - If you don't see one, it may already be off (or was using "Database
     Migrations via GitHub Actions" already) — fine, nothing to do.
4. Do **not** reconnect it, and do **not** connect the new dev/prod projects.
   From here, all migrations flow only through GitHub Actions.

> Why: see "pick ONE migration-deploy mechanism" above. Two active deployers =
> double-runs and races.

### A1. Create `singlestack-dev`
1. Go to **https://supabase.com/dashboard** → click **New project**.
2. **Organization**: pick your existing org (same one that owns the demo project).
3. **Name**: `singlestack-dev`
4. **Database Password**: click **Generate a password**, then **edit it to be
   alphanumeric only** (remove any symbols) — or paste your own 20+ char
   alphanumeric string. **Copy it into your scratchpad** (`DEV db password`).
5. **Region**: **West US (Oregon)** — this is `us-west-2`, which the deploy
   workflow's connection URL expects. (If you must use another region, tell me
   and I'll update the workflow's pooler host.)
6. **Plan**: see the note on plans at the end of Part A.
7. Click **Create new project**. Wait ~2 min for it to provision.

### A2. Grab the DEV keys
1. Open the new `singlestack-dev` project.
2. Left sidebar → **Settings** (gear) → **API**.
3. Copy these into your scratchpad:
   - **Project URL** → `DEV url` (looks like `https://abcd….supabase.co`)
   - **Project API keys → `anon` `public`** → `DEV anon key` (the long `eyJ…`)
4. The **project ref** is the subdomain of the URL (the `abcd…` part) — also
   shown in **Settings → General → Reference ID**. Copy → `DEV project ref`.

### A3. Add the Edge Function secret to DEV
1. Same project → **Edge Functions** (or **Settings → Edge Functions → Secrets**,
   depending on dashboard version) → **Secrets / Manage secrets**.
2. Add: **Name** `ANTHROPIC_API_KEY`, **Value** = your Anthropic API key.
   (Edge Function secrets are per-project, so every tier needs its own.)

### A4. Repeat A1–A3 for `singlestack-prod`
- Name `singlestack-prod`, **same region (West US / us-west-2)**, a **separate**
  alphanumeric password. Copy `PROD url`, `PROD anon key`, `PROD project ref`,
  `PROD db password`. Add `ANTHROPIC_API_KEY` to it too.

### A5. Confirm the DEMO project's values
- Open the existing `pzulufyoqvqevjrmtmfj` project → Settings → API. Its URL/anon
  key are already in `web/.env.local.example` history; copy current values to the
  scratchpad. If you don't know its **DB password**, Settings → **Database** →
  **Reset database password** (set an **alphanumeric** one) and copy it.
- Make sure it also has the `ANTHROPIC_API_KEY` Edge Function secret (it should,
  from earlier).

### A6. Create ONE Supabase access token (account-level)
1. **https://supabase.com/dashboard/account/tokens** → **Generate new token**.
2. Name it `github-actions-deploy`. **Copy the `sbp_…` value now** (shown once).
   → scratchpad `Supabase ACCESS TOKEN`. One token works for all three projects
   (it's tied to your account, which owns all three).

> **Plans note:** Supabase's free tier allows **2 active projects** per org. You
> now want **3**. Options: (a) upgrade the org to **Pro** (~$25/mo, covers many
> projects) — simplest; (b) put one project in a **second free org** (each free
> org gets its own 2-project allowance) — free but split across orgs (the single
> access token must belong to an account that's a member of both orgs; simplest
> is to keep all three in one org on Pro). Recommended: **Pro on one org.**

---

## PART B — GitHub: three Environments with secrets

This is what makes the deploy workflow target the right database per branch.

### B1. Create the Environments
1. GitHub → your repo **matthewjsimonson/SingleStack** → **Settings** (top tab) →
   left sidebar **Environments** → **New environment**.
2. Create three, named **exactly** (lowercase): `development`, `demo`,
   `production`. (The workflow maps branch→environment by these names.)

### B2. Add secrets to each Environment
For **each** environment, open it and under **Environment secrets** →
**Add environment secret**, add these three:

| Secret name | `development` | `demo` | `production` |
|---|---|---|---|
| `SUPABASE_PROJECT_REF` | DEV ref | `pzulufyoqvqevjrmtmfj` | PROD ref |
| `SUPABASE_DB_PASSWORD` | DEV db password | DEMO db password | PROD db password |
| `SUPABASE_ACCESS_TOKEN` | the `sbp_…` token | same `sbp_…` token | same `sbp_…` token |

(Names must match exactly — they're case-sensitive.)

### B3. Add a production approval gate
1. Open the **`production`** environment.
2. **Deployment protection rules** → check **Required reviewers** → add
   **yourself** → **Save protection rules**.
3. Now any deploy to prod (a push to `main`) **pauses** until you click
   **Approve** in the Actions run. Demo can't accidentally flow to prod.

### B4. Remove the old repo-level secrets (after B2)
- Settings → **Secrets and variables → Actions** → if `SUPABASE_DB_PASSWORD` /
  `SUPABASE_ACCESS_TOKEN` exist at the **repository** level from the old
  single-tier setup, delete them. The workflow now reads from Environments, and
  removing the repo-level ones prevents ambiguity. (Leaving them does no harm,
  but cleaner to remove.)

---

## PART C — Vercel: one project, three environments

Vercel keeps one project; you scope the Supabase keys per environment.

### C0. Connect Vercel to the repo (if not already)
1. Vercel → your **SingleStack** project → **Settings → Git**.
2. Confirm **Connected Git Repository** = `matthewjsimonson/SingleStack`.
   - If no project exists yet: Vercel dashboard → **Add New → Project** →
     **Import** `matthewjsimonson/SingleStack` → **Root Directory = `web`**
     (the Next.js app lives in `web/`, not the repo root) → Deploy.
   - If a project exists but points at a different/old repo, relink it here.
3. Framework preset: **Next.js** (auto-detected). Root Directory must be `web`.

> Vercel is the ONLY tool you connect to GitHub. It watches the repo and creates
> a Production deploy for `main`, and Preview deploys for `develop`, `staging`,
> and PRs.

### C1. Production branch
1. Vercel → your **SingleStack** project → **Settings → Git**.
2. **Production Branch** = `main`. Save. (Pushes to other branches and PRs become
   Preview deploys automatically.)

### C2. Environment variables (the important part)
1. **Settings → Environment Variables.**
2. You'll add **two** variables, but **three times each**, scoped to the right
   environment. When adding a variable, Vercel lets you tick which environments
   it applies to (Production / Preview / Development) — add them **one
   environment at a time** so each points at a different Supabase project:

   | Variable | Production | Preview | Development |
   |---|---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | PROD url | DEMO url | DEV url |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PROD anon key | DEMO anon key | DEV anon key |

   Concretely: add `NEXT_PUBLIC_SUPABASE_URL` = PROD url, tick **Production only**,
   Save. Add it again = DEMO url, tick **Preview only**, Save. Again = DEV url,
   tick **Development only**, Save. Repeat for the anon key. (6 saves total.)

3. **Redeploy** so the new vars take effect (Deployments → ⋯ on the latest →
   Redeploy), or it'll apply on the next push.

### C3. Supabase auth redirect URLs
For **each** Supabase project, point its auth at the matching Vercel URL so
sign-in redirects resolve:
1. Supabase project → **Authentication → URL Configuration**.
2. **Site URL** + **Redirect URLs**: add that tier's Vercel URL.
   - PROD project → your production domain (e.g. `https://app.yoursite.com` and/or
     the `…vercel.app` production URL).
   - DEMO project → the Preview URL you'll use to demo (the branch alias, e.g.
     `https://singlestack-git-staging-….vercel.app`).
   - DEV project → `http://localhost:3000` (local dev) and the dev Preview URL.

---

## PART D — Hand back to me

When Parts A–C are done, **paste me (in chat) only the non-secret identifiers**:

```
DEV  project ref + url
DEMO project ref + url   (pzulufyoqvqevjrmtmfj)
PROD project ref + url
Region used (should be us-west-2 / West US (Oregon))
Confirm: GitHub Environments development/demo/production each have all 3 secrets ✅
Confirm: production has a Required reviewers rule ✅
Confirm: Vercel has the 3-scoped env vars ✅
```

> Do **not** paste DB passwords, anon keys, or the access token into chat — those
> live only in the dashboards. I only need the refs/urls to sanity-check the
> wiring against the workflow.

Then I will:
1. Create `develop` and `staging` branches off `main`.
2. Open the PR to merge the three-tier structure into `main`.
3. Walk you through verifying each tier's first deploy goes green (GitHub Actions
   per environment + a Vercel deploy per tier).

---

## Quick verification (after I create the branches)

- Push a trivial commit to `develop` → GitHub Actions runs the **development**
  environment job → migrations land on `singlestack-dev` → the dev Preview shows
  an empty Foundation (0% filled). ✅ isolation proven (prod untouched).
- Merge `develop`→`staging` → **demo** job → `singlestack-demo`. Load demo data.
- Merge `staging`→`main` → **production** job **pauses for your approval** → on
  approve, migrates `singlestack-prod`. ✅ gate works.

## Troubleshooting
- **Workflow fails at "Guard — required secrets present"** → that Environment is
  missing one of the three secrets, or a name is misspelled. Re-check B2.
- **`db push` auth error** → DB password has a non-alphanumeric char, or the
  project ref is wrong for that environment.
- **Wrong region** → the workflow URL says `aws-0-us-west-2`. If a project is in
  another region, tell me its pooler host (Supabase → Settings → Database →
  Connection pooling) and I'll branch the URL per tier.
- **Auth redirect loops / "invalid redirect"** → add the exact Vercel URL to that
  Supabase project's Authentication → URL Configuration (Part C3).
