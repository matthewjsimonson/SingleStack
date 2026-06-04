"use client";

// PlayActions — how PLACED plays appear on a surface. Lists the plays mapped onto
// this surface (play_placements) as compact launchers: "Officer · Play  [Run]".
// Running opens the PlayRunDrawer (right pop-out) where the work, the output, the
// follow-up chat, and the push actions all live. Renders nothing until a play is
// mapped here, so surfaces stay clean by default.
//
// Drop onto any non-advisor surface:
//   <PlayActions surfaceKey="strategy_theme" targetId={theme.id} targetName={theme.title} />
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AgentBadge } from "@/components/ui";
import PlayRunDrawer, { type DrawerPlay } from "@/components/PlayRunDrawer";

export default function PlayActions({ surfaceKey, targetId, targetName, heading = "Plays" }: {
  surfaceKey: string; targetId: string; targetName: string; heading?: string;
}) {
  const supabase = createClient();
  const [plays, setPlays] = useState<DrawerPlay[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set()); // plays with an existing artifact
  const [active, setActive] = useState<DrawerPlay | null>(null);

  const load = useCallback(async () => {
    const { data: placements } = await supabase.from("play_placements").select("play_id").eq("surface_key", surfaceKey);
    const ids = [...new Set((placements ?? []).map((r) => r.play_id))];
    if (ids.length === 0) { setPlays([]); return; }
    const [{ data: pl }, { data: pa }, { data: ag }, { data: arts }] = await Promise.all([
      supabase.from("plays").select("id, key, label, target_type").in("id", ids).eq("is_active", true),
      supabase.from("play_agents").select("play_id, agent_id, position").in("play_id", ids).order("position"),
      supabase.from("agents").select("id, key, name"),
      supabase.from("agent_artifacts").select("function_key").eq("target_id", targetId),
    ]);
    const agById = (id: string) => (ag ?? []).find((x) => x.id === id);
    const primary: Record<string, string> = {};
    for (const r of pa ?? []) if (!(r.play_id in primary)) primary[r.play_id] = r.agent_id;
    setPlays((pl ?? []).map((p) => {
      const ag0 = primary[p.id] ? agById(primary[p.id]) : undefined;
      return { key: p.key, label: p.label, targetType: p.target_type, officer: ag0?.name ?? "Officer", agentKey: ag0?.key ?? null };
    }));
    setDone(new Set((arts ?? []).map((r) => r.function_key)));
  }, [supabase, surfaceKey, targetId]);
  useEffect(() => { load(); }, [load]);

  if (plays.length === 0) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 16 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>{heading}</div>
      <div className="stack-2">
        {plays.map((p) => (
          <div key={p.key} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}>
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
              <AgentBadge name={p.officer} accent="var(--ac)" />
              <span style={{ fontSize: 13.5, fontWeight: 640 }}>{p.label}</span>
            </div>
            <button className="btn btn-sm" onClick={() => setActive(p)} style={{ flexShrink: 0, ...(done.has(p.key) ? {} : { background: "var(--ac)", color: "#fff" }) }}>
              {done.has(p.key) ? "View" : "✦ Run"}
            </button>
          </div>
        ))}
      </div>
      <PlayRunDrawer
        open={!!active}
        play={active}
        target={{ id: targetId, name: targetName }}
        onClose={() => { setActive(null); load(); }}
      />
    </div>
  );
}
