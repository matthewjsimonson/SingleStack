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

// The strategic groups for the GTM board — campaign/content oriented (vs the
// product groups above, which are build oriented).
export const GTM_GROUPS: { key: string; label: string; blurb: string }[] = [
  { key: "messaging", label: "Messaging & positioning", blurb: "How we talk about value; narrative shifts." },
  { key: "demand", label: "Demand & campaigns", blurb: "Plays to create and capture demand." },
  { key: "content", label: "Content & proof", blurb: "Assets, stories, and proof points buyers need." },
  { key: "enablement", label: "Sales enablement", blurb: "What reps need to win deals." },
  { key: "audience", label: "Audience & segments", blurb: "Who we target and where they are." },
];

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

// Product Strategy shows PRODUCT signals — everything except pure GTM-messaging
// signals (gtm-categorized with no special domain) and Sell-loop usage/PQL
// signals (a GTM concern). Competitive / market / frontier and product/both/
// unsorted all inform what to build.
export function isProductSignal(s: { category?: string | null; metadata: { domain?: string } | null }): boolean {
  if (s.metadata?.domain === "usage") return false; // PQL / usage signals are GTM-lens only
  return !(s.category === "gtm" && !s.metadata?.domain);
}

// GTM Strategy shows GTM signals — categorized 'gtm'/'both', plus the market and
// usage (PQL / Sell-loop) domains. Organizes these into campaign/content themes.
export function isGtmSignal(s: { category?: string | null; metadata: { domain?: string } | null }): boolean {
  return s.category === "gtm" || s.category === "both" || s.metadata?.domain === "market" || s.metadata?.domain === "usage";
}

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
