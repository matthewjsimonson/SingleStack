"use client";

// VectorCurator — the sidebar that opens when you zoom into a vector. It runs the
// records-aware INTERVIEW for that vector (one question at a time, like the
// competitor setup), then GENERATES weighted statement-nodes, and lets you curate
// them (edit text, set weight 3→1, add, remove) without leaving the vector. The
// network keeps everything visible; this is where one arm gets filled out.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Vector } from "@/components/SignalProfile";
import NodeSources from "@/components/NodeSources";

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector; weight?: number };
type Turn = { role: "q" | "a"; text: string };

const WLABEL = (w?: number) => (w ?? 2) >= 3 ? "Core" : (w ?? 2) <= 1 ? "Edge" : "Standard";

export default function VectorCurator({
  vector, label, blurb, entries, onClose, setField, removeField, addField, generate, generating, onSave, onPush, pushLabel, dirty, savingBusy,
}: {
  vector: Vector;
  label: string;
  blurb: string;
  entries: { f: Field; i: number }[];       // this vector's nodes + their global index
  onClose: () => void;
  setField: (i: number, patch: Partial<Field>) => void;
  removeField: (i: number) => void;
  addField: (v: Vector) => void;
  generate: (v: Vector, transcript: Turn[]) => Promise<void>;
  generating: boolean;
  onSave: () => void;
  onPush: () => void;
  pushLabel?: string;
  dirty: boolean;
  savingBusy: boolean;
}) {
  const supabase = createClient();
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [why, setWhy] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pull the next interview question for this vector.
  const nextQuestion = useCallback(async (t: Turn[]) => {
    setAsking(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector, step: "interview", transcript: t } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.done || !data?.question) { setDone(true); setQuestion(""); setWhy(""); }
      else { setQuestion(data.question); setWhy(data.why ?? ""); setTranscript([...t, { role: "q", text: data.question }]); }
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the question."); }
    finally { setAsking(false); }
  }, [supabase, vector]);

  // Fresh interview each time a vector opens.
  useEffect(() => { setTranscript([]); setQuestion(""); setWhy(""); setAnswer(""); setDone(false); setErr(null); void nextQuestion([]); }, [nextQuestion]);

  async function submitAnswer() {
    if (!answer.trim()) return;
    const t = [...transcript, { role: "a" as const, text: answer.trim() }];
    setTranscript(t); setAnswer("");
    await nextQuestion(t);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 480, maxWidth: "95vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
          <div style={{ minWidth: 0 }}>
            <div className="t-h2" style={{ fontSize: 15 }}>{label} vector</div>
            <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{blurb}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>‹ All vectors</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {err && <div className="banner banner-err">{err}</div>}

          {/* Interview — records-aware questions to sharpen this vector */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ marginBottom: 8 }}>Build nodes with AI <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— pulls from your records, then asks what they don&apos;t answer</span></div>
            {transcript.filter((t) => t.role === "a").length > 0 && (
              <div className="stack-2" style={{ marginBottom: 10 }}>
                {transcript.map((t, k) => (
                  <div key={k} className="t-sub" style={{ fontSize: 12.5, color: t.role === "q" ? "var(--tm)" : "var(--tp)" }}>{t.role === "q" ? "Q: " : "A: "}{t.text}</div>
                ))}
              </div>
            )}
            {asking ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Thinking…</div>
              : done ? <div className="t-sub" style={{ fontSize: 12.5, color: "var(--gn-text)" }}>Enough to draft this vector. Generate the nodes, or add your own below.</div>
              : question ? (
                <>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{question}</div>
                  {why && <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{why}</div>}
                  <textarea className="textarea" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer — or skip" />
                  <div className="row gap-2" style={{ marginTop: 8 }}>
                    <button className="btn btn-sm" onClick={submitAnswer} disabled={!answer.trim()}>Answer →</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDone(true)}>Skip / enough</button>
                  </div>
                </>
              ) : null}
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <button className="btn btn-sm" style={{ width: "100%" }} onClick={() => generate(vector, transcript)} disabled={generating}>
                {generating ? "Generating nodes…" : entries.length ? "✨ Regenerate nodes (folds in your answers)" : "✨ Generate nodes"}
              </button>
            </div>
          </div>

          {/* The vector's nodes — weighted statements, core → edge */}
          <div className="t-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Nodes · {entries.length}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => addField(vector)}>+ Add</button>
          </div>
          {entries.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No nodes yet — generate them above, or add by hand. Each node is a statement about you, weighted core → edge.</div> : (
            <div className="stack-2">
              {entries.map(({ f, i }) => (
                <div key={f.field_key} className="card card-pad">
                  <div className="row-between" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
                    <input className="input" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} style={{ fontWeight: 620, fontSize: 13, maxWidth: 240 }} />
                    <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                      <select className="select" value={f.weight ?? 2} onChange={(e) => setField(i, { weight: Number(e.target.value) })} style={{ fontSize: 11.5, padding: "3px 6px" }} title="Weight: Core (closest) → Edge">
                        {[3, 2, 1].map((w) => <option key={w} value={w}>{WLABEL(w)}</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm" onClick={() => removeField(i)} style={{ color: "var(--rd-text)" }}>✕</button>
                    </div>
                  </div>
                  <textarea className="textarea" rows={2} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} placeholder="A statement about you (e.g. 'AI-built working prototypes are our core battleground')." />
                </div>
              ))}
            </div>
          )}

          {/* Vector-level sources — feed every node in this arm (web now). */}
          <NodeSources vector={vector} nodeKey={null}
            seed={entries.find((e) => e.f.field_key.includes("search_focus"))?.f.value
              || entries.filter((e) => (e.f.weight ?? 2) >= 2).map((e) => e.f.value).join(" · ").slice(0, 600)} />
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <button className="btn btn-sm" onClick={onSave} disabled={!dirty || savingBusy}>{savingBusy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
          {pushLabel && <button className="btn btn-secondary btn-sm" onClick={onPush} title={dirty ? "Save first" : `Apply this vector in ${pushLabel}`}>Push to {pushLabel} →</button>}
        </div>
      </aside>
    </>
  );
}
