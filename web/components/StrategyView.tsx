"use client";

// Product Strategy — the INVESTMENT-SYNTHESIS surface, upstream of Build.
// "What should we build or enhance?" Read every intelligence stream — signals
// (internal/external), frontier-model capabilities, market insights — against
// the competitive capability MATRIX (where rivals outscore us = invest here),
// then pull the strongest evidence into an INVESTMENT THESIS and ship it to
// Build. The thesis carries its evidence (signals + the gap it closes) along.
//
// All intel lives in one `signals` table tagged by metadata.domain
// (capability|market|competitive) + origin (internal|external); gaps are
// computed from capabilities + capability_scores (us = competitor_id null).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner, SubTabs } from "@/components/ui";
import { spawnInitiative } from "@/lib/routing";

type Meta = { domain?: string; provider?: string; area?: string; lens?: string } | null;
type Signal = { id: string; title: string; why: string | null; conf_level: number | null; conf_label: string | null; origin: string; category: string | null; metadata: Meta; strategy_state: string; bundle_id: string | null };
type Bundle = { id: string; title: string; rationale: string | null; state: string };
type Capability = { id: string; name: string; category: string | null };
type Score = { capability_id: string; competitor_id: string | null; score: number };
type Competitor = { id: string; name: string };
type BundleCap = { bundle_id: string; capability_id: string };

const SCORE_LABEL = ["—", "Partial", "Good", "Strong"];
type StreamTab = "gaps" | "frontier" | "market" | "signals";

export default function StrategyView() {
  const supabase = createClient();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [bundleCaps, setBundleCaps] = useState<BundleCap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [active, setActive] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamTab>("gaps");
  const [origin, setOrigin] = useState<"all" | "internal" | "external">("all");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", rationale: "" });

  const load = useCallback(async () => {
    const [{ data: b }, { data: s }, { data: c }, { data: sc }, { data: co }, { data: bc }] = await Promise.all([
      supabase.from("strategy_bundles").select("id, title, rationale, state").eq("state", "open").order("created_at", { ascending: false }),
      supabase.from("signals").select("id, title, why, conf_level, conf_label, origin, category, metadata, strategy_state, bundle_id").neq("strategy_state", "promoted").order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("capabilities").select("id, name, category").order("position"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score"),
      supabase.from("competitors").select("id, name"),
      supabase.from("bundle_capabilities").select("bundle_id, capability_id"),
    ]);
    setBundles((b ?? []) as Bundle[]); setSignals((s ?? []) as Signal[]); setCaps((c ?? []) as Capability[]);
    setScores((sc ?? []) as Score[]); setCompetitors((co ?? []) as Competitor[]); setBundleCaps((bc ?? []) as BundleCap[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const errText = (e: unknown, f: string) => (e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : e instanceof Error ? e.message : f);
  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };

  // --- competitive matrix → gaps (capabilities where a rival outscores us) ----
  const scoreOf = (capId: string, compId: string | null) => scores.find((x) => x.capability_id === capId && x.competitor_id === compId)?.score ?? 0;
  const compName = (id: string) => competitors.find((c) => c.id === id)?.name ?? "a competitor";
  const gapFor = (cap: Capability) => {
    const us = scoreOf(cap.id, null);
    let best = us, byId: string | null = null;
    for (const c of competitors) { const sc = scoreOf(cap.id, c.id); if (sc > best) { best = sc; byId = c.id; } }
    return { cap, us, best, byName: byId ? compName(byId) : null, isGap: best > us };
  };
  const gaps = caps.map(gapFor).filter((g) => g.isGap);

  // --- streams: available (unbundled) intelligence by domain ------------------
  const avail = signals.filter((s) => !s.bundle_id);
  const dom = (s: Signal) => s.metadata?.domain ?? null;
  const frontier = avail.filter((s) => dom(s) === "capability");
  const market = avail.filter((s) => dom(s) === "market");
  const generalSignals = avail.filter((s) => dom(s) !== "capability" && dom(s) !== "market")
    .filter((s) => origin === "all" || s.origin === origin);

  // --- the active thesis and its evidence -------------------------------------
  const activeBundle = bundles.find((b) => b.id === active) ?? null;
  const thesisSignals = signals.filter((s) => s.bundle_id === active);
  const thesisGapIds = new Set(bundleCaps.filter((bc) => bc.bundle_id === active).map((bc) => bc.capability_id));
  const thesisGaps = caps.filter((c) => thesisGapIds.has(c.id)).map(gapFor);

  async function createThesis() {
    if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await orgIdOr();
      const { data, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: form.title.trim(), rationale: form.rationale.trim() || null }).select("id").single();
      if (error) throw error;
      setActive(data.id); setCreating(false); setForm({ title: "", rationale: "" }); await load();
    } catch (e) { setError(errText(e, "Could not create the thesis.")); } finally { setBusy(false); }
  }
  async function addSignal(id: string) {
    if (!active) return; setError(null);
    const { error } = await supabase.from("signals").update({ bundle_id: active, strategy_state: "bundled", verified_at: new Date().toISOString() }).eq("id", id);
    if (error) { setError(error.message); return; } await load();
  }
  async function removeSignal(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").update({ bundle_id: null, strategy_state: "staged" }).eq("id", id);
    if (error) { setError(error.message); return; } await load();
  }
  async function addGap(capId: string) {
    if (!active) return; setError(null);
    try { const orgId = await orgIdOr();
      const { error } = await supabase.from("bundle_capabilities").insert({ org_id: orgId, bundle_id: active, capability_id: capId });
      if (error && !String(error.message).includes("duplicate")) throw error; await load();
    } catch (e) { setError(errText(e, "Could not add the gap.")); }
  }
  async function removeGap(capId: string) {
    if (!active) return; setError(null);
    const { error } = await supabase.from("bundle_capabilities").delete().eq("bundle_id", active).eq("capability_id", capId);
    if (error) { setError(error.message); return; } await load();
  }

  // The decision: ship a thesis into Build. Spawns a Build Item at Plan, carries
  // its signals (initiative_signals) AND its competitive gaps (as Technical Scope
  // entity_ref context links), and retires the thesis.
  async function shipToBuild(b: Bundle) {
    setBusy(true); setError(null);
    try {
      const orgId = await orgIdOr();
      const sigs = signals.filter((s) => s.bundle_id === b.id);
      const gapCaps = caps.filter((c) => bundleCaps.some((bc) => bc.bundle_id === b.id && bc.capability_id === c.id)).map(gapFor);
      if (sigs.length === 0 && gapCaps.length === 0) { setBusy(false); setError("Add evidence before shipping."); return; }
      const initiativeId = await spawnInitiative(supabase, orgId, {
        title: b.title, description: b.rationale ?? null, scope: "product", lifecycle: "plan", kind: "feature",
        signalIds: sigs.map((s) => s.id),
      });
      await supabase.from("initiatives").update({ build_state: "scoped" }).eq("id", initiativeId);
      if (gapCaps.length) {
        await supabase.from("build_context_links").insert(gapCaps.map((g, i) => ({
          org_id: orgId, initiative_id: initiativeId, kind: "entity_ref", ref_table: "capabilities", ref_id: g.cap.id,
          label: g.cap.name, note: `Competitive gap — ${g.byName ? `behind ${g.byName}` : "rival ahead"} (${SCORE_LABEL[g.best]} vs our ${SCORE_LABEL[g.us]})`, position: i,
        })));
      }
      await supabase.from("strategy_bundles").update({ state: "promoted", initiative_id: initiativeId, promoted_at: new Date().toISOString() }).eq("id", b.id);
      await supabase.from("signals").update({ strategy_state: "promoted" }).eq("bundle_id", b.id);
      setActive(null); setNotice(`“${b.title}” shipped to Build — scope it in Ship.`);
      await load();
    } catch (e) { setError(errText(e, "Could not ship to Build.")); } finally { setBusy(false); }
  }

  const conf = (s: Signal) => s.conf_label || (s.conf_level != null ? `${Math.round(s.conf_level * 100)}%` : null);
  const addable = !!active;

  return (
    <div>
      <PageHeader title="Strategy" meta="What should we build or enhance? Weigh every intelligence stream and the competitive matrix, then turn the strongest evidence into an investment thesis you ship to Build." />
      <Banner>{error}</Banner>
      {notice && <div className="banner" style={{ marginBottom: "var(--sp-4)", background: "var(--gn-fill)", color: "var(--gn-text)" }}>{notice} <a href="/ship" style={{ fontWeight: 700, color: "inherit" }}>Open Ship →</a></div>}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "var(--sp-5)", alignItems: "start" }}>

          {/* LEFT — investment theses */}
          <div>
            <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--sp-3)" }}>
              <span className="t-label">Investment theses · {bundles.length}</span>
              {!creating && <button className="btn btn-sm" onClick={() => { setCreating(true); setForm({ title: "", rationale: "" }); }}>+ New</button>}
            </div>

            {creating && (
              <div className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
                <input className="input" autoFocus placeholder="Thesis — what to build/enhance" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ marginBottom: 8 }} />
                <textarea className="textarea" rows={2} placeholder="Why now / the bet (optional)" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} style={{ marginBottom: 8 }} />
                <div className="row gap-2"><button className="btn btn-sm" disabled={busy || !form.title.trim()} onClick={createThesis}>Create</button><button className="btn btn-secondary btn-sm" onClick={() => setCreating(false)}>Cancel</button></div>
              </div>
            )}

            {bundles.length === 0 && !creating && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>No theses yet. Create one, then pull evidence from the streams on the right.</div>}

            <div className="stack-3">
              {bundles.map((b) => {
                const isActive = b.id === active;
                const nSig = signals.filter((s) => s.bundle_id === b.id).length;
                const nGap = bundleCaps.filter((bc) => bc.bundle_id === b.id).length;
                return (
                  <div key={b.id} className="card card-pad" style={{ borderLeft: `3px solid var(--ac)`, outline: isActive ? "2px solid var(--ac)" : "none", cursor: "pointer" }} onClick={() => setActive(isActive ? null : b.id)}>
                    <div className="row-between" style={{ alignItems: "flex-start", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 660 }}>{b.title}</span>
                      <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{nSig + nGap} evidence</span>
                    </div>
                    {b.rationale && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 3 }}>{b.rationale}</div>}

                    {isActive && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
                        {thesisGaps.map((g) => (
                          <div key={g.cap.id} className="row-between" style={{ fontSize: 12, marginBottom: 5, gap: 6 }}>
                            <span><Chip tone="amber">gap</Chip> {g.cap.name}</span>
                            <button className="btn btn-secondary btn-sm" onClick={() => removeGap(g.cap.id)}>✕</button>
                          </div>
                        ))}
                        {thesisSignals.map((s) => (
                          <div key={s.id} className="row-between" style={{ fontSize: 12, marginBottom: 5, gap: 6 }}>
                            <span style={{ minWidth: 0 }}>• {s.title}</span>
                            <button className="btn btn-secondary btn-sm" onClick={() => removeSignal(s.id)}>✕</button>
                          </div>
                        ))}
                        {nSig + nGap === 0 && <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>Empty — add evidence from the right.</div>}
                        <button className="btn btn-sm" style={{ marginTop: 4 }} disabled={busy || nSig + nGap === 0} onClick={() => shipToBuild(b)}>Ship to Build →</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT — intelligence streams */}
          <div>
            <SubTabs<StreamTab>
              tabs={[{ key: "gaps", label: `Competitive gaps · ${gaps.length}` }, { key: "frontier", label: `Frontier · ${frontier.length}` }, { key: "market", label: `Market · ${market.length}` }, { key: "signals", label: `Signals · ${generalSignals.length}` }]}
              active={stream} onChange={setStream} />

            {!addable && <div className="banner" style={{ marginBottom: "var(--sp-4)", background: "var(--fill-2)", color: "var(--tm)" }}>Select or create a thesis on the left, then add the evidence that supports it.</div>}

            {stream === "gaps" && (
              <div className="stack-3">
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Capabilities where a rival outscores us — the clearest “build/enhance to compete” prompts.</div>
                {gaps.length === 0 && <Empty>No competitive gaps — we lead on every scored capability.</Empty>}
                {gaps.map((g) => (
                  <Row key={g.cap.id} title={g.cap.name}
                    sub={`Us: ${SCORE_LABEL[g.us]} · ${g.byName ?? "Rival"}: ${SCORE_LABEL[g.best]}`}
                    chip={<Chip tone="amber">behind</Chip>}
                    added={thesisGapIds.has(g.cap.id)} addable={addable} onAdd={() => addGap(g.cap.id)} onRemove={() => removeGap(g.cap.id)} />
                ))}
              </div>
            )}

            {stream === "frontier" && (
              <div className="stack-3">
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Newly possible to build — frontier-model capabilities to leverage.</div>
                {frontier.length === 0 && <Empty>No frontier capabilities staged.</Empty>}
                {frontier.map((s) => (
                  <Row key={s.id} title={s.title} sub={s.why ?? ""}
                    chip={<>{s.metadata?.provider && <Chip tone="violet">{s.metadata.provider}</Chip>}{s.metadata?.area && <Chip>{s.metadata.area}</Chip>}</>}
                    addable={addable} onAdd={() => addSignal(s.id)} />
                ))}
              </div>
            )}

            {stream === "market" && (
              <div className="stack-3">
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Market insights — analyst, industry, and buyer shifts.</div>
                {market.length === 0 && <Empty>No market insights staged.</Empty>}
                {market.map((s) => (
                  <Row key={s.id} title={s.title} sub={s.why ?? ""}
                    chip={<>{s.metadata?.lens && <Chip>{s.metadata.lens}</Chip>}{conf(s) && <Chip tone="green">{conf(s)}</Chip>}</>}
                    addable={addable} onAdd={() => addSignal(s.id)} />
                ))}
              </div>
            )}

            {stream === "signals" && (
              <div className="stack-3">
                <div className="row-between" style={{ alignItems: "center" }}>
                  <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Signals from your tools and the outside world.</div>
                  <div className="row gap-2">
                    {(["all", "internal", "external"] as const).map((o) => (
                      <button key={o} className={`btn btn-sm ${origin === o ? "" : "btn-secondary"}`} onClick={() => setOrigin(o)}>{o === "all" ? "All" : o}</button>
                    ))}
                  </div>
                </div>
                {generalSignals.length === 0 && <Empty>No signals in this view.</Empty>}
                {generalSignals.map((s) => (
                  <Row key={s.id} title={s.title} sub={s.why ?? ""}
                    chip={<>{<Chip tone={s.origin === "external" ? "violet" : "default"}>{s.origin}</Chip>}{s.metadata?.domain === "competitive" && <Chip tone="amber">competitive</Chip>}{conf(s) && <Chip tone="green">{conf(s)}</Chip>}</>}
                    addable={addable} onAdd={() => addSignal(s.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ title, sub, chip, added, addable, onAdd, onRemove }: {
  title: string; sub: string; chip?: React.ReactNode; added?: boolean; addable: boolean; onAdd: () => void; onRemove?: () => void;
}) {
  return (
    <div className="card card-pad">
      <div className="row-between" style={{ alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: sub ? 4 : 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 620 }}>{title}</span>
            {chip}
          </div>
          {sub && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{sub}</div>}
        </div>
        {added ? (
          <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={onRemove}>✓ In thesis</button>
        ) : (
          <button className="btn btn-sm" style={{ flexShrink: 0 }} disabled={!addable} title={addable ? "Add to the active thesis" : "Select a thesis first"} onClick={onAdd}>+ Add</button>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{children}</div>;
}
