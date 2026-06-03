// Ensure the built-in plays exist as rows (with their officer attached, and
// competitor plays placed on the competitor home surface). Idempotent + cheap:
// one select, and it only writes the plays that are missing. Called from both the
// Plays surface and any surface that renders placed plays, so the built-ins are
// present no matter where the user lands first.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId } from "@/lib/org";

export const BUILTIN_PLAYS = [
  { key: "product_standing", label: "Product standing", target: "competitor", agentKey: "cpo", description: "Where our product stands versus a competitor, capability by capability." },
  { key: "build_to_beat", label: "Build-to-beat", target: "competitor", agentKey: "ceng", description: "What to build to catch up where we're behind and pull ahead where we lead." },
  { key: "narrative_angle", label: "Narrative angle", target: "competitor", agentKey: "cco", description: "How to tell our story against a competitor — amplify strengths, reframe weaknesses." },
  { key: "win_plan", label: "Win plan", target: "competitor", agentKey: "cro", description: "How to win deals against a competitor — traps, objections, proof points." },
  { key: "initiative_review", label: "Initiative review", target: "initiative", agentKey: "cpo", description: "Review an initiative as a bet — scope, sequencing, biggest risk, evidence." },
  { key: "delivery_risk", label: "Delivery risk", target: "initiative", agentKey: "ceng", description: "What could derail delivery of an initiative — risks, dependencies, de-risking." },
  { key: "gtm_readiness", label: "GTM readiness", target: "initiative", agentKey: "cro", description: "Is an initiative ready to win in-market — positioning, proof, GTM gaps." },
];

export async function ensureBuiltInPlays(supabase: SupabaseClient): Promise<boolean> {
  const { data: existing } = await supabase.from("plays").select("key");
  const have = new Set((existing ?? []).map((p) => p.key));
  const missing = BUILTIN_PLAYS.filter((b) => !have.has(b.key));
  if (missing.length === 0) return false;
  const { data: agents } = await supabase.from("agents").select("id, key").eq("is_active", true);
  if (!agents || agents.length === 0) return false;
  const orgId = await getOrgId();
  if (!orgId) return false;
  for (const b of missing) {
    const officer = agents.find((a) => a.key === b.agentKey);
    const { data: row } = await supabase.from("plays").insert({ org_id: orgId, key: b.key, label: b.label, description: b.description, agent_id: officer?.id ?? null, target_type: b.target }).select("id").maybeSingle();
    if (row && officer) await supabase.from("play_agents").insert({ org_id: orgId, play_id: row.id, agent_id: officer.id });
    if (row && b.target === "competitor") await supabase.from("play_placements").insert({ org_id: orgId, play_id: row.id, surface_key: "competitor_home" });
  }
  return true;
}
