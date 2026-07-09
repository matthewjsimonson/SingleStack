"use client";

// VectorCurator — a vector's full-width working surface on the Signals profile
// workbench. No graph, no drawer: a plain, readable board where you manage,
// set up, and optimize one vector of the signals profile. All HITL:
//   • Build with AI: a records-aware interview (one question at a time) feeds
//     PROPOSED nodes — full-width cards you accept, edit, or discard;
//   • Nodes: the vector's branch as an indented tree — every statement fully
//     visible, editable in place, expandable for weight/parent/AI-refine/
//     sources without leaving the list;
//   • Guided add: pick where a node attaches (the vector roots a new branch;
//     a node grows its chain) — weight suggested from where it sits;
//   • Signals: what this vector's pulls actually brought in, dismissable here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Vector } from "@/components/SignalProfile";
import NodeSources from "@/components/NodeSources";
import { compileVectorBrief, compileNodeBrief } from "@/lib/profileBrief";
import { edgeErrorMessage } from "@/lib/edgeError";

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector; weight?: number; parent_key?: string | null };
type Turn = { role: "q" | "a"; text: string };

// One level vocabulary across every focus: how DIRECT the signal is.
// Direct = your ground, searched first; adjacent = one step out, tracked
// steadily; indirect = the horizon, caught but not chased.
const VOCAB = (_v?: string): Record<number, string> => ({ 3: "Direct", 2: "Adjacent", 1: "Indirect" });
const WHY_WEIGHT = (_v?: string): Record<number, string> => ({
  3: "direct — your ground, searched first",
  2: "adjacent — one step out, tracked steadily",
  1: "indirect — the horizon, caught but not chased",
});
const W_OF = (w?: number) => Math.min(3, Math.max(1, w ?? 2));

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "node";

export default function VectorCurator({
  vector, label, blurb, entries, setField, removeField, upsertNode, generate, generating,
  refineNode, refining, onSave, onPush, pushLabel, dirty, savingBusy, initialAdd,
}: {
  vector: Vector;
  label: string;
  blurb: string;
  entries: { f: Field; i: number }[];       // this vector's nodes + their global index
  setField: (i: number, patch: Partial<Field>) => void;
  removeField: (i: number) => void;
  upsertNode: (f: Field) => void;           // add (or replace by field_key) one reviewed node
  generate: (v: Vector, transcript: Turn[]) => Promise<Field[] | null>;  // returns PROPOSALS
  generating: boolean;
  refineNode: (i: number, instruction: string) => Promise<void>;  // AI-sharpen one node
  refining: boolean;
  onSave: () => void;
  onPush: () => void;
  pushLabel?: string;
  dirty: boolean;
  savingBusy: boolean;
  initialAdd?: { weight: number; at: number } | null;  // coverage-map gap click: open the add form at this level
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

  // Which node row is expanded for deep editing.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");

  // Guided add form.
  const [adding, setAdding] = useState(false);
  const [addParent, setAddParent] = useState<string>("");
  const [addLabel, setAddLabel] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addWeight, setAddWeight] = useState<number | null>(null); // null = suggested

  const existingKeys = useMemo(() => new Set(entries.map((e) => e.f.field_key)), [entries]);
  const parentOf = (key: string) => entries.find((e) => e.f.field_key === key)?.f ?? null;
  // Suggested weight from the attach point: the vector roots a defining branch
  // (3); a child sits one step further out than its parent.
  const suggestedWeight = addParent ? Math.max(1, ((parentOf(addParent)?.weight ?? 2) - 1)) : 3;
  const effWeight = addWeight ?? suggestedWeight;

  // The branch as a TREE: depth-first order (roots by weight, children under
  // their parent) so the list reads as the structure it is.
  const tree = useMemo(() => {
    const byKey = new Map(entries.map((e) => [e.f.field_key, e]));
    const kidsOf = new Map<string, typeof entries>();
    const roots: typeof entries = [];
    for (const e of entries) {
      const p = e.f.parent_key && e.f.parent_key !== e.f.field_key && byKey.has(e.f.parent_key) ? e.f.parent_key : null;
      if (p) kidsOf.set(p, [...(kidsOf.get(p) ?? []), e]);
      else roots.push(e);
    }
    const byW = (a: { f: Field }, b: { f: Field }) => W_OF(b.f.weight) - W_OF(a.f.weight);
    const out: { e: (typeof entries)[number]; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (e: (typeof entries)[number], depth: number) => {
      if (seen.has(e.f.field_key)) return;
      seen.add(e.f.field_key);
      out.push({ e, depth });
      (kidsOf.get(e.f.field_key) ?? []).sort(byW).forEach((k) => walk(k, depth + 1));
    };
    roots.sort(byW).forEach((r) => walk(r, 0));
    return out;
  }, [entries]);

  // Pull the next interview question for this vector.
  const nextQuestion = useCallback(async (t: Turn[]) => {
    setAsking(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector, step: "interview", transcript: t } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.done || !data?.question) { setDone(true); setQuestion(""); setWhy(""); }
      else { setQuestion(data.question); setWhy(data.why ?? ""); setTranscript([...t, { role: "q", text: data.question }]); }
    } catch (e) { setErr(await edgeErrorMessage(e, "synthesize-profile")); }
    finally { setAsking(false); }
  }, [supabase, vector]);

  // Fresh state each time the vector changes.
  useEffect(() => { setTranscript([]); setQuestion(""); setWhy(""); setAnswer(""); setDone(false); setErr(null); setProposals([]); setOpenKey(null); setAdding(false); setAddParent(""); void nextQuestion([]); }, [nextQuestion]);

  // A coverage-map gap click opens the guided add at that level (declared
  // AFTER the reset effect so it wins the mount-order race on a focus switch).
  useEffect(() => {
    if (initialAdd) { setAdding(true); setAddParent(""); setAddLabel(""); setAddValue(""); setAddWeight(initialAdd.weight); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAdd?.at]);

  // The vector's recent SIGNALS — what its pulls actually brought in.
  type Sig = { id: string; title: string; origin: string; observed_at: string | null };
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [sigBusy, setSigBusy] = useState<string | null>(null);
  const loadSigs = useCallback(async () => {
    const { data } = await supabase.from("signals").select("id, title, origin, observed_at")
      .eq("metadata->>vector", vector)
      .order("observed_at", { ascending: false, nullsFirst: false }).limit(8);
    setSigs((data ?? []) as Sig[]);
  }, [supabase, vector]);
  useEffect(() => { loadSigs(); }, [loadSigs]);
  async function dismissSig(id: string) {
    setSigBusy(id);
    const { error } = await supabase.from("signals").delete().eq("id", id);
    if (error) setErr(error.message); else await loadSigs();
    setSigBusy(null);
  }

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
  function patchProposal(key: string, patch: Partial<Field>) {
    setProposals((ps) => ps.map((x) => (x.field_key === key ? { ...x, ...patch } : x)));
  }

  function startAdd(parent: string) {
    setAdding(true); setAddParent(parent); setAddLabel(""); setAddValue(""); setAddWeight(null);
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

  const fieldsOnly = entries.map((e) => e.f);

  return (
    <div className="stack-3">
      {err && <div className="banner banner-err">{err}</div>}

      {/* Build with AI — the interview feeds proposals; every node passes your hands */}
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
          : done ? <div className="t-sub" style={{ fontSize: 12.5, color: "var(--gn-text)" }}>Enough to propose nodes for this focus — or add your own below.</div>
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
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }} className="row gap-2">
          <button className="btn btn-sm" onClick={propose} disabled={generating}>
            {generating ? "Proposing nodes…" : "Propose nodes"}
          </button>
          <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>each proposal is yours to accept, edit, or discard</span>
        </div>
      </div>

      {/* The review queue — full-width, fully readable */}
      {proposals.length > 0 && (
        <div className="card card-pad" style={{ borderColor: "var(--vl)" }}>
          <div className="row-between" style={{ marginBottom: 10, alignItems: "center" }}>
            <div className="t-label">Proposed · {proposals.length}</div>
            <div className="row gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => setProposals([])}>Discard all</button>
              <button className="btn btn-sm" onClick={() => { proposals.forEach(upsertNode); setProposals([]); }}>Accept all</button>
            </div>
          </div>
          <div className="stack-2">
            {proposals.map((p) => (
              <div key={p.field_key} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                <div className="row-between" style={{ gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="input" value={p.label} onChange={(e) => patchProposal(p.field_key, { label: e.target.value })} style={{ fontWeight: 620, fontSize: 13.5, flex: 1, minWidth: 220 }} />
                  <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                    <select className="select" value={W_OF(p.weight)} onChange={(e) => patchProposal(p.field_key, { weight: Number(e.target.value) })} style={{ fontSize: 12 }}>
                      {[3, 2, 1].map((w) => <option key={w} value={w}>{VOCAB(vector)[w]}</option>)}
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={() => setProposals((ps) => ps.filter((x) => x.field_key !== p.field_key))} style={{ color: "var(--rd-text)" }}>Discard</button>
                    <button className="btn btn-sm" onClick={() => acceptProposal(p)}>Accept</button>
                  </div>
                </div>
                {proposalParentName(p) && <div className="t-mono-xs t-muted" style={{ marginBottom: 6 }}>branches off: {proposalParentName(p)}</div>}
                <textarea className="textarea" rows={3} value={p.value} onChange={(e) => patchProposal(p.field_key, { value: e.target.value })} style={{ width: "100%" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The nodes — the branch as an indented, readable tree */}
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 10, alignItems: "center" }}>
          <div className="t-label">Nodes · {entries.length}</div>
          <div className="row gap-2">
            {!adding && <button className="btn btn-secondary btn-sm" onClick={() => startAdd("")}>+ Add node</button>}
            <button className="btn btn-sm" onClick={onSave} disabled={!dirty || savingBusy}>{savingBusy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
            {pushLabel && <button className="btn btn-secondary btn-sm" onClick={onPush} title={dirty ? "Save first" : `Apply this vector in ${pushLabel}`}>Push to {pushLabel} →</button>}
          </div>
        </div>

        {/* Guided add — where it attaches decides what it means */}
        {adding && (
          <div className="card card-pad" style={{ borderColor: "var(--ac)", marginBottom: 10 }}>
            <div className="t-label" style={{ marginBottom: 8 }}>New node</div>
            <label className="field"><span className="t-label">Attaches to <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— the vector starts a new branch; a node grows its chain</span></span>
              <select className="select" value={addParent} onChange={(e) => { setAddParent(e.target.value); setAddWeight(null); }}>
                <option value="">The {label} focus (new branch)</option>
                {entries.map(({ f }) => <option key={f.field_key} value={f.field_key}>{f.label} ({VOCAB(vector)[W_OF(f.weight)]})</option>)}
              </select></label>
            <label className="field"><span className="t-label">Name</span>
              <input className="input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Short name — e.g. a rival, a segment, a persona, a capability" /></label>
            <label className="field"><span className="t-label">Statement <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— a declarative fact about you, search-actionable</span></span>
              <textarea className="textarea" rows={3} value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="A declarative fact about you, plus where its signal lives — specific enough that search knows what to hunt." /></label>
            <label className="field"><span className="t-label">Weight</span>
              <select className="select" value={effWeight} onChange={(e) => setAddWeight(Number(e.target.value))}>
                {[3, 2, 1].map((w) => <option key={w} value={w}>{VOCAB(vector)[w]} — {WHY_WEIGHT(vector)[w]}</option>)}
              </select></label>
            {addWeight === null && <div className="t-mono-xs t-muted" style={{ marginTop: -4, marginBottom: 8 }}>suggested from where it attaches — adjust if it matters more or less</div>}
            <div className="row gap-2">
              <button className="btn btn-sm" onClick={addGuided} disabled={!addLabel.trim()}>Add node</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        {tree.length === 0 && !adding ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No nodes yet — build with AI above (you review every proposal), or add one by hand.</div>
        ) : (
          <div className="stack-2">
            {tree.map(({ e: { f, i }, depth }) => {
              const isOpen = openKey === f.field_key;
              const kids = entries.filter((e2) => e2.f.parent_key === f.field_key).length;
              return (
                <div key={f.field_key} style={{ marginLeft: Math.min(3, depth) * 22 }} className="card" >
                  {/* Row: everything readable at rest; click the name area to expand */}
                  <div style={{ padding: "10px 12px", cursor: "pointer" }} onClick={() => { setOpenKey(isOpen ? null : f.field_key); setRefineText(""); }}>
                    <div className="row-between" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                        {depth > 0 && <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>└</span>}
                        <span style={{ fontWeight: 630, fontSize: 13.5 }}>{f.label || "Unnamed node"}</span>
                        <span className="chip" style={{ fontSize: 10.5, padding: "1px 7px", background: "var(--fill)", borderRadius: 999, color: "var(--ts)", flexShrink: 0 }}>{VOCAB(vector)[W_OF(f.weight)]}</span>
                        {f.origin === "ai" && <span className="t-mono-xs" style={{ color: "var(--vl-text)", flexShrink: 0 }}>AI</span>}
                        {kids > 0 && <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{kids} branch{kids === 1 ? "" : "es"}</span>}
                      </div>
                      <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{isOpen ? "close" : "edit"}</span>
                    </div>
                    {/* the WHOLE statement, always visible — no clipping */}
                    {f.value.trim() && !isOpen && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>{f.value}</div>}
                  </div>

                  {isOpen && (
                    <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--border)" }} className="stack-2" onClick={(ev) => ev.stopPropagation()}>
                      <label className="field" style={{ marginTop: 10 }}><span className="t-label">Name</span>
                        <input className="input" value={f.label} onChange={(ev) => setField(i, { label: ev.target.value })} /></label>
                      <label className="field"><span className="t-label">Statement</span>
                        <textarea className="textarea" rows={4} value={f.value} onChange={(ev) => setField(i, { value: ev.target.value })} placeholder="A declarative fact about you — name the thing and assert what's true of it, so search knows what to hunt." /></label>
                      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                        <label className="field" style={{ flex: 1, minWidth: 160 }}><span className="t-label">Weight</span>
                          <select className="select" value={W_OF(f.weight)} onChange={(ev) => setField(i, { weight: Number(ev.target.value) })}>
                            {[3, 2, 1].map((w) => <option key={w} value={w}>{VOCAB(vector)[w]} — {WHY_WEIGHT(vector)[w]}</option>)}
                          </select></label>
                        <label className="field" style={{ flex: 1, minWidth: 160 }}><span className="t-label">Branches off</span>
                          <select className="select" value={f.parent_key && entries.some((e2) => e2.f.field_key === f.parent_key) ? f.parent_key : ""} onChange={(ev) => setField(i, { parent_key: ev.target.value || null })}>
                            <option value="">The {label} focus</option>
                            {entries.filter((e2) => e2.f.field_key !== f.field_key).map(({ f: p }) => <option key={p.field_key} value={p.field_key}>{p.label}</option>)}
                          </select></label>
                      </div>
                      {/* Refine with AI — sharpen, or steer with an instruction */}
                      <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                        <div className="t-label" style={{ marginBottom: 6 }}>Refine with AI</div>
                        <textarea className="textarea" rows={2} value={refineText} onChange={(ev) => setRefineText(ev.target.value)} placeholder="Optional: how to change it — e.g. 'more specific', 'split out the adjacent angle', 'this is edge, not core'." />
                        <div className="row gap-2" style={{ marginTop: 8 }}>
                          <button className="btn btn-sm" onClick={() => refineNode(i, refineText)} disabled={refining}>{refining ? "Refining…" : refineText.trim() ? "Apply" : "Sharpen"}</button>
                          <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>grounded in your records</span>
                        </div>
                      </div>
                      {/* What this node tells the brain — the live pull steer */}
                      <details>
                        <summary className="t-sub t-muted" style={{ fontSize: 11.5, cursor: "pointer" }}>What this node tells the brain (the live pull steer)</summary>
                        <div className="t-mono-xs" style={{ whiteSpace: "pre-wrap", color: "var(--ts)", lineHeight: 1.55, marginTop: 6, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>{compileNodeBrief(fieldsOnly, f.field_key) || "Give the node a statement — that statement becomes the search steer."}</div>
                      </details>
                      {/* This node's own sources */}
                      <NodeSources vector={vector} nodeKey={f.field_key} seed={compileNodeBrief(fieldsOnly, f.field_key)} />
                      <div className="row-between">
                        <button className="btn btn-secondary btn-sm" onClick={() => { removeField(i); setOpenKey(null); }} style={{ color: "var(--rd-text)" }}>Remove node</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => startAdd(f.field_key)}>+ Branch off this node</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* What this focus tells the brain — the steer every pull inherits */}
      {entries.length > 0 && (
        <details className="card card-pad">
          <summary className="t-label" style={{ cursor: "pointer" }}>What this focus tells the brain <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— compiled live into every pull aimed at this focus</span></summary>
          <div className="t-mono-xs" style={{ whiteSpace: "pre-wrap", color: "var(--ts)", lineHeight: 1.55, marginTop: 8 }}>{compileVectorBrief(fieldsOnly, vector)}</div>
        </details>
      )}

      {/* Vector-level sources — feed every node in this arm */}
      <NodeSources vector={vector} nodeKey={null}
        seed={compileVectorBrief(fieldsOnly, vector)
          || fieldsOnly.filter((f) => W_OF(f.weight) >= 2).map((f) => f.value).join(" · ").slice(0, 600)} />

      {/* The vector's recent signals — control what the pulls brought in */}
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 8, alignItems: "center" }}>
          <div className="t-label">Recent signals <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— what your pulls for this focus brought in</span></div>
          <button className="btn btn-secondary btn-sm" onClick={loadSigs}>Refresh</button>
        </div>
        {sigs.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Nothing pulled for this focus yet — add a source above and Pull, or let the scheduled pulls run.</div>
        ) : (
          <div className="stack-2">
            {sigs.map((s) => (
              <div key={s.id} className="row-between" style={{ gap: 8, alignItems: "baseline" }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 12.5 }}>{s.title}</span>
                  <span className="t-mono-xs t-muted" style={{ marginLeft: 8 }}>{s.origin}{s.observed_at ? ` · ${new Date(s.observed_at).toLocaleDateString()}` : ""}</span>
                </div>
                <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0, color: "var(--rd-text)" }} disabled={sigBusy === s.id} onClick={() => dismissSig(s.id)}>{sigBusy === s.id ? "…" : "Dismiss"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
