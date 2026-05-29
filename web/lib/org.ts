"use client";

// Resolves the caller's org_id via the existing current_org_id() DB function
// (exposed as an RPC). Inserts include this org_id; RLS independently enforces
// it, so this is convenience, not a trust boundary.
import { createClient } from "@/lib/supabase/client";

export async function getOrgId(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) return null;
  return (data as string | null) ?? null;
}
