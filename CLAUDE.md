# SingleStack — working rules

## What it is
A product-led growth platform spanning the full loop — sense → decide → build → sell → learn — for product managers and GTM alike. The Build module is first-class: PMs use AI to produce real, working prototypes, not just documents. Marketing/GTM artifacts are one surface among several, not the product's identity.

## Branches
All work happens on `develop`. Never push to, sync, or create another branch — not `main`, not `claude/*` — unless the user says so in that message. Nothing enforces this; it is on you.

`main` is the Demo tier, not a dead branch. Promoting `develop` → `main` is a real but rare operation that needs an explicit ask.

## Deploys
Two independent surfaces. Vercel builds the web app; the `deploy-supabase` Action applies migrations **and** edge functions. A green Vercel deploy says nothing about the database — a broken migration sits red behind a green app.

`deploy-supabase` runs on every push to `develop` and `main`. There is no path filter, and each run re-applies the whole migration set. So:

- After a push touching `supabase/migrations/**` or `supabase/functions/**`, confirm the Action went green.
- A red run only still matters if no later run on that branch went green. A later green run means the migrations landed — don't repair a failure a subsequent push already cleared.

`node scripts/check-deploy.mjs [sha]` reports one commit's run but needs a token with Actions read. The ambient `GITHUB_TOKEN` in web sessions usually isn't one and returns 401 — use the GitHub MCP Actions tools instead.

## Migrations
Before altering an existing table, read its full history — every `alter table <name>` across `supabase/migrations/`, not just the `create table`. Columns, constraints, and nullability drift over time; assuming the original shape is how you ship redundant columns and contradictory constraints.
