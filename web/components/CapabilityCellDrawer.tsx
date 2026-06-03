"use client";

// Capability-cell drawer — clicking a heat-map cell no longer blindly cycles the
// score. It opens this: the officer's tailored read on WHY this rating (reasons,
// the kind of evidence/sources behind it, and the competitive implication) — and
// THEN you set the rating yourself, informed by that + your gut. HITL: the agent
// argues, the human decides. (Parent remounts via `key` per cell.)
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

export type Cell = {
  capabilityId: string; capabilityName: string; competitorId: string | null; who: string; score: number;
  competitorNotes?: string | null; productValueProp?: string | null;
};
const LEVELS = [["—", 0], ["Partial", 1], ["Good", 2], ["Strong", 3]] as const;
const heat = (s: number) => ["var(--fill)", "#FCE4C7", "#CDEBD6", "#9FD9B4"][s] || "var(--fill)";

export default function CapabilityCellDrawer({ cell, onClose, onChanged }: { cell: Cell | null; onClose: () => void; onChanged: () => void }) {
  const supabase = createClient();
  const open = !!cell;
  const [selected, setSelected] = useState<number | null>(null);
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!cell) return null;
  const current = selected ?? cell.score;

  async function setRating(next: number) {
    setBusy(true); setError(null); setSelected(next);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      let q = supabase.from("capability_scores").select("id").eq("capability_id", cell!.capabilityId);
      q = cell!.competitorId === null ? q.is("competitor_id", null) : q.eq("competitor_id", cell!.competitorId);
      const { data: existing } = await q.maybeSingle();
      const { error } = existing?.id
        ? await supabase.from("capability_scores").update({ score: next }).eq("id", existing.id)
        : await supabase.from("capability_scores").insert({ org_id: orgId, capability_id: cell!.capabilityId, competitor_id: cell!.competitorId, score: next });
      if (error) throw error;
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save rating."); }
    setBusy(false);
  }

  async function ask() {
    setThinking(true); setError(null); setTake(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const subject = cell!.competitorId === null ? `OUR product${cell!.productValueProp ? ` (${cell!.productValueProp})` : ""}` : `the competitor "${cell!.who}"${cell!.competitorNotes ? ` (${cell!.competitorNotes})` : ""}`;
      const prompt = `Assess ${subject} on the capability "${cell!.capabilityName}". In 3–4 sentences give: (1) the reason it deserves a rating of — / Partial / Good / Strong, (2) what evidence or sources would back that, and (3) the implication for how we compete. Be specific and honest.`;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: "cro", messages: [{ role: "user", content: prompt }], context: { area: "signals" } },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTake(data.reply);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the officer."); }
    finally { setThinking(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, transition: "opacity 0.18s ease", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 480, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 3 }}>{cell.who} · capability</div>
            <div style={{ fontSize: 16, fontWeight: 680, lineHeight: 1.3 }}>{cell.capabilityName}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Why this rating</div>
            <button className="btn btn-sm" onClick={ask} disabled={thinking} style={{ background: "var(--ac)", color: "#fff" }}>{thinking ? "CRO is assessing…" : "Ask the CRO: reasons, sources, implications"}</button>
            {take && <div className="card card-pad" style={{ marginTop: 10, background: "var(--panel)" }}><div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{take}</div></div>}
          </div>

          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Your rating <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>— agent informs, you decide</span></div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {LEVELS.map(([label, val]) => (
                <button key={val} onClick={() => setRating(val)} disabled={busy}
                  style={{ padding: "9px 14px", borderRadius: 8, border: current === val ? "2px solid var(--tp)" : "1px solid var(--border)", background: heat(val), fontSize: 12.5, fontWeight: 600, color: "var(--tp)", cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {cell.competitorNotes && (
            <div className="card card-pad">
              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>About {cell.who}</div>
              <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{cell.competitorNotes}</div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
