// Ensure the built-in plays exist as rows (with their officer attached, and
// competitor plays placed on the competitor home surface). Idempotent + cheap:
// one select, and it only writes the plays that are missing. Called from both the
// Plays surface and any surface that renders placed plays, so the built-ins are
// present no matter where the user lands first.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId } from "@/lib/org";

type BuiltinPlay = {
  key: string; label: string; target: string; agentKey: string; description: string;
  chain?: string[]; // multi-agent plays run as a chain, in order (defaults to [agentKey])
  playSkills?: { agentKey: string; name: string; instructions: string }[]; // bespoke child skills per agent
};

export const BUILTIN_PLAYS: BuiltinPlay[] = [
  { key: "product_standing", label: "Product standing", target: "competitor", agentKey: "cpo", description: "Where our product stands versus a competitor, capability by capability." },
  { key: "build_to_beat", label: "Build-to-beat", target: "competitor", agentKey: "ceng", description: "What to build to catch up where we're behind and pull ahead where we lead." },
  { key: "narrative_angle", label: "Narrative angle", target: "competitor", agentKey: "cco", description: "How to tell our story against a competitor — amplify strengths, reframe weaknesses." },
  { key: "win_plan", label: "Win plan", target: "competitor", agentKey: "cro", description: "How to win deals against a competitor — traps, objections, proof points." },
  { key: "initiative_review", label: "Initiative review", target: "initiative", agentKey: "cpo", description: "Review an initiative as a bet — scope, sequencing, biggest risk, evidence." },
  { key: "delivery_risk", label: "Delivery risk", target: "initiative", agentKey: "ceng", description: "What could derail delivery of an initiative — risks, dependencies, de-risking." },
  { key: "gtm_readiness", label: "GTM readiness", target: "initiative", agentKey: "cro", description: "Is an initiative ready to win in-market — positioning, proof, GTM gaps." },

  // The whole exec team runs as a chain on one competitor — each adds its lens on
  // top of the prior, with a bespoke play skill (child skill) authored for THIS play.
  {
    key: "competitive_takedown", label: "Competitive takedown", target: "competitor", agentKey: "cpo",
    description: "The full team takes one competitor apart end-to-end: standing → build-to-beat → narrative wedge → win plan, in one chained run.",
    chain: ["cpo", "ceng", "cco", "cro"],
    playSkills: [
      { agentKey: "cpo", name: "Standing read", instructions: "Assess where our product stands versus this competitor, capability by capability — where we clearly win, where we're at parity, and where we lose. Be honest (don't flatter us); ground each call in the capability matrix, the battlecard, and signals. Hand the gaps you find to engineering." },
      { agentKey: "ceng", name: "Build-to-beat", instructions: "Take the gaps the CPO surfaced and decide what to BUILD to catch up where we're behind and pull further ahead where we lead. For each move note rough effort (S/M/L) and the leverage or technical risk. Buildable and concrete, not aspirational." },
      { agentKey: "cco", name: "Narrative wedge", instructions: "Given our standing and the build plan, find the narrative wedge against this competitor: strengths to amplify, weaknesses to honestly reframe, and the story arc that turns the category our way. Concrete and human — no hype." },
      { agentKey: "cro", name: "Win plan", instructions: "Turn all of the above into how a rep WINS deals against this competitor: where we win, traps to set early, how to handle their strongest objections, and the proof points that close. Make it usable on a live deal." },
    ],
  },
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
  const idOf = (k: string) => agents.find((a) => a.key === k)?.id as string | undefined;
  for (const b of missing) {
    const { data: row } = await supabase.from("plays").insert({ org_id: orgId, key: b.key, label: b.label, description: b.description, agent_id: idOf(b.agentKey) ?? null, target_type: b.target }).select("id").maybeSingle();
    if (!row) continue;
    // The agent chain (positioned), defaulting to the single officer.
    const chainKeys = b.chain ?? [b.agentKey];
    const playAgents = chainKeys.flatMap((k, i) => { const id = idOf(k); return id ? [{ org_id: orgId, play_id: row.id, agent_id: id, position: i }] : []; });
    if (playAgents.length) await supabase.from("play_agents").insert(playAgents);
    // Bespoke child skills authored for this play, per agent.
    if (b.playSkills?.length) {
      const ps = b.playSkills.flatMap((s) => { const id = idOf(s.agentKey); return id ? [{ org_id: orgId, play_id: row.id, agent_id: id, name: s.name, instructions: s.instructions }] : []; });
      if (ps.length) await supabase.from("play_skills").insert(ps);
    }
    if (b.target === "competitor") await supabase.from("play_placements").insert({ org_id: orgId, play_id: row.id, surface_key: "competitor_home" });
  }
  return true;
}
