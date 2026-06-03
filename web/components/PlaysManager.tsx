"use client";

// Plays — visibility + config for the typed analyses officers run. Each Play is
// an officer + a focus (the lens) producing a structured artifact (the competitor
// analyses). This shows the four Plays and lets you tune which officer runs each,
// the focus, the suggested sections, and whether it's on. Config is stored per
// org in `plays`; run-play reads it, falling back to these defaults when absent.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip } from "@/components/ui";

// Mirrors the run-play code defaults — what runs when a Play isn't configured.
const DEFAULTS = [
  { key: "product_standing", label: "Product standing", target: "competitor", agentKey: "cpo", focus: "Assess where our product stands versus this competitor, capability by capability — where we clearly win, where we're at parity, where we lose. Ground every call in the matrix, battlecard, and signals.", sections: "Where we win, At parity, Where we lose, Biggest gap to close" },
  { key: "build_to_beat", label: "Build-to-beat", target: "competitor", agentKey: "ceng", focus: "From an engineering lens: what to build to catch up where we're behind and pull further ahead where we lead. Note rough effort and leverage/risk per move.", sections: "Catch-up builds, Leap-ahead builds, Sequencing & effort, Technical risks" },
  { key: "narrative_angle", label: "Narrative angle", target: "competitor", agentKey: "cco", focus: "How to tell our story against this competitor — amplify genuine strengths, honestly reframe weaknesses, find the narrative wedge. Concrete language, no hype.", sections: "Strengths to amplify, Weaknesses to reframe, The wedge, Messages to avoid" },
  { key: "win_plan", label: "Win plan", target: "competitor", agentKey: "cro", focus: "How to win deals against this competitor — where we win, traps to set, objection handling, and the proof points that close.", sections: "Where we win, Traps to set, Objection handling, Proof points" },
  { key: "initiative_review", label: "Initiative review", target: "initiative", agentKey: "cpo", focus: "Review this initiative as a bet: is the scope right, is it sequenced sensibly, what's the single biggest risk, and how strong is the evidence behind it?", sections: "The bet, Scope check, Sequencing, Biggest risk" },
  { key: "delivery_risk", label: "Delivery risk", target: "initiative", agentKey: "ceng", focus: "From an engineering lens, what could derail delivery? Technical risks, dependencies, and the riskiest workstream, each with a de-risking move.", sections: "Technical risks, Dependencies, Riskiest workstream, De-risking moves" },
  { key: "gtm_readiness", label: "GTM readiness", target: "initiative", agentKey: "cro", focus: "Is this initiative ready to win in-market? Positioning readiness, the proof we'll need, and the GTM gaps to close before launch.", sections: "Positioning readiness, Proof needed, GTM gaps, Launch checklist" },
];

type Agent = { id: string; key: string; name: string };
type PlayRow = { id: string; key: string; label: string; agent_id: string | null; focus: string; sections: string | null; is_active: boolean };
type Draft = { agent_id: string; focus: string; sections: string; is_active: boolean };

export default function PlaysManager() {
  const supabase = createClient();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rows, setRows] = useState<Record<string, PlayRow>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: ag }, { data: pl }] = await Promise.all([
      supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      supabase.from("plays").select("id, key, label, agent_id, focus, sections, is_active"),
    ]);
    setAgents(ag ?? []);
    const map: Record<string, PlayRow> = {};
    for (const p of (pl ?? []) as PlayRow[]) map[p.key] = p;
    setRows(map);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const agentByKey = (k: string) => agents.find((a) => a.key === k);
  const agentById = (id: string | null) => agents.find((a) => a.id === id);

  // Effective config for a Play: the DB row if configured, else the code default.
  function effective(def: typeof DEFAULTS[number]) {
    const r = rows[def.key];
    const agent = r?.agent_id ? agentById(r.agent_id) : agentByKey(def.agentKey);
    return { label: r?.label ?? def.label, focus: r?.focus ?? def.focus, sections: r?.sections ?? def.sections, is_active: r?.is_active ?? true, agent, configured: !!r };
  }

  function start(def: typeof DEFAULTS[number]) {
    const e = effective(def);
    setError(null); setEditing(def.key);
    setDraft({ agent_id: e.agent?.id ?? "", focus: e.focus, sections: e.sections ?? "", is_active: e.is_active });
  }
  async function save(def: typeof DEFAULTS[number]) {
    if (!draft) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Couldn't resolve your organization."); return; }
    const { error } = await supabase.from("plays").upsert({
      org_id: orgId, key: def.key, label: def.label, target_type: "competitor",
      agent_id: draft.agent_id || null, focus: draft.focus.trim() || def.focus,
      sections: draft.sections.trim() || null, is_active: draft.is_active, updated_at: new Date().toISOString(),
    }, { onConflict: "org_id,key" });
    if (error) { setError(error.message); return; }
    setEditing(null); await load();
  }

  return (
    <Section label="Plays — how the officer analyses run">
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Each competitor analysis is a Play: an officer applies a focus and returns a structured artifact. Tune which officer runs it, the focus, and whether it&rsquo;s on.</div>
      <div className="stack-3">
        {DEFAULTS.map((def) => {
          const e = effective(def);
          const isEd = editing === def.key;
          return (
            <div key={def.key} className="card card-pad">
              <div className="row-between" style={{ gap: 10 }}>
                <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 660 }}>{e.label}</span>
                  <Chip tone={def.target === "initiative" ? "violet" : "default"}>{def.target}</Chip>
                  {e.agent && <Chip tone="accent">{e.agent.name}</Chip>}
                  {!e.is_active && <Chip tone="amber">off</Chip>}
                  {!e.configured && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>default</span>}
                </div>
                {!isEd && <button className="btn btn-secondary btn-sm" onClick={() => start(def)}>Configure</button>}
              </div>
              {!isEd ? (
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{e.focus}</div>
              ) : draft && (
                <div className="stack-3" style={{ marginTop: 10 }}>
                  <label className="field"><span className="t-label">Officer</span>
                    <select className="select" value={draft.agent_id} onChange={(ev) => setDraft({ ...draft, agent_id: ev.target.value })}>
                      <option value="">— default officer —</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select></label>
                  <label className="field"><span className="t-label">Focus (the lens)</span>
                    <textarea className="textarea" rows={3} value={draft.focus} onChange={(ev) => setDraft({ ...draft, focus: ev.target.value })} /></label>
                  <label className="field"><span className="t-label">Suggested sections</span>
                    <input className="input" value={draft.sections} onChange={(ev) => setDraft({ ...draft, sections: ev.target.value })} placeholder="Comma-separated section names" /></label>
                  <label className="row gap-2" style={{ fontSize: 13 }}><input type="checkbox" checked={draft.is_active} onChange={(ev) => setDraft({ ...draft, is_active: ev.target.checked })} /> Active</label>
                  {error && <div className="banner banner-error">{error}</div>}
                  <div className="row gap-2"><button className="btn btn-sm" onClick={() => save(def)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
