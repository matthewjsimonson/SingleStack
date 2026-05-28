# SingleStack — Foundation database

This folder is the Supabase (Postgres) backend for the **Foundation** data model:
the Product Record and GTM Record, plus everything that hangs off them.

## What's here

- `migrations/` — the schema, as ordered SQL files. These define the tables and
  run on every deploy. **They contain no data.**
- `seed.sql` — one example org and a complete worked example (a product, a GTM
  branch, a signal, a ratification, etc.). Runs **only** locally, never in
  production.
- `config.toml` — local settings for the Supabase CLI.

## Run it locally

You need [Docker](https://www.docker.com/) and the
[Supabase CLI](https://supabase.com/docs/guides/cli) installed. Then, from the
repo root:

```bash
supabase start      # boots Postgres + Auth + Studio (first run pulls images)
supabase db reset   # applies every migration, then runs seed.sql
```

When it finishes, open the local dashboard it prints (Studio, at
http://127.0.0.1:54323) to browse the tables and the seeded example.

## How the pieces fit

- **Product Record** is the hub. Modules → product; features → module.
- **GTM Records** (messaging branches) read from the product; each has tabs and
  signals. Signals link to **sources** many-to-many.
- A record's content (what-it-is, positioning, …) lives as rows in
  **record_fields**, so you can add any field with no schema change.
- Every content field's **ratification** trail is its own table.
- **Statuses** are a client-editable list, not hardcoded.
- Every table is fenced by **Row-Level Security** to one org. New signups
  auto-join the single org, so access "just works" while there's one tenant.

## Trying it

After `supabase db reset`, sign up a test user in Studio's Auth section — the
`on_auth_user_created` trigger adds them to the org automatically, and they'll
see the seeded example. Delete the example rows when you're ready to hand-enter
your own.
