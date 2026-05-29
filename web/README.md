# SingleStack — web app

Next.js (App Router) frontend for SingleStack. Reuses the v1 prototype's design
system (cream canvas, Inter/Fraunces, blue + Lyra accents — see
`app/globals.css`) and wires it to the live Supabase backend.

## The core loop (what's built)

```
login → records list → open a record → see its fields
   → Run agent ▸ (calls the agent-propose Edge Function)
   → proposal appears → Accept (calls the accept_proposal RPC)
   → the change is applied to the record + ratified
```

Everything runs as the **logged-in user** (their Supabase session/JWT), so
Row-Level Security scopes all reads and writes to their org automatically. The
app uses only the **public anon key** — never the service_role key.

## Local development

1. `cd web && npm install`
2. Copy env vars: `cp .env.local.example .env.local`, then fill in
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Supabase → Settings → API (the **anon /
   public** key, the `eyJ…` one — *not* service_role).
3. `npm run dev` → http://localhost:3000
4. Sign up / sign in. New signups auto-join the single org via the
   `on_auth_user_created` DB trigger.

## Deploy (Vercel)

- Root directory: `web`
- Framework preset: Next.js (auto-detected)
- Environment variables (Production + Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- After deploy, add the Vercel URL to Supabase → Authentication → URL
  Configuration (Site URL + redirect URLs) so auth redirects resolve.

## Structure

| Path | What |
|------|------|
| `app/login/page.tsx` | Email/password auth (sign in + sign up) |
| `app/page.tsx` | Records list (server component, RLS-scoped) |
| `app/records/[id]/page.tsx` | Record detail loader (server) |
| `app/records/[id]/RecordView.tsx` | Fields, Run agent, proposals + Accept (client) |
| `components/Shell.tsx` | Sidebar + topbar frame |
| `lib/supabase/*` | Browser + server Supabase clients |
| `middleware.ts` | Session refresh + auth gate |
| `app/globals.css` | Design tokens ported from the prototype |
