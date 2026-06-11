// Stand up the full competitive agent chain — shared by the setup wizard and
// the in-module buttons so it's one ratified click from ANYWHERE:
//   cornerstone-carrying agent (prefers the CRO) ← three play skills from the
//   canonical templates (evidence analyst / messenger / evidence scoring) ←
//   two workflows with skill_ids wired (battlecard pair + matrix scoring).
// HITL framing: these agents only ever PROPOSE; the human ratifies.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId } from "@/lib/org";
import { SKILL_DEFS } from "@/lib/skills.generated";

export async function standUpCompetitiveAgents(supabase: SupabaseClient): Promise<{ ok: boolean; message: string }> {
  const orgId = await getOrgId();
  if (!orgId) return { ok: false, message: "Could not resolve your organization." };
  const { data: agents } = await supabase.from("agents").select("id, key, name").eq("is_active", true).order("created_at");
  const agent = (agents ?? []).find((a) => a.key === "cro") ?? (agents ?? [])[0];
  if (!agent) return { ok: false, message: "No active agent yet — create one on the Agents page first." };

  const KEYS = ["competitive_evidence_analyst", "competitive_messenger", "capability_evidence_scoring"];
  const skillId: Record<string, string> = {};
  for (const key of KEYS) {
    const def = SKILL_DEFS.find((d) => d.key === key); if (!def) continue;
    const { data: ex } = await supabase.from("skills").select("id").eq("key", key).maybeSingle();
    if (ex?.id) skillId[key] = ex.id;
    else {
      const { data: created, error } = await supabase.from("skills").insert({
        org_id: orgId, key, name: def.name, description: def.description, category: def.category,
        instructions: def.instructions, source: "template", areas: def.areas, connectors: def.connectors,
      }).select("id").single();
      if (error || !created) return { ok: false, message: `Could not create skill ${key}: ${error?.message ?? "no row"}` };
      skillId[key] = created.id;
    }
    await supabase.from("agent_skills").upsert({ org_id: orgId, agent_id: agent.id, skill_id: skillId[key], is_cornerstone: false }, { onConflict: "agent_id,skill_id", ignoreDuplicates: true });
  }

  const uid = () => crypto.randomUUID();
  const { data: have } = await supabase.from("workflows").select("name");
  const names = new Set((have ?? []).map((w) => w.name));
  const defs = [
    { name: "Competitive battlecard pair", description: "Step 1: the analyst proposes evidence-cited battlecard items (through review). Step 2: the messenger drafts seller copy from the ratified items (through proposals).",
      steps: [
        { id: uid(), agent_id: agent.id, skill_id: skillId["competitive_evidence_analyst"], signals: "both", instruction: "Work one named competitor at a time. Propose only what the evidence supports." },
        { id: uid(), agent_id: agent.id, skill_id: skillId["competitive_messenger"], signals: "none", instruction: "Draft from ratified items only — never re-introduce rejected claims." },
      ] },
    { name: "Score the capability matrix", description: "Step 1: rate a rival on each capability 0–3 strictly from cited evidence — proposals land in Signals → Review.",
      steps: [
        { id: uid(), agent_id: agent.id, skill_id: skillId["capability_evidence_scoring"], signals: "both", instruction: "Omit capabilities the evidence doesn't address. A single soft mention is a 1, never higher." },
      ] },
  ];
  let made = 0;
  for (const d of defs) {
    if (names.has(d.name)) continue;
    const { error } = await supabase.from("workflows").insert({ org_id: orgId, agent_id: agent.id, name: d.name, description: d.description, trigger: "manual", target_type: "none", steps: d.steps, is_active: true });
    if (error) return { ok: false, message: `Could not create workflow "${d.name}": ${error.message}` };
    made++;
  }
  return { ok: true, message: `Ready — ${agent.name} carries the three competitive playbooks${made ? `, ${made} workflow${made === 1 ? "" : "s"} created` : " (workflows already existed)"}. Pick them in the selector next to each ✦ button.` };
}
