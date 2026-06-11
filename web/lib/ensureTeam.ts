import type { SupabaseClient } from "@supabase/supabase-js";
import { EXECUTIVE_TEAM } from "@/lib/team";
import { getOrgId } from "@/lib/org";

// Ensure the standard executive agent team exists for this org. The app's record
// advisors and built-in plays all assume these officers (cpo/ceng/cro/cco/cos)
// exist; without them you can attach at most the one agent you happen to have.
// Idempotent: only inserts the officers that are missing, never reactivates or
// overwrites ones the user has edited.
// deno-lint-ignore no-explicit-any
export async function ensureTeam(supabase: SupabaseClient): Promise<void> {
  const orgId = await getOrgId();
  if (!orgId) return;
  const { data: have } = await supabase.from("agents").select("key");
  const haveKeys = new Set((have ?? []).map((a: { key: string }) => a.key));
  const toAdd = EXECUTIVE_TEAM.filter((e) => !haveKeys.has(e.key)).map((e) => ({
    org_id: orgId, key: e.key, name: e.name, role: e.role,
    model: "claude-opus-4-8", system_prompt: e.system_prompt, is_active: true,
  }));
  if (toAdd.length) await supabase.from("agents").insert(toAdd);
}
