// Shared Product-Strategy constants, types, and helpers — used across the
// Signals / Themes / Groups tabs and the Epics craft surface.
import type { SupabaseClient } from "@supabase/supabase-js";

export const SCORE_LABEL = ["—", "Partial", "Good", "Strong"];

// The strategic groups a merged signal (theme) can be sorted into.
export const GROUPS: { key: string; label: string; blurb: string }[] = [
  { key: "feature_gap", label: "Feature gaps", blurb: "Where we trail on something buyers expect." },
  { key: "expansion", label: "Expansions", blurb: "Extend what we already do well." },
  { key: "big_bet", label: "Big bets", blurb: "Category-shaping moves; higher risk, higher upside." },
  { key: "quality", label: "Quality & fixes", blurb: "Reliability, bugs, and rough edges." },
  { key: "adjacent", label: "Adjacent bets", blurb: "New territory next to the core." },
];
export const GROUP_LABEL: Record<string, string> = Object.fromEntries(GROUPS.map((g) => [g.key, g.label]));

export const PRIORITY_TONE: Record<string, "default" | "accent" | "amber"> = { low: "default", medium: "accent", high: "amber" };

export type Cap = { id: string; name: string };
export type Score = { capability_id: string; competitor_id: string | null; score: number };
export type Competitor = { id: string; name: string };
export type Gap = { cap: Cap; us: number; best: number; byName: string | null; isGap: boolean };

// Competitive matrix → gaps (capabilities where a rival outscores us; us = null).
export function gapsOf(caps: Cap[], scores: Score[], competitors: Competitor[]): Gap[] {
  const scoreOf = (capId: string, compId: string | null) => scores.find((x) => x.capability_id === capId && x.competitor_id === compId)?.score ?? 0;
  return caps.map((cap) => {
    const us = scoreOf(cap.id, null);
    let best = us, byId: string | null = null;
    for (const c of competitors) { const sc = scoreOf(cap.id, c.id); if (sc > best) { best = sc; byId = c.id; } }
    return { cap, us, best, byName: byId ? competitors.find((c) => c.id === byId)?.name ?? "a rival" : null, isGap: best > us };
  }).filter((g) => g.isGap);
}

export const confText = (x: { conf_level: number | null; conf_label?: string | null }) =>
  x.conf_label || (x.conf_level != null ? `${Math.round(x.conf_level * 100)}%` : null);

export const errText = (e: unknown, f: string) =>
  e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : e instanceof Error ? e.message : f;

// The officer that drafts product epics (CPO), else any active agent.
export async function fetchAgentKey(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("agents").select("key").eq("is_active", true);
  const rows = (data ?? []) as { key: string }[];
  return rows.find((a) => a.key === "cpo")?.key ?? rows[0]?.key ?? null;
}

export async function authHeader(supabase: SupabaseClient): Promise<Record<string, string> | undefined> {
  const t = (await supabase.auth.getSession()).data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : undefined;
}
