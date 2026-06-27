// ============================================================================
// messaging — read the GTM messaging & narrative framework (gtm_tabs).
//
// The messaging house (positioning, narrative, value prop, pillars, persona
// messaging, tone, proof, elevator pitch) lives in the framework, NOT on the GTM
// record (which holds strategy & ops). Any function that needs "how we position /
// what we say" reads it from here, so there's one source of truth. Keys are in
// lockstep with web/lib/messagingFramework.ts.
// ============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MSG_LABELS: Record<string, string> = {
  positioning_statement: "Positioning statement",
  strategic_narrative: "Strategic narrative",
  value_proposition: "Value proposition",
  pillar_1: "Messaging pillar 1",
  pillar_2: "Messaging pillar 2",
  pillar_3: "Messaging pillar 3",
  persona_messaging: "Persona messaging",
  tone_of_voice: "Tone of voice",
  proof_points: "Proof points",
  elevator_pitch: "Elevator pitch & boilerplate",
};
const ORDER = Object.keys(MSG_LABELS);

// key → text, for the framework sections that have content.
export async function loadMessagingMap(supabase: SupabaseClient, gtmId: string): Promise<Record<string, string>> {
  const { data } = await supabase.from("gtm_tabs").select("tab_key, body").eq("gtm_record_id", gtmId);
  const map: Record<string, string> = {};
  for (const t of data ?? []) {
    const txt = ((t.body as { text?: string } | null)?.text ?? "").trim();
    if (txt && MSG_LABELS[t.tab_key]) map[t.tab_key] = txt;
  }
  return map;
}

export function formatMessaging(map: Record<string, string>): string {
  return ORDER.filter((k) => map[k]).map((k) => `${MSG_LABELS[k]}: ${map[k]}`).join("\n");
}

// Convenience: the whole framework as a prompt-ready block ("" if empty).
export async function loadMessaging(supabase: SupabaseClient, gtmId: string): Promise<string> {
  return formatMessaging(await loadMessagingMap(supabase, gtmId));
}
