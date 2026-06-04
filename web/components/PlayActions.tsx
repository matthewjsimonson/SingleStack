"use client";

// PlayActions — the inline, in-context way a PLACED play appears on a surface.
// Loads the plays mapped onto this surface (play_placements) and renders each as
// a compact strip: "Officer · Play  [Run]". Running calls the same run-play engine
// PlaysPanel uses (one structured artifact, persisted + HITL), but presented
// INLINE under the surface's own content — no floating box, no grid. Renders
// nothing until a play is mapped here, so surfaces stay clean by default.
//
// Drop onto any surface:  <PlayActions surfaceKey="strategy_theme"
//   targetId={theme.id} targetName={theme.title} />  — each play carries its own
// target_type, so the surface only supplies which entity it's running against.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AgentBadge, Chip, SourceChip } from "@/components/ui";

type Sec = { title: string; body: string; evidence: string[] };
type Payload = { headline: string; sections: Sec[]; recommendations: string[]; confidence: string };
type Artifact = { id: string; function_key: string; status: string; payload: Payload; run_id: string | null };
type Play = { key: string; label: string; officer: string; target_type: string | null };

export default function PlayActions({ surfaceKey, targetId, targetName, heading = "Plays" }: {
  surfaceKey: string; targetId: string; targetName: string; heading?: string;
}) {
  const supabase = createClient();
  const [plays, setPlays] = useState<Play[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [rated, setRated] = useState<Record<string, "helpful" | "not_helpful">>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: placements } = await supabase.from("play_placements").select("play_id").eq("surface_key", surfaceKey);
    const ids = [...new Set((placements ?? []).map((r) => r.play_id))];
    if (ids.length === 0) { setPlays([]); return; }
    const [{ data: pl }, { data: pa }, { data: ag }, { data: arts }] = await Promise.all([
      supabase.from("plays").select("id, key, label, target_type").in("id", ids).eq("is_active", true),
      supabase.from("play_agents").select("play_id, agent_id, position").in("play_id", ids).order("position"),
      supabase.from("agents").select("id, name"),
      supabase.from("agent_artifacts").select("id, function_key, status, payload, run_id").eq("target_id", targetId).order("created_at", { ascending: false }),
    ]);
    const agentName = (id: string) => (ag ?? []).find((a) => a.id === id)?.name ?? "Officer";
    const primary: Record<string, string> = {};
    for (const r of pa ?? []) if (!(r.play_id in primary)) primary[r.play_id] = r.agent_id;
    setPlays((pl ?? []).map((p) => ({ key: p.key, label: p.label, target_type: p.target_type, officer: primary[p.id] ? agentName(primary[p.id]) : "Officer" })));
    const latest: Record<string, Artifact> = {};
    for (const a of (arts ?? []) as Artifact[]) if (!latest[a.function_key]) latest[a.function_key] = a;
    setArtifacts(latest);
  }, [supabase, surfaceKey, targetId]);
  useEffect(() => { load(); }, [load]);

  async function runPlay(key: string) {
    setRunning((r) => ({ ...r, [key]: true })); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const t = sess.session?.access_token;
      // Pass the play's OWN target_type (or omit for custom plays) so run-play's
      // guardrail always passes and it picks the right context branch.
      const tt = plays.find((p) => p.key === key)?.target_type ?? undefined;
      const { data, error } = await supabase.functions.invoke("run-play", {
        body: { function_key: key, target_type: tt, target_id: targetId, target_name: targetName },
        headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setArtifacts((a) => ({ ...a, [key]: data.artifact }));
    } catch (e) { setError(e instanceof Error ? e.message : `Could not run ${key}.`); }
    finally { setRunning((r) => ({ ...r, [key]: false })); }
  }

  async function setStatus(a: Artifact, status: "ratified" | "dismissed") {
    setArtifacts((m) => ({ ...m, [a.function_key]: { ...a, status } }));
    await supabase.from("agent_artifacts").update({ status, ratified_at: status === "ratified" ? new Date().toISOString() : null }).eq("id", a.id);
  }
  async function rate(runId: string | null, rating: "helpful" | "not_helpful") {
    if (!runId) return;
    setRated((s) => ({ ...s, [runId]: rating }));
    await supabase.from("agent_runs").update({ rating, rated_at: new Date().toISOString() }).eq("id", runId);
  }

  if (plays.length === 0) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 16 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>{heading}</div>
      {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="stack-3">
        {plays.map((p) => {
          const a = artifacts[p.key];
          const busy = running[p.key];
          return (
            <div key={p.key}>
              <div className="row-between" style={{ alignItems: "center", gap: 8 }}>
                <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                  <AgentBadge name={p.officer} accent="var(--ac)" />
                  <span style={{ fontSize: 13.5, fontWeight: 640 }}>{p.label}</span>
                  {a && <Chip tone={a.status === "ratified" ? "green" : a.status === "dismissed" ? "default" : "amber"}>{a.status}</Chip>}
                </div>
                <button className="btn btn-sm" disabled={busy} onClick={() => runPlay(p.key)} style={{ background: "var(--ac)", color: "#fff" }}>
                  {busy ? "Running…" : a ? "Re-run" : "✦ Run"}
                </button>
              </div>

              {busy && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 6 }}>{p.officer} is working on {targetName}…</div>}

              {a && !busy && (
                <div style={{ marginTop: 8, background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
                  <div className="t-body" style={{ fontSize: 13.5, fontWeight: 640, lineHeight: 1.45, marginBottom: 8 }}>{a.payload.headline}</div>
                  {(a.payload.sections ?? []).map((s, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 2 }}>{s.title}</div>
                      <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.body}</div>
                      {(s.evidence ?? []).length > 0 && (
                        <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
                          <span className="t-label" style={{ color: "var(--tm)", fontSize: 10 }}>Evidence</span>
                          {s.evidence.map((ev, j) => <SourceChip key={j} icon="◦" label={ev} />)}
                        </div>
                      )}
                    </div>
                  ))}
                  {(a.payload.recommendations ?? []).length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 2 }}>Recommendations</div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>{a.payload.recommendations.map((r, i) => <li key={i} className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{r}</li>)}</ul>
                    </div>
                  )}
                  {a.payload.confidence && <div className="t-mono-xs" style={{ color: "var(--tm)" }}>Confidence: {a.payload.confidence}</div>}

                  <div className="row-between" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                    <div className="row gap-2">
                      {a.status !== "ratified" && <button className="btn btn-success btn-sm" onClick={() => setStatus(a, "ratified")}>Ratify</button>}
                      {a.status !== "dismissed" && <button className="btn btn-secondary btn-sm" onClick={() => setStatus(a, "dismissed")} style={{ color: "var(--rd-text)" }}>Dismiss</button>}
                    </div>
                    {a.run_id && (rated[a.run_id]
                      ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{rated[a.run_id] === "helpful" ? "Rated helpful" : "Rated not helpful"}</span>
                      : <div className="row gap-2"><button className="btn btn-secondary btn-sm" onClick={() => rate(a.run_id, "helpful")}>Helpful</button><button className="btn btn-secondary btn-sm" onClick={() => rate(a.run_id, "not_helpful")}>Not helpful</button></div>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
