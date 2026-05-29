// Browser-side Supabase client. Holds the logged-in user's session, so every
// query runs as that user — RLS scopes all reads/writes to their org. Uses the
// PUBLIC anon key (safe to ship to the browser); never the service_role key.
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
