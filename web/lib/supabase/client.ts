// Browser-side Supabase client. Holds the logged-in user's session, so every
// query runs as that user — RLS scopes all reads/writes to their org. Uses the
// PUBLIC anon key (safe to ship to the browser); never the service_role key.
//
// Falls back to empty strings if the env vars are somehow absent so that
// importing this module never throws during a build/prerender; a real misconfig
// surfaces as a failed request at runtime (visible, not a build crash).
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Placeholder fallbacks keep createBrowserClient from throwing at build/
  // prerender when env vars are absent; real values are inlined by Next when
  // present (i.e. when Vercel has them set), so the browser uses those.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
  );
}
