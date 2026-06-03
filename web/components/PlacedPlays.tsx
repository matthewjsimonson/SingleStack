"use client";

// PlacedPlays — renders the plays PLACED on a given surface as runnable elements
// (Phase 4). Placement (Phase 3) decides which plays appear here; this loads them
// and hands them to PlaysPanel to run inline against the surface's entity. Renders
// nothing when no play is placed on the surface.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureBuiltInPlays } from "@/lib/ensurePlays";
import PlaysPanel, { type PlayDef } from "@/components/PlaysPanel";

export default function PlacedPlays({ surfaceKey, targetType, targetId, targetName, heading }: {
  surfaceKey: string; targetType: string; targetId: string; targetName: string; heading?: string;
}) {
  const supabase = createClient();
  const [plays, setPlays] = useState<PlayDef[]>([]);

  const load = useCallback(async () => {
    if (surfaceKey === "competitor_home") await ensureBuiltInPlays(supabase); // built-ins seed where they live
    const { data: placements } = await supabase.from("play_placements").select("play_id").eq("surface_key", surfaceKey);
    const ids = [...new Set((placements ?? []).map((r) => r.play_id))];
    if (ids.length === 0) { setPlays([]); return; }
    const [{ data: pl }, { data: pa }, { data: ag }] = await Promise.all([
      supabase.from("plays").select("id, key, label").in("id", ids),
      supabase.from("play_agents").select("play_id, agent_id, position").in("play_id", ids).order("position"),
      supabase.from("agents").select("id, name"),
    ]);
    const agentName = (id: string) => (ag ?? []).find((a) => a.id === id)?.name ?? "Officer";
    const primaryByPlay: Record<string, string> = {};
    for (const r of pa ?? []) if (!(r.play_id in primaryByPlay)) primaryByPlay[r.play_id] = r.agent_id;
    setPlays((pl ?? []).map((p) => ({ key: p.key, label: p.label, officer: primaryByPlay[p.id] ? agentName(primaryByPlay[p.id]) : "Officer", tone: "accent" as const })));
  }, [supabase, surfaceKey]);
  useEffect(() => { load(); }, [load]);

  if (plays.length === 0) return null;
  return <PlaysPanel targetType={targetType} targetId={targetId} targetName={targetName} plays={plays} heading={heading ?? "Plays"} />;
}
