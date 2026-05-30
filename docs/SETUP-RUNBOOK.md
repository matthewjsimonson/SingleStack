# RUNBOOK — set up Dev + Demo (exact clicks)

Every step lists the exact page, button, field name, and value. 🧑 = you do it
in a dashboard. 🤖 = Claude does it in git. Free tier: 2 Supabase projects.

Tier map: `develop` branch → **dev** project · `main` branch → **demo** project
(the existing `pzulufyoqvqevjrmtmfj`).

Keep a notes file with these labels as you go:
```
DEV DB PASSWORD:  ____   DEV URL: ____   DEV ANON KEY: ____   DEV PROJECT REF: ____
DEMO DB PASSWORD: ____   DEMO URL: ____  DEMO ANON KEY: ____  DEMO PROJECT REF: pzulufyoqvqevjrmtmfj
ACCESS TOKEN (sbp_...): ____
```
⚠️ All DB passwords: **letters and numbers only** (no symbols).

---

## STAGE 1 — SUPABASE

### 🧑 1.1 Create the dev database
1. Open https://supabase.com/dashboard/projects
2. Click **"New project"** (top right).
3. Fill the form:
   - **Project name** → `singlestack-dev`
   - **Database Password** → letters+numbers only, 20+ chars → copy to notes as `DEV DB PASSWORD`
   - **Region** → click the dropdown → choose **"West US (Oregon)"**  *(blank region = the "db_region must be defined" error)*
   - **Organization** → leave as the existing org
4. Click **"Create new project"**. Wait ~2 min.

### 🧑 1.2 Copy 3 values (dev)
1. **DEV PROJECT REF** = the string in the browser address bar after
   `/project/` (e.g. `…/dashboard/project/abcdwxyz/…` → `abcdwxyz`). Same value
   appears in Project Settings → **General** as **Project ID / Reference ID**.
2. **DEV URL** = `https://<DEV PROJECT REF>.supabase.co` (the ref from step 1
   with `https://` prefix and `.supabase.co` suffix — this is exactly the URL the
   client library uses; there is no separate field to hunt for).
3. **DEV ANON KEY** = Project Settings → **API Keys** → the **anon / publishable**
   key.

### 🧑 1.3 Add the Anthropic key (dev)
> SAME key the demo project uses — NOT a new one. Pasted here because secrets
> don't copy between projects.
1. Gear → **"Edge Functions"** → **Secrets** section → **"Add new secret"**.
2. **Key** = `ANTHROPIC_API_KEY` · **Value** = your `sk-ant-...` key → **Save**.
   (No saved copy? Create one at https://console.anthropic.com/settings/keys and
   use that same value in 1.4 too.)

### 🧑 1.4 Get the demo project's values
1. Top-left project dropdown → open **`pzulufyoqvqevjrmtmfj`**.
2. `DEMO URL` = `https://pzulufyoqvqevjrmtmfj.supabase.co` (ref already known).
   `DEMO ANON KEY` = Project Settings → **API Keys** → **anon / publishable**.
3. Gear → **Database** → **Database password** → if unknown, **Reset database
   password** (letters+numbers) → notes `DEMO DB PASSWORD`.
4. Gear → **Edge Functions → Secrets** → confirm `ANTHROPIC_API_KEY` exists (add
   if missing, same value).

### 🧑 1.5 Create the access token
1. Open https://supabase.com/dashboard/account/tokens
2. **"Generate new token"** → Name `github-actions-deploy` → **Generate**.
3. Copy the `sbp_...` immediately → notes `ACCESS TOKEN`.

---

## STAGE 2 — GITHUB

### 🧑 2.1 Create two environments
1. Open https://github.com/matthewjsimonson/SingleStack/settings/environments
2. **"New environment"** → name `development` → **Configure environment**.
3. Back to the list → **"New environment"** → name `demo` → **Configure environment**.
(Names exactly lowercase — the deploy file matches on them.)

### 🧑 2.2 Secrets on `development` (3)
Click `development` → **Environment secrets** → **Add environment secret**, three times:
| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | `DEV PROJECT REF` |
| `SUPABASE_DB_PASSWORD` | `DEV DB PASSWORD` |
| `SUPABASE_ACCESS_TOKEN` | `ACCESS TOKEN` (sbp_...) |

### 🧑 2.3 Secrets on `demo` (3)
Click `demo` → **Add environment secret**, three times:
| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | `pzulufyoqvqevjrmtmfj` |
| `SUPABASE_DB_PASSWORD` | `DEMO DB PASSWORD` |
| `SUPABASE_ACCESS_TOKEN` | same `ACCESS TOKEN` |

### 🧑 2.4 Delete old repo-level secrets
1. Open https://github.com/matthewjsimonson/SingleStack/settings/secrets/actions
2. Under **Repository secrets**, delete `SUPABASE_DB_PASSWORD` and
   `SUPABASE_ACCESS_TOKEN` if present (trash icon).

---

## STAGE 3 — VERCEL

### 🧑 3.1 Confirm repo connection
1. https://vercel.com/dashboard → open the **SingleStack** project.
2. **Settings → Git** → confirm **Connected Git Repository** =
   `matthewjsimonson/SingleStack`.
   - No project yet? **Add New → Project** → Import `matthewjsimonson/SingleStack`
     → set **Root Directory** = `web` → **Deploy**.

### 🧑 3.2 Production branch
**Settings → Git → Production Branch** = `main` → Save.

### 🧑 3.3 Environment variables (4 total)
**Settings → Environment Variables**, add each and tick environments:
| # | Key | Value | Environments |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | `DEMO URL` | Production only |
| 2 | `NEXT_PUBLIC_SUPABASE_URL` | `DEV URL` | Preview (+Development) |
| 3 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `DEMO ANON KEY` | Production only |
| 4 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `DEV ANON KEY` | Preview (+Development) |

### 🧑 3.4 Supabase auth redirect URLs
- **demo** project → gear → **Authentication → URL Configuration**:
  - **Site URL** = your Vercel production URL (e.g. `https://singlestack.vercel.app`)
  - **Redirect URLs** → add `https://singlestack.vercel.app/**`
- **dev** project → same page:
  - **Site URL** = `http://localhost:3000`
  - **Redirect URLs** → add `http://localhost:3000/**`

---

## STAGE 4 — 🧑 → 🤖 hand back (NO secrets)
Paste in chat:
```
DEV PROJECT REF:  ____
DEV URL:          https://____.supabase.co
DEMO PROJECT REF: pzulufyoqvqevjrmtmfj
DEMO URL:         https://pzulufyoqvqevjrmtmfj.supabase.co
Region:           West US (Oregon)
[x] development env has 3 secrets
[x] demo env has 3 secrets
[x] Vercel has 4 env vars (Prod=Demo, Preview=Dev)
```

## STAGE 5 — 🤖 wire it up
1. Create `develop` branch off `main`.
2. Open PR to merge the environment structure into `main`; you merge it.

## STAGE 6 — verify (🤖 + 🧑)
- 🤖 push a test commit to `develop` → 🧑 check
  https://github.com/matthewjsimonson/SingleStack/actions : the **development**
  run is green → dev DB migrated.
- Merge `develop` → `main` → **demo** run green → demo deploy reflects it.
- ✅ dev and demo are separate databases.
