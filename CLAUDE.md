
## Branch rule (non-negotiable)
ALL work happens on `develop` only. Never push to, sync, or create any other branch (not main, not claude/*) unless the user explicitly says so in that message. Enforced by .git/hooks/pre-push.

## Deploys & schema (definition of done)
The two deploy surfaces are independent: **Vercel** builds the web app; the **`deploy-supabase`** GitHub Action applies **migrations AND edge functions**. A green Vercel deploy says *nothing* about the database — a broken migration can sit silently red behind a green app.
- After any push touching `supabase/migrations/**` or `supabase/functions/**`, confirm the `deploy-supabase` Action is **green for that exact commit** before calling the work done. `node scripts/check-deploy.mjs [sha]` reports it (needs `GITHUB_TOKEN`).
- **Before altering an existing table, read its FULL migration history** — every `alter table <name>` across `supabase/migrations/`, not just its create migration. Columns, constraints, and nullability drift over time; assuming the original shape is how you ship redundant columns and contradictory constraints.
