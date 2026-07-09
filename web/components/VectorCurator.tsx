"use client";

// VectorCurator — a focus's working surface on the Signals profile workbench.
// The page holds the OVERVIEW (the focus's nodes as a readable tree, sources,
// recent signals); all reading, editing, and ratifying happens in CENTERED,
// TALL POP-UPS that keep your place on the page underneath:
//   • click a node → its editor opens as a vertical-rectangle modal (full
//     statement, weight, branch parent, AI refine, pull steer, sources);
//   • + Add node → the guided add opens the same way;
//   • AI proposals open a REVIEW modal you PAN through — one proposal at a
//     time, prev/next, Accept or Discard each (nothing lands unreviewed,
//     nothing saves until Save).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Vector } from "@/components/SignalProfile";
import NodeSources from "@/components/NodeSources";
import { Modal } from "@/components/ui";
import { compileVectorBrief, compileNodeBrief } from "@/lib/profileBrief";
import { edgeErrorMessage } from "@/lib/edgeError";

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector; weight?: number; parent_key?: string | null };
type Turn = { role: "q" | "a"; text: string };

// One level vocabulary across every focus: how DIRECT the signal is.
const VOCAB: Record<number, string> = { 3: "Direct", 2: "Adjacent", 1: "Indirect" };
const WHY_WEIGHT: Record<number, string> = {
  3: "direct — your ground, searched first",
  2: "adjacent — one step out, tracked steadily",
  1: "indirect — the horizon, caught but not chased",
};
const W_OF = (w?: number) => Math.min(3, Math.max(1, w ?? 2));

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "node";

export default function VectorCurator({
  vector, label, blurb, entries, setField, removeField, upsertNode, generate, generating,
  refineNode, refining, onSave, onPush, pushLabel, dirty, savingBusy, initialAdd,
}: {
  vector: Vector;
  label: string;
  blurb: string;
  entries: { f: Field; i: number }[];       // this focus's nodes + their global index
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
  initialAdd?: { weight: number; at: number } | null;  // coverage-map gap click: open the add pop-up at this level
}) {
  const supabase = createClient();
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [why, setWhy] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // AI proposals awaiting the human's verdict + the pan position of the
  // review pop-up (null = closed).
  const [proposals, setProposals] = useState<Field[]>([]);
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  // The Q&A interview runs in its own pop-up (a setup workflow reads better
  // in a tall centered window than in an inline card).
  const [interviewOpen, setInterviewOpen] = useState(false);

  // Which node's editor pop-up is open.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");

  // Guided add pop-up.
  const [adding, setAdding] = useState(false);
  const [addParent, setAddParent] = useState<string>("");
  const [addLabel, setAddLabel] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addWeight, setAddWeight] = useState<number | null>(null); // null = suggested

  const existingKeys = useMemo(() => new Set(entries.map((e) => e.f.field_key)), [entries]);
  const parentOf = (key: string) => entries.find((e) => e.f.field_key === key)?.f ?? null;
  // Suggested weight from the attach point: the focus roots a direct branch
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

  // Pull the next interview question for this focus.
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

  // Fresh state each time the focus changes.
  useEffect(() => { setTranscript([]); setQuestion(""); setWhy(""); setAnswer(""); setDone(false); setErr(null); setProposals([]); setReviewIdx(null); setOpenKey(null); setAdding(false); setAddParent(""); void nextQuestion([]); }, [nextQuestion]);

  // A coverage-map gap click opens the guided add at that level (declared
  // AFTER the reset effect so it wins the mount-order race on a focus switch).
  useEffect(() => {
    if (initialAdd) { setAdding(true); setAddParent(""); setAddLabel(""); setAddValue(""); setAddWeight(initialAdd.weight); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAdd?.at]);

  // The focus's recent SIGNALS — what its pulls actually brought in.
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
    if (incoming) {
      const clean = incoming.filter((f) => f.label.trim());
      setProposals(clean);
      setInterviewOpen(false);                 // the interview hands off…
      setReviewIdx(clean.length ? 0 : null);   // …to the review pop-up, first proposal up
    }
  }

  // Review pan helpers — Accept/Discard act on the CURRENT proposal and move on.
  function resolveProposal(accept: boolean) {
    if (reviewIdx == null) return;
    const p = proposals[reviewIdx];
    if (!p) return;
    if (accept) upsertNode(p);
    const next = proposals.filter((_, j) => j !== reviewIdx);
    setProposals(next);
    if (!next.length) setReviewIdx(null);
    else setReviewIdx(Math.min(reviewIdx, next.length - 1));
  }
  function patchProposal(idx: number, patch: Partial<Field>) {
    setProposals((ps) => ps.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
  }

  function startAdd(parent: string) {
    setAdding(true); setAddParent(parent); setAddLabel(""); setAddValue(""); setAddWeight(null); setOpenKey(null);
  }
  function addGuided() {
    if (!addLabel.trim()) return;
    let key = slugify(addLabel);
    while (existingKeys.has(key)) key = `${key}_x`;
    upsertNode({ field_key: key, label: addLabel.trim(), value: addValue.trim(), origin: "human", vector, weight: effWeight, parent_key: addParent || null });
    setAdding(false); setAddParent(""); setAddLabel(""); setAddValue(""); setAddWeight(null);
  }

  const fieldsOnly = entries.map((e) => e.f);
  const openEntry = openKey ? entries.find((e) => e.f.field_key === openKey) ?? null : null;
  const reviewing = reviewIdx != null ? proposals[reviewIdx] : null;

  return (
    <div className="stack-3">
      {err && <div className="banner banner-err">{err}</div>}

      {/* Build with AI — the interview + proposals run in pop-ups; the page
          just offers the way in */}
      <div className="card card-pad row-between" style={{ background: "var(--panel-2)", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t-label">Build with AI</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Reads your records, asks what they don&apos;t answer, then proposes nodes you review one by one.</div>
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          {proposals.length > 0 && reviewIdx == null && (
            <button className="btn btn-secondary btn-sm" onClick={() => setReviewIdx(0)}>Review {proposals.length} proposal{proposals.length === 1 ? "" : "s"}</button>
          )}
          <button className="btn btn-sm" onClick={() => setInterviewOpen(true)} disabled={generating}>
            {generating ? "Proposing nodes…" : "Build with AI"}
          </button>
        </div>
      </div>

      {/* ---- INTERVIEW pop-up — the Q&A setup workflow, one question at a
              time in a tall centered window ---- */}
      <Modal open={interviewOpen} onClose={() => setInterviewOpen(false)} width={640} tall
        title={`Build the ${label} focus`}>
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <div className="stack-3" style={{ flex: 1 }}>
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{blurb} It reads your records first and only asks what they don&apos;t answer — answer, skip, or stop anytime; then it proposes nodes you accept one by one.</div>
            {transcript.filter((t) => t.role === "a").length > 0 && (
              <div className="stack-2" style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
                {transcript.map((t, k) => (
                  <div key={k} className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55, color: t.role === "q" ? "var(--tm)" : "var(--tp)" }}>{t.role === "q" ? "Q: " : "A: "}{t.text}</div>
                ))}
              </div>
            )}
            {asking ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Thinking about what to ask…</div>
              : done ? <div className="t-sub" style={{ fontSize: 13, color: "var(--gn-text)" }}>Enough to propose nodes for this focus.</div>
              : question ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 630, lineHeight: 1.45 }}>{question}</div>
                  {why && <div className="t-sub t-muted" style={{ fontSize: 12 }}>{why}</div>}
                  <textarea className="textarea" rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer — or skip" autoFocus />
                  <div className="row gap-2">
                    <button className="btn" onClick={submitAnswer} disabled={!answer.trim()}>Answer →</button>
                    <button className="btn btn-secondary" onClick={() => setDone(true)}>Skip / enough</button>
                  </div>
                </>
              ) : null}
          </div>
          <div className="row-between" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12, alignItems: "center" }}>
            <span className="t-sub t-muted" style={{ fontSize: 12 }}>{transcript.filter((t) => t.role === "a").length} answered</span>
            <button className="btn" onClick={propose} disabled={generating}>
              {generating ? "Proposing nodes…" : "Propose nodes →"}
            </button>
          </div>
        </div>
      </Modal>

      {/* The nodes — the branch as an indented, readable tree; click to open */}
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 10, alignItems: "center" }}>
          <div className="t-label">Nodes · {entries.length}</div>
          <div className="row gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => startAdd("")}>+ Add node</button>
            <button className="btn btn-sm" onClick={onSave} disabled={!dirty || savingBusy}>{savingBusy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
            {pushLabel && <button className="btn btn-secondary btn-sm" onClick={onPush} title={dirty ? "Save first" : `Apply this focus in ${pushLabel}`}>Push to {pushLabel} →</button>}
          </div>
        </div>
        {tree.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No nodes yet — build with AI above (you review every proposal), or add one by hand.</div>
        ) : (
          <div className="stack-2">
            {tree.map(({ e: { f }, depth }) => {
              const kids = entries.filter((e2) => e2.f.parent_key === f.field_key).length;
              return (
                <div key={f.field_key} className="card" style={{ marginLeft: Math.min(3, depth) * 22, padding: "10px 12px", cursor: "pointer" }}
                  onClick={() => { setOpenKey(f.field_key); setRefineText(""); }}>
                  <div className="row-between" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                      {depth > 0 && <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>└</span>}
                      <span style={{ fontWeight: 630, fontSize: 13.5 }}>{f.label || "Unnamed node"}</span>
                      <span style={{ fontSize: 10.5, padding: "1px 7px", background: "var(--fill)", borderRadius: 999, color: "var(--ts)", flexShrink: 0 }}>{VOCAB[W_OF(f.weight)]}</span>
                      {f.origin === "ai" && <span className="t-mono-xs" style={{ color: "var(--vl-text)", flexShrink: 0 }}>AI</span>}
                      {kids > 0 && <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{kids} branch{kids === 1 ? "" : "es"}</span>}
                    </div>
                    <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>open</span>
                  </div>
                  {f.value.trim() && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>{f.value}</div>}
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

      {/* Focus-level sources — feed every node in this branch */}
      <NodeSources vector={vector} nodeKey={null}
        seed={compileVectorBrief(fieldsOnly, vector)
          || fieldsOnly.filter((f) => W_OF(f.weight) >= 2).map((f) => f.value).join(" · ").slice(0, 600)} />

      {/* The focus's recent signals — control what the pulls brought in */}
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

      {/* ---- NODE EDITOR pop-up — a tall centered rectangle; the page (and
              your place on it) stays underneath ---- */}
      {openEntry && (() => {
        const { f, i } = openEntry;
        const parent = f.parent_key ? parentOf(f.parent_key) : null;
        return (
          <Modal open onClose={() => setOpenKey(null)} title={f.label || "Node"} width={640} tall>
            <div className="stack-3">
              <label className="field"><span className="t-label">Name</span>
                <input className="input" value={f.label} onChange={(ev) => setField(i, { label: ev.target.value })} /></label>
              <label className="field"><span className="t-label">Statement <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— a declarative fact about you, search-actionable</span></span>
                <textarea className="textarea" rows={9} value={f.value} onChange={(ev) => setField(i, { value: ev.target.value })} placeholder="A declarative fact about you — name the thing and assert what's true of it, so search knows what to hunt." /></label>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                <label className="field" style={{ flex: 1, minWidth: 180 }}><span className="t-label">Level</span>
                  <select className="select" value={W_OF(f.weight)} onChange={(ev) => setField(i, { weight: Number(ev.target.value) })}>
                    {[3, 2, 1].map((w) => <option key={w} value={w}>{VOCAB[w]} — {WHY_WEIGHT[w]}</option>)}
                  </select></label>
                <label className="field" style={{ flex: 1, minWidth: 180 }}><span className="t-label">Branches off</span>
                  <select className="select" value={parent ? f.parent_key! : ""} onChange={(ev) => setField(i, { parent_key: ev.target.value || null })}>
                    <option value="">The {label} focus</option>
                    {entries.filter((e2) => e2.f.field_key !== f.field_key).map(({ f: p }) => <option key={p.field_key} value={p.field_key}>{p.label}</option>)}
                  </select></label>
              </div>
              <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                <div className="t-label" style={{ marginBottom: 6 }}>Refine with AI</div>
                <textarea className="textarea" rows={3} value={refineText} onChange={(ev) => setRefineText(ev.target.value)} placeholder="Optional: how to change it — e.g. 'more specific', 'split out the adjacent angle', 'this is indirect, not direct'." />
                <div className="row gap-2" style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => refineNode(i, refineText)} disabled={refining}>{refining ? "Refining…" : refineText.trim() ? "Apply" : "Sharpen"}</button>
                  <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>grounded in your records</span>
                </div>
              </div>
              <details>
                <summary className="t-sub t-muted" style={{ fontSize: 11.5, cursor: "pointer" }}>What this node tells the brain (the live pull steer)</summary>
                <div className="t-mono-xs" style={{ whiteSpace: "pre-wrap", color: "var(--ts)", lineHeight: 1.55, marginTop: 6, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>{compileNodeBrief(fieldsOnly, f.field_key) || "Give the node a statement — that statement becomes the search steer."}</div>
              </details>
              <NodeSources vector={vector} nodeKey={f.field_key} seed={compileNodeBrief(fieldsOnly, f.field_key)} />
              <div className="row-between" style={{ paddingTop: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { removeField(i); setOpenKey(null); }} style={{ color: "var(--rd-text)" }}>Remove node</button>
                <div className="row gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => startAdd(f.field_key)}>+ Branch off this node</button>
                  <button className="btn btn-sm" onClick={onSave} disabled={!dirty || savingBusy}>{savingBusy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ---- GUIDED ADD pop-up ---- */}
      <Modal open={adding} onClose={() => setAdding(false)} title={`New ${label.toLowerCase()} node`} width={640} tall>
        <div className="stack-3">
          <label className="field"><span className="t-label">Attaches to <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— the focus starts a new branch; a node grows its chain</span></span>
            <select className="select" value={addParent} onChange={(e) => { setAddParent(e.target.value); setAddWeight(null); }}>
              <option value="">The {label} focus (new branch)</option>
              {entries.map(({ f }) => <option key={f.field_key} value={f.field_key}>{f.label} ({VOCAB[W_OF(f.weight)]})</option>)}
            </select></label>
          <label className="field"><span className="t-label">Name</span>
            <input className="input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Short name — e.g. a rival, a segment, a persona, a capability" /></label>
          <label className="field"><span className="t-label">Statement <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— a declarative fact about you, search-actionable</span></span>
            <textarea className="textarea" rows={8} value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="A declarative fact about you, plus where its signal lives — specific enough that search knows what to hunt." /></label>
          <label className="field"><span className="t-label">Level</span>
            <select className="select" value={effWeight} onChange={(e) => setAddWeight(Number(e.target.value))}>
              {[3, 2, 1].map((w) => <option key={w} value={w}>{VOCAB[w]} — {WHY_WEIGHT[w]}</option>)}
            </select></label>
          {addWeight === null && <div className="t-mono-xs t-muted">suggested from where it attaches — adjust if it matters more or less</div>}
          <div className="row gap-2" style={{ paddingTop: 4 }}>
            <button className="btn" onClick={addGuided} disabled={!addLabel.trim()}>Add node</button>
            <button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* ---- PROPOSAL REVIEW pop-up — pan through them one at a time ---- */}
      {reviewing && reviewIdx != null && (
        <Modal open onClose={() => setReviewIdx(null)} width={640} tall
          title={`Review proposals — ${reviewIdx + 1} of ${proposals.length}`}>
          <div className="stack-3" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="stack-3" style={{ flex: 1 }}>
              <label className="field"><span className="t-label">Name</span>
                <input className="input" value={reviewing.label} onChange={(e) => patchProposal(reviewIdx, { label: e.target.value })} style={{ fontWeight: 620 }} /></label>
              <label className="field"><span className="t-label">Statement</span>
                <textarea className="textarea" rows={10} value={reviewing.value} onChange={(e) => patchProposal(reviewIdx, { value: e.target.value })} /></label>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                <label className="field" style={{ flex: 1, minWidth: 180 }}><span className="t-label">Level</span>
                  <select className="select" value={W_OF(reviewing.weight)} onChange={(e) => patchProposal(reviewIdx, { weight: Number(e.target.value) })}>
                    {[3, 2, 1].map((w) => <option key={w} value={w}>{VOCAB[w]} — {WHY_WEIGHT[w]}</option>)}
                  </select></label>
                {reviewing.parent_key && <div className="field" style={{ flex: 1, minWidth: 180 }}><span className="t-label">Branches off</span>
                  <div className="t-sub" style={{ paddingTop: 8 }}>{parentOf(reviewing.parent_key)?.label ?? proposals.find((x) => x.field_key === reviewing.parent_key)?.label ?? `the ${label} focus`}</div></div>}
              </div>
            </div>
            {/* Pan + verdict — fixed to the bottom of the rectangle */}
            <div className="row-between" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, alignItems: "center" }}>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setReviewIdx(Math.max(0, reviewIdx - 1))} disabled={reviewIdx === 0}>‹ Prev</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setReviewIdx(Math.min(proposals.length - 1, reviewIdx + 1))} disabled={reviewIdx >= proposals.length - 1}>Next ›</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { proposals.forEach(upsertNode); setProposals([]); setReviewIdx(null); }}>Accept all</button>
              </div>
              <div className="row gap-2">
                <button className="btn btn-secondary" onClick={() => resolveProposal(false)} style={{ color: "var(--rd-text)" }}>Discard</button>
                <button className="btn" onClick={() => resolveProposal(true)}>Accept</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
