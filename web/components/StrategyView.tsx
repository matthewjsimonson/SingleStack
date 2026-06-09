"use client";

// Strategy — the product pipeline: Signals → Themes → Epics → Ship.
//   Signals  product signals; add context, push into a theme, or merge a new one.
//   Themes   merged signals sorted by group; open for provenance/context/watch/
//            edit; push a theme into an epic.
//   Epics    craft from themes, refine, push to Ship.
// A thin shell over the three stage components; start-epic seeds a bundle and
// jumps to the craft tab. AI is real throughout (synthesize-signals, agent-chat).
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, SubTabs } from "@/components/ui";
import { errText } from "@/lib/strategy";
import SignalsTab from "@/components/strategy/SignalsTab";
import ThemesTab from "@/components/strategy/ThemesTab";
import EpicsTab from "@/components/strategy/EpicsTab";
import OutcomesBoard from "@/components/OutcomesBoard";

type View = "strategy" | "epics" | "outcomes";

export default function StrategyView() {
  const supabase = createClient();
  const [view, setView] = useState<View>("strategy");
  const [showSignals, setShowSignals] = useState(false); // signals feed in from elsewhere — collapsed by default
  const [startedEpicId, setStartedEpicId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };

  // Start an epic from a theme: seed the bundle from the theme and push the
  // theme into it, then jump to the craft tab.
  async function startEpicFromTheme(themeId: string) {
    setError(null);
    try {
      const orgId = await orgIdOr();
      const { data: t } = await supabase.from("signal_themes").select("title, summary, recommendation").eq("id", themeId).maybeSingle();
      const th = (t ?? {}) as { title?: string; summary?: string | null; recommendation?: string | null };
      const { data, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: th.title ?? "", problem: th.summary ?? null, story: th.recommendation ?? null, priority: "medium" }).select("id").single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      await supabase.from("signal_themes").update({ bundle_id: id }).eq("id", themeId);
      setStartedEpicId(id); setView("epics");
    } catch (e) { setError(errText(e, "Could not start the epic.")); }
  }

  // Start an epic from a competitive gap (no theme — a gap is capability evidence).
  async function startEpicFromGap(capId: string, title: string, problem: string) {
    setError(null);
    try {
      const orgId = await orgIdOr();
      const { data, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title, problem, priority: "medium" }).select("id").single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      await supabase.from("bundle_capabilities").insert({ org_id: orgId, bundle_id: id, capability_id: capId });
      setStartedEpicId(id); setView("epics");
    } catch (e) { setError(errText(e, "Could not start the epic.")); }
  }

  return (
    <div>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <h1 className="t-page">Strategy</h1>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Product signals merge into themes, auto-bucketed by strategic group; craft the strongest into epics and push to Ship.</div>
      </div>
      <SubTabs<View> tabs={[{ key: "strategy", label: "Strategy" }, { key: "epics", label: "Epics" }, { key: "outcomes", label: "Outcomes" }]} active={view} onChange={setView} />
      <Banner>{error}</Banner>

      {view === "strategy" && (
        <div>
          {/* Signals feed in from the Signals area; here they're just inputs to themes. */}
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowSignals((v) => !v)}>{showSignals ? "▾ Hide signals feeding in" : "▸ Signals feeding in"}</button>
          </div>
          {showSignals && <div className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}><SignalsTab onStartEpicFromGap={startEpicFromGap} /></div>}
          <ThemesTab onStartEpic={startEpicFromTheme} />
        </div>
      )}
      {view === "epics" && <EpicsTab initialEpicId={startedEpicId} />}
      {view === "outcomes" && <OutcomesBoard />}
    </div>
  );
}
