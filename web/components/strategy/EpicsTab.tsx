"use client";

// Epics — craft & REFINE a curated story for a release item, then push to Ship.
// The story is shaped against its evidence (signals + competitive gaps); the CPO
// can draft it (real agent-chat). Push seeds the Build Item's Product Scope.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, SubTabs, Modal, ConfirmDialog } from "@/components/ui";
import { spawnInitiative } from "@/lib/routing";
import { SCORE_LABEL, PRIORITY_TONE, gapsOf, confText, errText, fetchAgentKey, authHeader, type Cap, type Score, type Competitor } from "@/lib/strategy";

type Epic = { id: string; title: string; problem: string | null; story: string | null; notes: string | null; priority: string };
type Signal = { id: string; title: string; why: string | null; conf_level: number | null; conf_label: string | null; origin: string; metadata: { domain?: string } | null; bundle_id: string | null };
type BundleCap = { bundle_id: string; capability_id: string };
type Stream = "gaps" | "frontier" | "market" | "signals";

export default function EpicsTab({ initialEpicId, onChange }: { initialEpicId?: string | null; onChange?: () => void }) {
  const supabase = createClient();
  const [epics, setEpics] = useState<Epic[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [bundleCaps, setBundleCaps] = useState<BundleCap[]>([]);
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(initialEpicId ?? null);
  const [draft, setDraft] = useState<Epic | null>(null);
  const [tab, setTab] = useState<"story" | "evidence">("story");
  const [curate, setCurate] = useState(false);
  const [stream, setStream] = useState<Stream>("gaps");
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: b }, { data: s }, { data: c }, { data: sc }, { data: co }, { data: bc }] = await Promise.all([
      supabase.from("strategy_bundles").select("id, title, problem, story, notes, priority").eq("state", "open").order("created_at", { ascending: false }),
      supabase.from("signals").select("id, title, why, conf_level, conf_label, origin, metadata, bundle_id").neq("strategy_state", "promoted"),
      supabase.from("capabilities").select("id, name").order("position"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score"),
      supabase.from("competitors").select("id, name"),
      supabase.from("bundle_capabilities").select("bundle_id, capability_id"),
    ]);
    setEpics((b ?? []) as Epic[]); setSignals((s ?? []) as Signal[]); setCaps((c ?? []) as Cap[]);
    setScores((sc ?? []) as Score[]); setCompetitors((co ?? []) as Competitor[]); setBundleCaps((bc ?? []) as BundleCap[]);
    setAgentKey(await fetchAgentKey(supabase));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  // Auto-select the epic we arrived to craft (e.g. just started from a theme).
  useEffect(() => {
    if (!initialEpicId || loading) return;
    const e = epics.find((x) => x.id === initialEpicId);
    if (e && activeId !== e.id) { setActiveId(e.id); setDraft({ ...e }); setTab("story"); }
  }, [initialEpicId, loading, epics, activeId]);

  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };
  function select(e: Epic) { setActiveId(e.id); setDraft({ ...e }); setTab("story"); }

  const gaps = gapsOf(caps, scores, competitors);
  const avail = signals.filter((s) => !s.bundle_id);
  const dom = (s: Signal) => s.metadata?.domain ?? null;
  const streamItems: Record<Stream, Signal[]> = {
    gaps: [], frontier: avail.filter((s) => dom(s) === "capability"), market: avail.filter((s) => dom(s) === "market"),
    signals: avail.filter((s) => dom(s) !== "capability" && dom(s) !== "market"),
  };
  const evSignals = signals.filter((s) => s.bundle_id === activeId);
  const evGapIds = new Set(bundleCaps.filter((bc) => bc.bundle_id === activeId).map((bc) => bc.capability_id));
  const evGaps = gaps.filter((g) => evGapIds.has(g.cap.id));
  const evCount = evSignals.length + evGaps.length;

  async function newEpic() {
    setError(null);
    try {
      const orgId = await orgIdOr();
      const { data, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: "", priority: "medium" }).select("id, title, problem, story, notes, priority").single();
      if (error) throw error;
      await load(); select(data as Epic); onChange?.();
    } catch (e) { setError(errText(e, "Could not create the epic.")); }
  }
  async function saveField<K extends keyof Epic>(field: K, value: Epic[K]) {
    if (!activeId) return;
    setEpics((p) => p.map((e) => (e.id === activeId ? { ...e, [field]: value } : e)));
    const { error } = await supabase.from("strategy_bundles").update({ [field]: value }).eq("id", activeId);
    if (error) setError(error.message);
  }
  async function addSignal(id: string) { if (!activeId) return; await supabase.from("signals").update({ bundle_id: activeId, strategy_state: "bundled", verified_at: new Date().toISOString() }).eq("id", id); await load(); }
  async function removeSignal(id: string) { await supabase.from("signals").update({ bundle_id: null, strategy_state: "staged" }).eq("id", id); await load(); }
  async function addGap(capId: string) { if (!activeId) return; try { const orgId = await orgIdOr(); const { error } = await supabase.from("bundle_capabilities").insert({ org_id: orgId, bundle_id: activeId, capability_id: capId }); if (error && !String(error.message).includes("duplicate")) throw error; await load(); } catch (e) { setError(errText(e, "Could not add.")); } }
  async function removeGap(capId: string) { if (!activeId) return; await supabase.from("bundle_capabilities").delete().eq("bundle_id", activeId).eq("capability_id", capId); await load(); }

  async function aiDraft() {
    if (!draft) return;
    setAiBusy(true); setError(null);
    try {
      if (!agentKey) throw new Error("No officer available to draft (seed agents first).");
      const ev = [...evGaps.map((g) => `Competitive gap: ${g.cap.name}${g.byName ? ` (behind ${g.byName})` : ""}`), ...evSignals.map((s) => `Signal: ${s.title}${s.why ? ` — ${s.why}` : ""}`)].join("\n");
      const prompt = `You are drafting a product EPIC. Write a crisp story (3–5 sentences): what we'd build and the outcome it drives, grounded ONLY in the evidence and context below. Return ONLY the story prose — no preamble, no headings.\n\nTitle: ${draft.title || "(untitled)"}\nProblem: ${draft.problem || "(none yet)"}\nNotes: ${draft.notes || "(none)"}\n\nEvidence:\n${ev || "(none attached — use the title/problem)"}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", { body: { agent_key: agentKey, messages: [{ role: "user", content: prompt }] }, headers: await authHeader(supabase) });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      const reply = String(data?.reply ?? "").trim();
      if (!reply) throw new Error("The officer returned nothing.");
      setDraft({ ...draft, story: reply }); await saveField("story", reply); setTab("story");
    } catch (e) { setError(errText(e, "AI draft failed.")); } finally { setAiBusy(false); }
  }

  async function pushToShip(epic: Epic) {
    setBusy(true); setError(null);
    try {
      const orgId = await orgIdOr();
      if (!epic.title.trim()) { setBusy(false); setError("Give the epic a title first (the field at the top of the craft pane)."); return; }
      const sigs = signals.filter((s) => s.bundle_id === epic.id);
      const gapCaps = gaps.filter((g) => bundleCaps.some((bc) => bc.bundle_id === epic.id && bc.capability_id === g.cap.id));
      const fields = [
        ...(epic.problem ? [{ field_key: "problem", label: "Problem / opportunity", section: "Why", value: epic.problem }] : []),
        ...(epic.story ? [{ field_key: "summary", label: "Summary", section: "What", value: epic.story }] : []),
      ];
      const initiativeId = await spawnInitiative(supabase, orgId, { title: epic.title, description: epic.story ?? null, scope: "product", lifecycle: "plan", kind: "feature", signalIds: sigs.map((s) => s.id), fields });
      await supabase.from("initiatives").update({ build_state: "scoped" }).eq("id", initiativeId);
      if (gapCaps.length) await supabase.from("build_context_links").insert(gapCaps.map((g, i) => ({ org_id: orgId, initiative_id: initiativeId, kind: "entity_ref", ref_table: "capabilities", ref_id: g.cap.id, label: g.cap.name, note: `Competitive gap — ${g.byName ? `behind ${g.byName}` : "rival ahead"} (${SCORE_LABEL[g.best]} vs our ${SCORE_LABEL[g.us]})`, position: i })));
      await supabase.from("strategy_bundles").update({ state: "promoted", initiative_id: initiativeId, promoted_at: new Date().toISOString() }).eq("id", epic.id);
      await supabase.from("signals").update({ strategy_state: "promoted" }).eq("bundle_id", epic.id);
      setActiveId(null); setDraft(null); setNotice(`“${epic.title}” pushed to Ship — scope it there.`); await load(); onChange?.();
    } catch (e) { setError(errText(e, "Could not push to Ship.")); } finally { setBusy(false); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  return (
    <div>
      <Banner>{error}</Banner>
      {notice && <div className="banner" style={{ marginBottom: "var(--sp-4)", background: "var(--gn-fill)", color: "var(--gn-text)" }}>{notice} <a href="/ship" style={{ fontWeight: 700, color: "inherit" }}>Open Ship →</a></div>}

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--sp-5)", alignItems: "start" }}>
        <div className="stack-2" style={{ maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
          <button className="btn btn-sm" onClick={newEpic}>+ New epic</button>
          {epics.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No epics. Start one here, or from a theme/group.</div>}
          {epics.map((e) => {
            const n = signals.filter((s) => s.bundle_id === e.id).length + bundleCaps.filter((bc) => bc.bundle_id === e.id).length;
            return (
              <button key={e.id} onClick={() => select(e)} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", outline: e.id === activeId ? "1px solid var(--ac)" : "none" }}>
                <div style={{ fontSize: 13, fontWeight: 640, marginBottom: 4 }}>{e.title || "Untitled epic"}</div>
                <div className="row gap-2" style={{ alignItems: "center" }}><Chip tone={PRIORITY_TONE[e.priority]}>{e.priority}</Chip>{n > 0 && <span className="t-mono-xs t-muted">{n} evidence</span>}</div>
              </button>
            );
          })}
        </div>

        {!draft ? (
          <div className="empty" style={{ marginTop: 40 }}>
            <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Craft an epic</div>
            <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Select an epic, or start one from a hunch or a theme/group. Shape the story against its evidence, draft with the CPO, then push to Ship.</div>
          </div>
        ) : (
          <div>
            <label className="t-label" style={{ display: "block", marginBottom: 4 }}>Epic title</label>
            <input key={draft.id} className="input" autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={() => saveField("title", draft.title)} style={{ fontSize: 17, fontWeight: 660, marginBottom: 10 }} placeholder="Name this epic" />
            <div className="row gap-2" style={{ marginBottom: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
              <select className="select" value={draft.priority} onChange={(e) => { setDraft({ ...draft, priority: e.target.value }); saveField("priority", e.target.value); }} style={{ flex: "0 0 110px" }}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
              <button className="btn btn-secondary btn-sm" disabled={aiBusy} onClick={aiDraft} title="The CPO drafts the story from the attached evidence">{aiBusy ? "Drafting…" : "✦ Draft with CPO"}</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary btn-sm" onClick={() => setDelId(draft.id)} style={{ color: "var(--rd-text)" }}>Delete</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => pushToShip(epics.find((e) => e.id === draft.id) ?? draft)}>Push to Ship →</button>
            </div>

            <SubTabs tabs={[{ key: "story", label: "Story" }, { key: "evidence", label: `Evidence · ${evCount}` }]} active={tab} onChange={(k) => setTab(k as "story" | "evidence")} />

            {tab === "story" ? (
              <div className="stack-3">
                <Field label="Problem / opportunity" hint="The pain or the opening — the why now." value={draft.problem ?? ""} onChange={(v) => setDraft({ ...draft, problem: v })} onBlur={() => saveField("problem", draft.problem ?? null)} />
                <Field label="The story" hint="What we'd build and the outcome it drives. Draft with the CPO, then refine." rows={5} value={draft.story ?? ""} onChange={(v) => setDraft({ ...draft, story: v })} onBlur={() => saveField("story", draft.story ?? null)} />
                <Field label="Notes" hint="Gut feel, open questions, half-ideas." value={draft.notes ?? ""} onChange={(v) => setDraft({ ...draft, notes: v })} onBlur={() => saveField("notes", draft.notes ?? null)} />
              </div>
            ) : (
              <div>
                <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--sp-3)" }}>
                  <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>The signals and competitive gaps this epic answers.</span>
                  <button className="btn btn-sm" onClick={() => setCurate(true)}>+ Curate signals</button>
                </div>
                <div className="stack-2">
                  {evCount === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No evidence yet — curate signals, or craft from gut feel alone.</div>}
                  {evGaps.map((g) => (<div key={g.cap.id} className="card card-pad row-between" style={{ alignItems: "center" }}><span className="row gap-2"><Chip tone="amber">gap</Chip><span style={{ fontSize: 13 }}>{g.cap.name}</span><span className="t-mono-xs t-muted">{g.byName} {SCORE_LABEL[g.best]} · us {SCORE_LABEL[g.us]}</span></span><button className="btn btn-secondary btn-sm" onClick={() => removeGap(g.cap.id)}>✕</button></div>))}
                  {evSignals.map((s) => (<div key={s.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}><span style={{ minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>{s.why && <span className="t-sub t-muted" style={{ fontSize: 12, marginLeft: 6 }}>{s.why}</span>}</span><button className="btn btn-secondary btn-sm" onClick={() => removeSignal(s.id)} style={{ flexShrink: 0 }}>✕</button></div>))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={curate} onClose={() => setCurate(false)} title="Curate signals" width={620}>
        <SubTabs<Stream> tabs={[{ key: "gaps", label: `Gaps · ${gaps.filter((g) => !evGapIds.has(g.cap.id)).length}` }, { key: "frontier", label: `Frontier · ${streamItems.frontier.length}` }, { key: "market", label: `Market · ${streamItems.market.length}` }, { key: "signals", label: `Signals · ${streamItems.signals.length}` }]} active={stream} onChange={setStream} />
        <div className="stack-2" style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {stream === "gaps" && gaps.filter((g) => !evGapIds.has(g.cap.id)).map((g) => (<PickRow key={g.cap.id} title={g.cap.name} sub={`Us ${SCORE_LABEL[g.us]} · ${g.byName} ${SCORE_LABEL[g.best]}`} chip={<Chip tone="amber">behind</Chip>} onAdd={() => addGap(g.cap.id)} />))}
          {stream === "gaps" && gaps.filter((g) => !evGapIds.has(g.cap.id)).length === 0 && <Empty>No open gaps.</Empty>}
          {stream !== "gaps" && streamItems[stream].map((s) => (<PickRow key={s.id} title={s.title} sub={s.why ?? ""} chip={confText(s) ? <Chip tone="green">{confText(s)}</Chip> : null} onAdd={() => addSignal(s.id)} />))}
          {stream !== "gaps" && streamItems[stream].length === 0 && <Empty>Nothing here right now.</Empty>}
        </div>
      </Modal>

      {delId && (<ConfirmDialog title="Delete epic?" message="This deletes the epic and unlinks its evidence. This can't be undone." confirmLabel="Delete"
        onConfirm={async () => { const id = delId; setDelId(null); await supabase.from("signals").update({ bundle_id: null, strategy_state: "staged" }).eq("bundle_id", id); await supabase.from("strategy_bundles").delete().eq("id", id); if (activeId === id) { setActiveId(null); setDraft(null); } await load(); onChange?.(); }}
        onCancel={() => setDelId(null)} />)}
    </div>
  );
}

function Field({ label, hint, value, onChange, onBlur, rows = 3 }: { label: string; hint: string; value: string; onChange: (v: string) => void; onBlur: () => void; rows?: number }) {
  return (<div><div className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{label}</div><div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 5 }}>{hint}</div><textarea className="textarea" rows={rows} value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} /></div>);
}
function PickRow({ title, sub, chip, onAdd }: { title: string; sub: string; chip?: React.ReactNode; onAdd: () => void }) {
  return (<div className="card card-pad row-between" style={{ alignItems: "flex-start", gap: 10 }}><div style={{ minWidth: 0, flex: 1 }}><div className="row gap-2" style={{ alignItems: "center", marginBottom: sub ? 3 : 0, flexWrap: "wrap" }}><span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>{chip}</div>{sub && <div className="t-sub t-muted" style={{ fontSize: 12 }}>{sub}</div>}</div><button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={onAdd}>+ Add</button></div>);
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="t-sub t-muted" style={{ fontSize: 12.5, padding: "8px 2px" }}>{children}</div>; }
