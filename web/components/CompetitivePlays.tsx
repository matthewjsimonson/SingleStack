"use client";

// Competitive Plays — the four officers each run their analytical function over
// ONE competitor and return a STRUCTURED artifact (not a chat). Same engine, four
// lenses: CPO product standing · CEng build-to-beat · CCO narrative · CRO win plan.
// The runs fire in PARALLEL (each is its own bounded run-play call), so they land
// independently, are retriable one at a time, and keep latency flat. Each artifact
// is reviewed HITL: edit it section by section, then ratify or dismiss. Rating the
// run feeds the outcome loop.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip } from "@/components/ui";

type Sec = { title: string; body: string; evidence: string[] };
type Payload = { headline: string; sections: Sec[]; recommendations: string[]; confidence: string };
type Artifact = { id: string; function_key: string; title: string; status: string; payload: Payload; run_id: string | null };

const PLAYS = [
  { key: "product_standing", label: "Product standing", officer: "CPO", tone: "accent" as const },
  { key: "build_to_beat", label: "Build-to-beat", officer: "Chief Eng", tone: "accent" as const },
  { key: "narrative_angle", label: "Narrative angle", officer: "CCO", tone: "violet" as const },
  { key: "win_plan", label: "Win plan", officer: "CRO", tone: "violet" as const },
];

export default function CompetitivePlays({ competitorId, competitorName }: { competitorId: string; competitorName: string }) {
  const supabase = createClient();
  const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Payload | null>(null);
  const [rated, setRated] = useState<Record<string, "helpful" | "not_helpful">>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("agent_artifacts")
      .select("id, function_key, title, status, payload, run_id")
      .eq("target_type", "competitor").eq("target_id", competitorId)
      .order("created_at", { ascending: false });
    const latest: Record<string, Artifact> = {};
    for (const a of (data ?? []) as Artifact[]) if (!latest[a.function_key]) latest[a.function_key] = a;
    setArtifacts(latest);
  }, [supabase, competitorId]);
  useEffect(() => { load(); }, [load]);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function runPlay(key: string) {
    setRunning((r) => ({ ...r, [key]: true })); setError(null);
    try {
      const t = await token();
      const { data, error } = await supabase.functions.invoke("run-play", {
        body: { function_key: key, target_type: "competitor", target_id: competitorId },
        headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setArtifacts((a) => ({ ...a, [key]: data.artifact }));
    } catch (e) { setError(e instanceof Error ? e.message : `Could not run ${key}.`); }
    finally { setRunning((r) => ({ ...r, [key]: false })); }
  }
  function runAll() { for (const p of PLAYS) if (!running[p.key]) runPlay(p.key); }

  async function setStatus(a: Artifact, status: "ratified" | "dismissed" | "draft") {
    setArtifacts((m) => ({ ...m, [a.function_key]: { ...a, status } }));
    await supabase.from("agent_artifacts").update({ status, ratified_at: status === "ratified" ? new Date().toISOString() : null }).eq("id", a.id);
  }
  async function rate(runId: string | null, rating: "helpful" | "not_helpful") {
    if (!runId) return;
    setRated((s) => ({ ...s, [runId]: rating }));
    await supabase.from("agent_runs").update({ rating, rated_at: new Date().toISOString() }).eq("id", runId);
  }

  function startEdit(a: Artifact) { setEditing(a.id); setDraft(JSON.parse(JSON.stringify(a.payload))); }
  async function saveEdit(a: Artifact) {
    if (!draft) return;
    setArtifacts((m) => ({ ...m, [a.function_key]: { ...a, payload: draft } }));
    setEditing(null);
    await supabase.from("agent_artifacts").update({ payload: draft }).eq("id", a.id);
  }

  return (
    <Section
      label="Officer analyses"
      action={<button className="btn btn-sm" onClick={runAll} style={{ background: "var(--ac)", color: "#fff" }} disabled={PLAYS.some((p) => running[p.key])}>Run all four</button>}
    >
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Each officer runs their own analysis on {competitorName} — same evidence, four lenses. Review, edit, and ratify each.
      </div>
      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
        {PLAYS.map((p) => {
          const a = artifacts[p.key];
          const isRunning = running[p.key];
          const isEditing = a && editing === a.id;
          return (
            <div key={p.key} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row-between" style={{ gap: 8 }}>
                <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                  <Chip tone={p.tone}>{p.officer}</Chip>
                  <span style={{ fontSize: 14, fontWeight: 660 }}>{p.label}</span>
                  {a && <Chip tone={a.status === "ratified" ? "green" : a.status === "dismissed" ? "default" : "amber"}>{a.status}</Chip>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => runPlay(p.key)} disabled={isRunning}>{isRunning ? "Running…" : a ? "Re-run" : "Run"}</button>
              </div>

              {!a && !isRunning && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Not run yet.</div>}
              {isRunning && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{p.officer} is analyzing {competitorName}…</div>}

              {a && !isRunning && isEditing && draft && (
                <div className="stack-3">
                  <input className="input" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
                  {draft.sections.map((s, i) => (
                    <div key={i}>
                      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>{s.title}</div>
                      <textarea className="textarea" rows={3} value={s.body} onChange={(e) => { const next = [...draft.sections]; next[i] = { ...s, body: e.target.value }; setDraft({ ...draft, sections: next }); }} />
                    </div>
                  ))}
                  <div>
                    <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Recommendations (one per line)</div>
                    <textarea className="textarea" rows={3} value={draft.recommendations.join("\n")} onChange={(e) => setDraft({ ...draft, recommendations: e.target.value.split("\n").filter(Boolean) })} />
                  </div>
                  <div className="row gap-2"><button className="btn btn-sm" onClick={() => saveEdit(a)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              )}

              {a && !isRunning && !isEditing && (
                <>
                  <div className="t-body" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>{a.payload.headline}</div>
                  {(a.payload.sections ?? []).map((s, i) => (
                    <div key={i}>
                      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 2 }}>{s.title}</div>
                      <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.body}</div>
                      {(s.evidence ?? []).length > 0 && (
                        <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 4 }}>
                          {s.evidence.map((ev, j) => <span key={j} className="t-mono-xs" style={{ background: "var(--fill)", padding: "1px 6px", borderRadius: 5, color: "var(--tm)" }}>{ev}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                  {(a.payload.recommendations ?? []).length > 0 && (
                    <div>
                      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 2 }}>Recommendations</div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>{a.payload.recommendations.map((r, i) => <li key={i} className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{r}</li>)}</ul>
                    </div>
                  )}
                  {a.payload.confidence && <div className="t-mono-xs" style={{ color: "var(--tm)" }}>Confidence: {a.payload.confidence}</div>}

                  <div className="row-between" style={{ marginTop: 4, gap: 8, flexWrap: "wrap" }}>
                    <div className="row gap-2">
                      {a.status !== "ratified" && <button className="btn btn-success btn-sm" onClick={() => setStatus(a, "ratified")}>Ratify</button>}
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(a)}>Edit</button>
                      {a.status !== "dismissed" && <button className="btn btn-secondary btn-sm" onClick={() => setStatus(a, "dismissed")} style={{ color: "var(--rd-text)" }}>Dismiss</button>}
                    </div>
                    {a.run_id && (rated[a.run_id]
                      ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{rated[a.run_id] === "helpful" ? "Rated helpful" : "Rated not helpful"}</span>
                      : <div className="row gap-2"><button className="btn btn-secondary btn-sm" onClick={() => rate(a.run_id, "helpful")}>Helpful</button><button className="btn btn-secondary btn-sm" onClick={() => rate(a.run_id, "not_helpful")}>Not helpful</button></div>)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
