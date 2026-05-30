## Promote `develop` → `main` (deploys to the **demo** project)

Merging this applies migrations to the demo Supabase project
(`pzulufyoqvqevjrmtmfj`) and builds the demo production site on Vercel. This PR
is opened/updated automatically whenever `develop` is ahead of `main`; merge it
when the batch on `develop` is demo-ready.

### Before merging
- [ ] Verified on the **dev** Vercel Preview (against throwaway data).
- [ ] New migrations are **schema-only and additive** — no destructive or
      data-mutating SQL. (Migrations run **once** and permanently; a data
      migration will alter demo content forever.)
- [ ] No migration drops or rewrites a table/column the demo relies on.
- [ ] Any intentional demo-data change is deliberate and reviewed.
- [ ] If env vars/secrets changed, they're updated in **both** the `demo` GitHub
      Environment and Vercel **Production**.

### After merging
- [ ] The **Deploy to Supabase** run on `main` is green.
- [ ] The demo site reflects the change.
