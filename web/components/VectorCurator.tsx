"use client";

// VectorCurator — the drawer that opens when you MANAGE a vector. Three ways to
// grow the branch, all HITL:
//   • the records-aware INTERVIEW (one question at a time) feeds…
//   • …AI-PROPOSED nodes: each arrives as a proposal card you Accept / Discard
//     (nothing lands on the network unreviewed, nothing saves until Save);
//   • GUIDED manual add: pick where the node attaches (the hub roots a new
//     branch; an existing node grows its chain), name it, state it, and the
//     weight is suggested from where it sits — closer to the center = more
//     defining. Everything stays editable and re-parentable afterwards.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Vector } from "@/components/SignalProfile";
import NodeSources from "@/components/NodeSources";

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector; weight?: number; parent_key?: string | null };
type Turn = { role: "q" | "a"; text: string };

const WLABEL = (w?: number) => (w ?? 2) >= 3 ? "Core" : (w ?? 2) <= 1 ? "Edge" : "Standard";
const WHY_WEIGHT: Record<number, string> = {
  3: "sits closest to the center — a defining attribute, searched first",
  2: "standard distance — tracked steadily",
  1: "edge of the branch — adjacent, caught but not chased",
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "node";

export default function VectorCurator({
  vector, label, blurb, entries, onClose, setField, removeField, upsertNode, generate, generating, onSave, onPush, pushLabel, dirty, savingBusy, initialParent,
}: {
  vector: Vector;
  label: string;
  blurb: string;
  entries: { f: Field; i: number }[];       // this vector's nodes + their global index
  onClose: () => void;
  setField: (i: number, patch: Partial<Field>) => void;
  removeField: (i: number) => void;
  upsertNode: (f: Field) => void;           // add (or replace by field_key) one reviewed node
  generate: (v: Vector, transcript: Turn[]) => Promise<Field[] | null>;  // returns PROPOSALS
  generating: boolean;
  onSave: () => void;
  onPush: () => void;
  pushLabel?: string;
  dirty: boolean;
  savingBusy: boolean;
  initialParent?: string | null;            // preselect the attach point (from a node's "Branch off")
}) {
  const supabase = createClient();
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [why, setWhy] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // AI proposals awaiting the human's verdict — the review queue.
  const [proposals, setProposals] = useState<Field[]>([]);

  // Guided add form.
  const [adding, setAdding] = useState(initialParent !== undefined && initialParent !== null);
  const [addParent, setAddParent] = useState<string>(initialParent ?? "");
  const [addLabel, setAddLabel] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addWeight, setAddWeight] = useState<number | null>(null); // null = suggested

  const existingKeys = useMemo(() => new Set(entries.map((e) => e.f.field_key)), [entries]);
  const parentOf = (key: string) => entries.find((e) => e.f.field_key === key)?.f ?? null;
  // Suggested weight from the attach point: hub roots a defining branch (3);
  // a child sits one step further out than its parent.
  const suggestedWeight = addParent ? Math.max(1, ((parentOf(addParent)?.weight ?? 2) - 1)) : 3;
  const effWeight = addWeight ?? suggestedWeight;

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
  useEffect(() => { setTranscript([]); setQuestion(""); setWhy(""); setAnswer(""); setDone(false); setErr(null); setProposals([]); void nextQuestion([]); }, [nextQuestion]);

  async function submitAnswer() {
    if (!answer.trim()) return;
    const t = [...transcript, { role: "a" as const, text: answer.trim() }];
    setTranscript(t); setAnswer("");
    await nextQuestion(t);
  }

  async function propose() {
    setErr(null);
    const incoming = await generate(vector, transcript);
    if (incoming) setProposals(incoming.filter((f) => f.label.trim()));
  }

  function acceptProposal(p: Field) {
    upsertNode(p);
    setProposals((ps) => ps.filter((x) => x.field_key !== p.field_key));
  }
  function discardProposal(p: Field) {
    setProposals((ps) => ps.filter((x) => x.field_key !== p.field_key));
  }
  function patchProposal(key: string, patch: Partial<Field>) {
    setProposals((ps) => ps.map((x) => (x.field_key === key ? { ...x, ...patch } : x)));
  }

  function addGuided() {
    if (!addLabel.trim()) return;
    let key = slugify(addLabel);
    while (existingKeys.has(key)) key = `${key}_x`;
    upsertNode({ field_key: key, label: addLabel.trim(), value: addValue.trim(), origin: "human", vector, weight: effWeight, parent_key: addParent || null });
    setAdding(false); setAddParent(""); setAddLabel(""); setAddValue(""); setAddWeight(null);
  }

  const proposalParentName = (p: Field) => {
    const src = p.parent_key ? (parentOf(p.parent_key)?.label ?? proposals.find((x) => x.field_key === p.parent_key)?.label) : null;
    return src ?? null;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 500, maxWidth: "95vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
          <div style={{ minWidth: 0 }}>
            <div className="t-h2" style={{ fontSize: 15 }}>{label} vector</div>
            <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{blurb}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>‹ Network</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {err && <div className="banner banner-err">{err}</div>}

          {/* Interview — records-aware questions that feed the proposals */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ marginBottom: 8 }}>Build with AI <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— reads your records, asks what they don&apos;t answer, then proposes nodes for review</span></div>
            {transcript.filter((t) => t.role === "a").length > 0 && (
              <div className="stack-2" style={{ marginBottom: 10 }}>
                {transcript.map((t, k) => (
                  <div key={k} className="t-sub" style={{ fontSize: 12.5, color: t.role === "q" ? "var(--tm)" : "var(--tp)" }}>{t.role === "q" ? "Q: " : "A: "}{t.text}</div>
                ))}
              </div>
            )}
            {asking ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Thinking…</div>
              : done ? <div className="t-sub" style={{ fontSize: 12.5, color: "var(--gn-text)" }}>Enough to propose nodes for this vector — or add your own below.</div>
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
              <button className="btn btn-sm" style={{ width: "100%" }} onClick={propose} disabled={generating}>
                {generating ? "Proposing nodes…" : "Propose nodes (each one is yours to accept)"}
              </button>
            </div>
          </div>

          {/* The review queue — every AI node passes through your hands */}
          {proposals.length > 0 && (
            <div className="card card-pad" style={{ borderColor: "var(--vl)", borderWidth: 1 }}>
              <div className="row-between" style={{ marginBottom: 8, alignItems: "center" }}>
                <div className="t-label">Proposed · {proposals.length} <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— accept, edit, or discard each</span></div>
                <div className="row gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => setProposals([])}>Discard all</button>
                  <button className="btn btn-sm" onClick={() => { proposals.forEach(upsertNode); setProposals([]); }}>Accept all</button>
                </div>
              </div>
              <div className="stack-2">
                {proposals.map((p) => (
                  <div key={p.field_key} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    <div className="row-between" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <input className="input" value={p.label} onChange={(e) => patchProposal(p.field_key, { label: e.target.value })} style={{ fontWeight: 620, fontSize: 13, maxWidth: 220 }} />
                      <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                        <select className="select" value={Math.min(3, Math.max(1, p.weight ?? 2))} onChange={(e) => patchProposal(p.field_key, { weight: Number(e.target.value) })} style={{ fontSize: 11.5, padding: "3px 6px" }} title="Weight — closeness to the center">
                          {[3, 2, 1].map((w) => <option key={w} value={w}>{WLABEL(w)}</option>)}
                        </select>
                        <button className="btn btn-secondary btn-sm" onClick={() => discardProposal(p)} style={{ color: "var(--rd-text)" }}>Discard</button>
                        <button className="btn btn-sm" onClick={() => acceptProposal(p)}>Accept</button>
                      </div>
                    </div>
                    {proposalParentName(p) && <div className="t-mono-xs t-muted" style={{ marginBottom: 4 }}>branches off: {proposalParentName(p)}</div>}
                    <textarea className="textarea" rows={2} value={p.value} onChange={(e) => patchProposal(p.field_key, { value: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The vector's nodes — the accepted branch, always editable */}
          <div className="t-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Nodes · {entries.length}</span>
            {!adding && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add node</button>}
          </div>

          {/* Guided add — where it attaches decides what it means */}
          {adding && (
            <div className="card card-pad" style={{ borderColor: "var(--ac)", borderWidth: 1 }}>
              <div className="t-label" style={{ marginBottom: 8 }}>New node</div>
              <label className="field"><span className="t-label">Attaches to <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— the hub starts a new branch; a node grows its chain</span></span>
                <select className="select" value={addParent} onChange={(e) => { setAddParent(e.target.value); setAddWeight(null); }}>
                  <option value="">The {label} hub (new branch)</option>
                  {entries.map(({ f }) => <option key={f.field_key} value={f.field_key}>{f.label} ({WLABEL(f.weight)})</option>)}
                </select></label>
              <label className="field"><span className="t-label">Name</span>
                <input className="input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Short name — e.g. a rival, a vertical, a persona, a capability" /></label>
              <label className="field"><span className="t-label">Statement <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— a declarative fact about you, search-actionable</span></span>
                <textarea className="textarea" rows={3} value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="e.g. 'Mid-market PLG teams are our core buyers — their signal lives in PLG communities and RevOps job posts.'" /></label>
              <label className="field"><span className="t-label">Weight</span>
                <select className="select" value={effWeight} onChange={(e) => setAddWeight(Number(e.target.value))}>
                  {[3, 2, 1].map((w) => <option key={w} value={w}>{WLABEL(w)} — {WHY_WEIGHT[w]}</option>)}
                </select></label>
              {addWeight === null && <div className="t-mono-xs t-muted" style={{ marginTop: -4, marginBottom: 8 }}>suggested from where it attaches — adjust if it matters more or less</div>}
              <div className="row gap-2">
                <button className="btn btn-sm" onClick={addGuided} disabled={!addLabel.trim()}>Add node</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setAddParent(""); setAddLabel(""); setAddValue(""); setAddWeight(null); }}>Cancel</button>
              </div>
            </div>
          )}

          {entries.length === 0 && !adding ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No nodes yet — build with AI above (you review every proposal), or add one by hand.</div> : (
            <div className="stack-2">
              {entries.map(({ f, i }) => (
                <div key={f.field_key} className="card card-pad">
                  <div className="row-between" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
                    <input className="input" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} style={{ fontWeight: 620, fontSize: 13, maxWidth: 220 }} />
                    <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                      <select className="select" value={Math.min(3, Math.max(1, f.weight ?? 2))} onChange={(e) => setField(i, { weight: Number(e.target.value) })} style={{ fontSize: 11.5, padding: "3px 6px" }} title="Weight — closeness to the center">
                        {[3, 2, 1].map((w) => <option key={w} value={w}>{WLABEL(w)}</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm" onClick={() => removeField(i)} style={{ color: "var(--rd-text)" }}>✕</button>
                    </div>
                  </div>
                  <textarea className="textarea" rows={2} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} placeholder="A statement about you (e.g. 'AI-built working prototypes are our core battleground')." />
                  <label className="field" style={{ marginTop: 6, marginBottom: 0 }}>
                    <span className="t-mono-xs t-muted">branches off</span>
                    <select className="select" value={f.parent_key && entries.some((e2) => e2.f.field_key === f.parent_key) ? f.parent_key : ""} onChange={(e) => setField(i, { parent_key: e.target.value || null })} style={{ fontSize: 11.5, padding: "3px 6px" }}>
                      <option value="">The {label} hub</option>
                      {entries.filter((e2) => e2.f.field_key !== f.field_key).map(({ f: p }) => <option key={p.field_key} value={p.field_key}>{p.label}</option>)}
                    </select>
                  </label>
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
