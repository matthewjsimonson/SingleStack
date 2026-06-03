"use client";

// Strategy — the EPIC craft workspace, the front of Product. An epic is a curated
// story for a release item. You craft it from two intakes — curate SIGNALS (the
// intel streams + competitive matrix) and BRAINSTORM gut feel — then push it to
// Ship, where the story seeds the Build Item's Product Scope.
//
// Layout is a no-scroll two-pane: a rail of epics + a focused craft pane with a
// Story tab and an Evidence tab; signal curation happens in a picker, not a wall
// of cards. (AI drafting plugs into this surface next, wired to the real agent.)
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, SubTabs, Modal, ConfirmDialog } from "@/components/ui";
import { spawnInitiative } from "@/lib/routing";

type Meta = { domain?: string; provider?: string; area?: string; lens?: string } | null;
type Epic = { id: string; title: string; problem: string | null; story: string | null; notes: string | null; priority: string };
type Signal = { id: string; title: string; why: string | null; conf_level: number | null; conf_label: string | null; origin: string; metadata: Meta; bundle_id: string | null };
type Capability = { id: string; name: string };
type Score = { capability_id: string; competitor_id: string | null; score: number };
type Competitor = { id: string; name: string };
type BundleCap = { bundle_id: string; capability_id: string };

const SCORE_LABEL = ["—", "Partial", "Good", "Strong"];
const PRIORITY_TONE: Record<string, "default" | "accent" | "amber"> = { low: "default", medium: "accent", high: "amber" };
type Stream = "gaps" | "frontier" | "market" | "signals";

export default function StrategyView() {
  const supabase = createClient();
  const [epics, setEpics] = useState<Epic[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [bundleCaps, setBundleCaps] = useState<BundleCap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Epic | null>(null);
  const [tab, setTab] = useState<"story" | "evidence">("story");
  const [curate, setCurate] = useState(false);
  const [stream, setStream] = useState<Stream>("gaps");
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: b }, { data: s }, { data: c }, { data: sc }, { data: co }, { data: bc }] = await Promise.all([
      supabase.from("strategy_bundles").select("id, title, problem, story, notes, priority").eq("state", "open").order("created_at", { ascending: false }),
      supabase.from("signals").select("id, title, why, conf_level, conf_label, origin, metadata, bundle_id").neq("strategy_state", "promoted").order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("capabilities").select("id, name").order("position"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score"),
      supabase.from("competitors").select("id, name"),
      supabase.from("bundle_capabilities").select("bundle_id, capability_id"),
    ]);
    setEpics((b ?? []) as Epic[]); setSignals((s ?? []) as Signal[]); setCaps((c ?? []) as Capability[]);
    setScores((sc ?? []) as Score[]); setCompetitors((co ?? []) as Competitor[]); setBundleCaps((bc ?? []) as BundleCap[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const errText = (e: unknown, f: string) => (e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : e instanceof Error ? e.message : f);
  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };

  function select(e: Epic) { setActiveId(e.id); setDraft({ ...e }); setTab("story"); }

  async function createEpic() {
    setError(null);
    try {
      const orgId = await orgIdOr();
      const { data, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: "Untitled epic", priority: "medium" }).select("id, title, problem, story, notes, priority").single();
      if (error) throw error;
      setEpics((p) => [data as Epic, ...p]); select(data as Epic);
    } catch (e) { setError(errText(e, "Could not create the epic.")); }
  }

  async function saveField<K extends keyof Epic>(field: K, value: Epic[K]) {
    if (!activeId) return;
    setEpics((p) => p.map((e) => (e.id === activeId ? { ...e, [field]: value } : e)));
    const { error } = await supabase.from("strategy_bundles").update({ [field]: value }).eq("id", activeId);
    if (error) setError(error.message);
  }

  // --- competitive matrix → gaps -------------------------------------------
  const scoreOf = (capId: string, compId: string | null) => scores.find((x) => x.capability_id === capId && x.competitor_id === compId)?.score ?? 0;
  const gapFor = (cap: Capability) => {
    const us = scoreOf(cap.id, null);
    let best = us, byId: string | null = null;
    for (const c of competitors) { const sc = scoreOf(cap.id, c.id); if (sc > best) { best = sc; byId = c.id; } }
    return { cap, us, best, byName: byId ? competitors.find((c) => c.id === byId)?.name ?? "a rival" : null, isGap: best > us };
  };
  const gaps = caps.map(gapFor).filter((g) => g.isGap);

  // --- streams (unattached intel) ------------------------------------------
  const avail = signals.filter((s) => !s.bundle_id);
  const dom = (s: Signal) => s.metadata?.domain ?? null;
  const streamItems: Record<Stream, Signal[]> = {
    gaps: [], // handled separately
    frontier: avail.filter((s) => dom(s) === "capability"),
    market: avail.filter((s) => dom(s) === "market"),
    signals: avail.filter((s) => dom(s) !== "capability" && dom(s) !== "market"),
  };

  // --- active epic evidence -------------------------------------------------
  const evSignals = signals.filter((s) => s.bundle_id === activeId);
  const evGapIds = new Set(bundleCaps.filter((bc) => bc.bundle_id === activeId).map((bc) => bc.capability_id));
  const evGaps = caps.filter((c) => evGapIds.has(c.id)).map(gapFor);
  const evCount = evSignals.length + evGaps.length;

  async function addSignal(id: string) { if (!activeId) return; await supabase.from("signals").update({ bundle_id: activeId, strategy_state: "bundled", verified_at: new Date().toISOString() }).eq("id", id); await load(); }
  async function removeSignal(id: string) { await supabase.from("signals").update({ bundle_id: null, strategy_state: "staged" }).eq("id", id); await load(); }
  async function addGap(capId: string) { if (!activeId) return; try { const orgId = await orgIdOr(); const { error } = await supabase.from("bundle_capabilities").insert({ org_id: orgId, bundle_id: activeId, capability_id: capId }); if (error && !String(error.message).includes("duplicate")) throw error; await load(); } catch (e) { setError(errText(e, "Could not add.")); } }
  async function removeGap(capId: string) { if (!activeId) return; await supabase.from("bundle_capabilities").delete().eq("bundle_id", activeId).eq("capability_id", capId); await load(); }

  async function pushToShip(epic: Epic) {
    setBusy(true); setError(null);
    try {
      const orgId = await orgIdOr();
      const sigs = signals.filter((s) => s.bundle_id === epic.id);
      const gapCaps = caps.filter((c) => bundleCaps.some((bc) => bc.bundle_id === epic.id && bc.capability_id === c.id)).map(gapFor);
      if (!epic.title.trim() || epic.title === "Untitled epic") { setBusy(false); setError("Give the epic a title first."); return; }
      // The epic's story seeds the Build Item's Product Scope (problem→Why, story→What).
      const fields = [
        ...(epic.problem ? [{ field_key: "problem", label: "Problem / opportunity", section: "Why", value: epic.problem }] : []),
        ...(epic.story ? [{ field_key: "summary", label: "Summary", section: "What", value: epic.story }] : []),
      ];
      const initiativeId = await spawnInitiative(supabase, orgId, {
        title: epic.title, description: epic.story ?? null, scope: "product", lifecycle: "plan", kind: "feature",
        signalIds: sigs.map((s) => s.id), fields,
      });
      await supabase.from("initiatives").update({ build_state: "scoped" }).eq("id", initiativeId);
      if (gapCaps.length) {
        await supabase.from("build_context_links").insert(gapCaps.map((g, i) => ({
          org_id: orgId, initiative_id: initiativeId, kind: "entity_ref", ref_table: "capabilities", ref_id: g.cap.id,
          label: g.cap.name, note: `Competitive gap — ${g.byName ? `behind ${g.byName}` : "rival ahead"} (${SCORE_LABEL[g.best]} vs our ${SCORE_LABEL[g.us]})`, position: i,
        })));
      }
      await supabase.from("strategy_bundles").update({ state: "promoted", initiative_id: initiativeId, promoted_at: new Date().toISOString() }).eq("id", epic.id);
      await supabase.from("signals").update({ strategy_state: "promoted" }).eq("bundle_id", epic.id);
      setActiveId(null); setDraft(null); setNotice(`“${epic.title}” pushed to Ship — scope it there.`);
      await load();
    } catch (e) { setError(errText(e, "Could not push to Ship.")); } finally { setBusy(false); }
  }

  const conf = (s: Signal) => s.conf_label || (s.conf_level != null ? `${Math.round(s.conf_level * 100)}%` : null);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "flex-end" }}>
        <div><h1 className="t-page">Strategy</h1><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Craft epics from signals and gut feel, then push them to Ship.</div></div>
        <button className="btn" onClick={createEpic}>+ New epic</button>
      </div>
      <Banner>{error}</Banner>
      {notice && <div className="banner" style={{ marginBottom: "var(--sp-4)", background: "var(--gn-fill)", color: "var(--gn-text)" }}>{notice} <a href="/ship" style={{ fontWeight: 700, color: "inherit" }}>Open Ship →</a></div>}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--sp-5)", alignItems: "start" }}>

          {/* rail — the epics */}
          <div className="stack-2" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
            {epics.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No epics yet. Start one — from a hunch or by curating signals.</div>}
            {epics.map((e) => {
              const isA = e.id === activeId;
              const n = signals.filter((s) => s.bundle_id === e.id).length + bundleCaps.filter((bc) => bc.bundle_id === e.id).length;
              return (
                <button key={e.id} onClick={() => select(e)} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", border: isA ? "1px solid var(--ac)" : undefined, outline: isA ? "1px solid var(--ac)" : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: 640, marginBottom: 4 }}>{e.title}</div>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <Chip tone={PRIORITY_TONE[e.priority]}>{e.priority}</Chip>
                    {n > 0 && <span className="t-mono-xs t-muted">{n} evidence</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* craft pane — the active epic */}
          {!draft ? (
            <div className="empty" style={{ marginTop: 40 }}>
              <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Craft an epic</div>
              <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Select an epic on the left, or start a new one. An epic is a story for a release — shape it from signals and gut feel, then push it to Ship.</div>
            </div>
          ) : (
            <div>
              <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={() => saveField("title", draft.title)}
                style={{ fontSize: 20, fontWeight: 680, border: "none", padding: 0, marginBottom: 8, background: "transparent" }} placeholder="Epic title" />
              <div className="row gap-2" style={{ marginBottom: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
                <select className="select" value={draft.priority} onChange={(e) => { setDraft({ ...draft, priority: e.target.value }); saveField("priority", e.target.value); }} style={{ flex: "0 0 120px" }}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
                <span className="t-mono-xs t-muted">{evCount} evidence</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn-secondary btn-sm" onClick={() => setDelId(draft.id)} style={{ color: "var(--rd-text)" }}>Delete</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => pushToShip(epics.find((e) => e.id === draft.id) ?? draft)}>Push to Ship →</button>
              </div>

              <SubTabs tabs={[{ key: "story", label: "Story" }, { key: "evidence", label: `Evidence · ${evCount}` }]} active={tab} onChange={(k) => setTab(k)} />

              {tab === "story" ? (
                <div className="stack-3">
                  <Field label="Problem / opportunity" hint="What's the pain or the opening — the why now." value={draft.problem ?? ""} onChange={(v) => setDraft({ ...draft, problem: v })} onBlur={() => saveField("problem", draft.problem ?? null)} />
                  <Field label="The story" hint="What we'd build and the outcome it drives — the narrative a release item is born from." rows={5} value={draft.story ?? ""} onChange={(v) => setDraft({ ...draft, story: v })} onBlur={() => saveField("story", draft.story ?? null)} />
                  <Field label="Notes" hint="Gut feel, open questions, half-ideas — scratch space." value={draft.notes ?? ""} onChange={(v) => setDraft({ ...draft, notes: v })} onBlur={() => saveField("notes", draft.notes ?? null)} />
                </div>
              ) : (
                <div>
                  <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--sp-3)" }}>
                    <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>The signals and competitive gaps this epic answers.</span>
                    <button className="btn btn-sm" onClick={() => setCurate(true)}>+ Curate signals</button>
                  </div>
                  <div className="stack-2">
                    {evCount === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No evidence yet — curate signals, or craft from gut feel alone.</div>}
                    {evGaps.map((g) => (
                      <div key={g.cap.id} className="card card-pad row-between" style={{ alignItems: "center" }}>
                        <span className="row gap-2"><Chip tone="amber">gap</Chip><span style={{ fontSize: 13 }}>{g.cap.name}</span><span className="t-mono-xs t-muted">{g.byName} {SCORE_LABEL[g.best]} · us {SCORE_LABEL[g.us]}</span></span>
                        <button className="btn btn-secondary btn-sm" onClick={() => removeGap(g.cap.id)}>✕</button>
                      </div>
                    ))}
                    {evSignals.map((s) => (
                      <div key={s.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}>
                        <span style={{ minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>{s.why && <span className="t-sub t-muted" style={{ fontSize: 12, marginLeft: 6 }}>{s.why}</span>}</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => removeSignal(s.id)} style={{ flexShrink: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* signal curation picker */}
      <Modal open={curate} onClose={() => setCurate(false)} title="Curate signals" width={620}>
        <SubTabs<Stream> tabs={[{ key: "gaps", label: `Gaps · ${gaps.filter((g) => !evGapIds.has(g.cap.id)).length}` }, { key: "frontier", label: `Frontier · ${streamItems.frontier.length}` }, { key: "market", label: `Market · ${streamItems.market.length}` }, { key: "signals", label: `Signals · ${streamItems.signals.length}` }]} active={stream} onChange={setStream} />
        <div className="stack-2" style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {stream === "gaps" && gaps.filter((g) => !evGapIds.has(g.cap.id)).map((g) => (
            <PickRow key={g.cap.id} title={g.cap.name} sub={`Us ${SCORE_LABEL[g.us]} · ${g.byName} ${SCORE_LABEL[g.best]}`} chip={<Chip tone="amber">behind</Chip>} onAdd={() => addGap(g.cap.id)} />
          ))}
          {stream === "gaps" && gaps.filter((g) => !evGapIds.has(g.cap.id)).length === 0 && <Empty>No open gaps.</Empty>}
          {stream !== "gaps" && streamItems[stream].map((s) => (
            <PickRow key={s.id} title={s.title} sub={s.why ?? ""} chip={conf(s) ? <Chip tone="green">{conf(s)}</Chip> : (stream === "signals" ? <Chip tone={s.origin === "external" ? "violet" : "default"}>{s.origin}</Chip> : null)} onAdd={() => addSignal(s.id)} />
          ))}
          {stream !== "gaps" && streamItems[stream].length === 0 && <Empty>Nothing here right now.</Empty>}
        </div>
      </Modal>

      {delId && (
        <ConfirmDialog title="Delete epic?" message="This deletes the epic and unlinks its evidence. This can't be undone." confirmLabel="Delete"
          onConfirm={async () => { const id = delId; setDelId(null); await supabase.from("signals").update({ bundle_id: null, strategy_state: "staged" }).eq("bundle_id", id); await supabase.from("strategy_bundles").delete().eq("id", id); if (activeId === id) { setActiveId(null); setDraft(null); } await load(); }}
          onCancel={() => setDelId(null)} />
      )}
    </div>
  );
}

function Field({ label, hint, value, onChange, onBlur, rows = 3 }: { label: string; hint: string; value: string; onChange: (v: string) => void; onBlur: () => void; rows?: number }) {
  return (
    <div>
      <div className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{label}</div>
      <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 5 }}>{hint}</div>
      <textarea className="textarea" rows={rows} value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  );
}

function PickRow({ title, sub, chip, onAdd }: { title: string; sub: string; chip?: React.ReactNode; onAdd: () => void }) {
  return (
    <div className="card card-pad row-between" style={{ alignItems: "flex-start", gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row gap-2" style={{ alignItems: "center", marginBottom: sub ? 3 : 0, flexWrap: "wrap" }}><span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>{chip}</div>
        {sub && <div className="t-sub t-muted" style={{ fontSize: 12 }}>{sub}</div>}
      </div>
      <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={onAdd}>+ Add</button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="t-sub t-muted" style={{ fontSize: 12.5, padding: "8px 2px" }}>{children}</div>; }
