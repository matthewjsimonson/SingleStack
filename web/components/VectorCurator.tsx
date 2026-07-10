"use client";

// VectorCurator — one focus's page on the Signals setup. The page IS the
// hierarchy: an org-chart of nodes, direct at the top, adjacent below,
// indirect at the bottom. Web sources are managed INSIDE each node (its
// pop-up editor); no signal feed lives here — signals land on the
// intelligence page this focus feeds. All reading/editing/ratifying happens
// in centered, tall pop-ups: click a node to edit it; + adds a child;
// AI proposals open a review pop-up you pan through one at a time.

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
  refineNode, refining, onSave, onPush, pushLabel, dirty, savingBusy,
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
  // Suggested level from the attach point: a child INHERITS its parent's
  // level (a named rival under a direct archetype is still direct); the focus
  // itself roots a direct branch. Depth organizes; level classifies.
  const suggestedWeight = addParent ? (parentOf(addParent)?.weight ?? 2) : 3;
  const effWeight = addWeight ?? suggestedWeight;

  // The hierarchy as a FOREST: direct roots at the top, children below —
  // ordered by level so the chart reads top-down like the org it is.
  const forest = useMemo(() => {
    const byKey = new Map(entries.map((e) => [e.f.field_key, e]));
    const kidsOf = new Map<string, typeof entries>();
    const roots: typeof entries = [];
    for (const e of entries) {
      const p = e.f.parent_key && e.f.parent_key !== e.f.field_key && byKey.has(e.f.parent_key) ? e.f.parent_key : null;
      if (p) kidsOf.set(p, [...(kidsOf.get(p) ?? []), e]);
      else roots.push(e);
    }
    const byW = (a: { f: Field }, b: { f: Field }) => W_OF(b.f.weight) - W_OF(a.f.weight);
    roots.sort(byW);
    for (const k of kidsOf.values()) k.sort(byW);
    return { roots, kidsOf };
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

  // Fresh state each time the focus changes. The first interview question is
  // fetched only when the interview pop-up OPENS — not on every tab switch.
  useEffect(() => { setTranscript([]); setQuestion(""); setWhy(""); setAnswer(""); setDone(false); setErr(null); setProposals([]); setReviewIdx(null); setInterviewOpen(false); setOpenKey(null); setAdding(false); setAddParent(""); }, [nextQuestion]);
  useEffect(() => {
    if (interviewOpen && !question && !done && !asking && transcript.length === 0) void nextQuestion([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewOpen]);

  // RECOMMENDATIONS for this focus — pending intelligence updates whose
  // EVIDENCE came from this focus's signals (battlecard/capability ones are
  // competitive by nature). Derivation is structural: no signals pulled for
  // the focus → no recommendations, ever. Surfaced inside the node pop-ups;
  // accepting pushes the item to its area (theme boards / battlecards / matrix).
  type Rec = { id: string; kind: string; summary: string | null; payload: Record<string, unknown> };
  const [recs, setRecs] = useState<Rec[]>([]);
  const [recBusy, setRecBusy] = useState<string | null>(null);
  const loadRecs = useCallback(async () => {
    const { data: ups } = await supabase.from("intel_updates").select("id, kind, summary, payload").eq("status", "pending");
    const list = (ups ?? []) as Rec[];
    const sigIds = [...new Set(list.flatMap((u) => (Array.isArray(u.payload?.signal_ids) ? (u.payload.signal_ids as string[]) : [])))];
    const vecOfSig = new Map<string, string | null>();
    if (sigIds.length) {
      const { data: sigs } = await supabase.from("signals").select("id, metadata").in("id", sigIds);
      for (const s of sigs ?? []) vecOfSig.set(s.id as string, ((s.metadata as { vector?: string } | null)?.vector) ?? null);
    }
    setRecs(list.filter((u) => {
      if (u.kind === "battlecard_item" || u.kind === "capability_score" || u.payload?.competitor_id) return vector === "competitive";
      const ids = Array.isArray(u.payload?.signal_ids) ? (u.payload.signal_ids as string[]) : [];
      return ids.some((id) => vecOfSig.get(id) === vector);
    }));
  }, [supabase, vector]);
  useEffect(() => { loadRecs(); }, [loadRecs]);
  async function resolveRec(id: string, verdict: "accept" | "reject") {
    setRecBusy(id); setErr(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("resolve-intel-update", { body: { update_id: id, verdict }, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await loadRecs();
    } catch (e) { setErr(await edgeErrorMessage(e, "resolve-intel-update")); }
    finally { setRecBusy(null); }
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

  function startAdd(parent: string, weight: number | null = null) {
    setAdding(true); setAddParent(parent); setAddLabel(""); setAddValue(""); setAddWeight(weight); setOpenKey(null);
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
          <div className="stack-3" style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
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
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="t-sub t-muted" style={{ fontSize: 12 }}>{transcript.filter((t) => t.role === "a").length} answered</span>
              {(done || transcript.length > 0) && (
                <button className="btn btn-secondary btn-sm" disabled={asking}
                  onClick={() => { setTranscript([]); setQuestion(""); setWhy(""); setAnswer(""); setDone(false); void nextQuestion([]); }}>
                  Restart interview
                </button>
              )}
            </div>
            <button className="btn" onClick={propose} disabled={generating}>
              {generating ? "Proposing nodes…" : "Propose nodes →"}
            </button>
          </div>
        </div>
      </Modal>

      {/* The hierarchy — an org-chart, top-down: direct roots, adjacent below,
          indirect at the bottom. Click a node to open it (statement, level,
          AI refine, its web sources); + under a node adds a child one level
          further out. */}
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 10, alignItems: "center" }}>
          <div className="t-label">Hierarchy · {entries.length} node{entries.length === 1 ? "" : "s"}</div>
          <div className="row gap-2">
            <button className="btn btn-sm" onClick={onSave} disabled={!dirty || savingBusy}>{savingBusy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
            {pushLabel && <button className="btn btn-secondary btn-sm" onClick={onPush} title={dirty ? "Save first" : `Apply this focus in ${pushLabel}`}>Push to {pushLabel} →</button>}
          </div>
        </div>
        {forest.roots.length === 0 ? (
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <button className="otree-add" onClick={() => startAdd("", 3)}>+ Add the first direct node</button>
            <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>or build with AI above — you review every proposal.</span>
          </div>
        ) : (
          /* VERTICAL: one band per level, stacked — trees wrap within a band,
             so new nodes and branches grow the page downward, never sideways. */
          [3, 2, 1].map((w) => {
            const bandRoots = forest.roots.filter((r) => W_OF(r.f.weight) === w);
            const hint = WHY_WEIGHT[w].split(" — ")[1];
            return (
              <div key={w} className="otree-band">
                <div className="otree-band-head">
                  <span className={`otree-lvl w${w}`}>{VOCAB[w]}</span>
                  <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>{hint}</span>
                </div>
                <ul className="otree">
                  {bandRoots.map((e) => <OrgNode key={e.f.field_key} entry={e} kidsOf={forest.kidsOf}
                    onOpen={(k) => { setOpenKey(k); setRefineText(""); }} onAddChild={(k, cw) => startAdd(k, cw)} seen={new Set()} />)}
                  <li><button className="otree-add" onClick={() => startAdd("", w)} title={`Start a new ${VOCAB[w].toLowerCase()} branch`}>+ {VOCAB[w]}</button></li>
                </ul>
              </div>
            );
          })
        )}
      </div>

      {/* What this focus tells the brain — the steer every pull inherits */}
      {entries.length > 0 && (
        <details className="card card-pad">
          <summary className="t-label" style={{ cursor: "pointer" }}>What this focus tells the brain <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— compiled live into every pull aimed at this focus</span></summary>
          <div className="t-mono-xs" style={{ whiteSpace: "pre-wrap", color: "var(--ts)", lineHeight: 1.55, marginTop: 8 }}>{compileVectorBrief(fieldsOnly, vector)}</div>
        </details>
      )}

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
              {/* Recommendations — only when this focus's signals produced any.
                  Accept pushes the item to its area; nothing appears before
                  signals are set up and pulled. */}
              {recs.length > 0 && (
                <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                  <div className="t-label" style={{ marginBottom: 8 }}>Recommendations · {recs.length} <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— from this focus&apos;s signals; accepting pushes each to its area</span></div>
                  <div className="stack-2">
                    {recs.map((r) => (
                      <div key={r.id} className="row-between" style={{ gap: 8, alignItems: "baseline" }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{r.summary}</span>
                          <span className="t-mono-xs t-muted" style={{ marginLeft: 8 }}>{r.kind.replace("_", " ")}</span>
                        </div>
                        <div className="row gap-2" style={{ flexShrink: 0 }}>
                          <button className="btn btn-secondary btn-sm" disabled={recBusy === r.id} onClick={() => resolveRec(r.id, "reject")} style={{ color: "var(--rd-text)" }}>Dismiss</button>
                          <button className="btn btn-sm" disabled={recBusy === r.id} onClick={() => resolveRec(r.id, "accept")}>{recBusy === r.id ? "…" : "Accept → push"}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
            <div className="stack-3" style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
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

// One node of the org chart — recursive; a cycle-guarded top-down tree.
function OrgNode({ entry, kidsOf, onOpen, onAddChild, seen }: {
  entry: { f: Field; i: number };
  kidsOf: Map<string, { f: Field; i: number }[]>;
  onOpen: (key: string) => void;
  onAddChild: (parentKey: string, weight: number) => void;
  seen: Set<string>;
}) {
  const { f } = entry;
  if (seen.has(f.field_key)) return null;
  const nextSeen = new Set(seen); nextSeen.add(f.field_key);
  const kids = kidsOf.get(f.field_key) ?? [];
  const w = W_OF(f.weight);
  return (
    <li>
      <div className="otree-card" onClick={() => onOpen(f.field_key)} title={f.value || f.label}>
        <div style={{ fontWeight: 630, fontSize: 12.5, lineHeight: 1.35 }}>{f.label || "Untitled"}</div>
        <div className="row-between" style={{ marginTop: 5, alignItems: "center", gap: 6 }}>
          <span className={`otree-lvl w${w}`}>{VOCAB[w]}</span>
          <span className="row" style={{ alignItems: "center", gap: 6 }}>
            {f.origin === "ai" && <span className="t-mono-xs" style={{ color: "var(--vl-text)" }}>AI</span>}
            <button onClick={(ev) => { ev.stopPropagation(); onAddChild(f.field_key, w); }}
              title="Add a node under this one — it inherits this level"
              style={{ border: "1px solid var(--border)", background: "var(--panel)", borderRadius: 999, width: 18, height: 18, lineHeight: "16px", fontSize: 12, color: "var(--tm)", cursor: "pointer", padding: 0 }}>+</button>
          </span>
        </div>
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => <OrgNode key={k.f.field_key} entry={k} kidsOf={kidsOf} onOpen={onOpen} onAddChild={onAddChild} seen={nextSeen} />)}
        </ul>
      )}
    </li>
  );
}
