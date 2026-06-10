"use client";

// Signals — PRODUCT signals only (pure GTM-messaging signals stay in the GTM
// area). The routing hub: add context to a signal, push it INTO a theme, or
// multi-select and merge into a new theme. Competitive-matrix gaps show as a
// routable source. Signals reach epics THROUGH themes.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner } from "@/components/ui";
import { SCORE_LABEL, gapsOf, confText, errText, isProductSignal, type Cap, type Score, type Competitor } from "@/lib/strategy";
import { signalDomain, SIGNAL_DOMAIN } from "@/lib/signals";

type Signal = { id: string; title: string; why: string | null; origin: string; category: string | null; metadata: { domain?: string } | null; conf_level: number | null; conf_label: string | null };
type Theme = { id: string; title: string; signal_ids: string[] | null };

export default function SignalsTab({ onStartEpicFromGap }: { onStartEpicFromGap: (capId: string, title: string, problem: string) => void }) {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mergeTitle, setMergeTitle] = useState("");
  const [ctxId, setCtxId] = useState<string | null>(null);
  const [ctxVal, setCtxVal] = useState("");
  const [src, setSrc] = useState("all");

  const load = useCallback(async () => {
    const [{ data: s }, { data: th }, { data: c }, { data: sc }, { data: co }] = await Promise.all([
      supabase.from("signals").select("id, title, why, origin, category, metadata, conf_level, conf_label").neq("strategy_state", "promoted").order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("signal_themes").select("id, title, signal_ids").neq("state", "dormant"),
      supabase.from("capabilities").select("id, name").order("position"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score"),
      supabase.from("competitors").select("id, name"),
    ]);
    setSignals(((s ?? []) as Signal[]).filter(isProductSignal)); setThemes((th ?? []) as Theme[]);
    setCaps((c ?? []) as Cap[]); setScores((sc ?? []) as Score[]); setCompetitors((co ?? []) as Competitor[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };
  const dom = (s: Signal) => signalDomain(s);
  const sourceOf = (s: Signal) => (dom(s) === "competitive" ? "competitive" : dom(s) === "market" ? "market" : dom(s) === "capability" ? "frontier" : s.origin);
  const gaps = gapsOf(caps, scores, competitors);

  async function saveContext() { if (!ctxId) return; await supabase.from("signals").update({ why: ctxVal }).eq("id", ctxId); setCtxId(null); await load(); }
  async function pushIntoTheme(signalId: string, themeId: string) {
    if (!themeId) return;
    try {
      const orgId = await orgIdOr();
      await supabase.from("theme_signals").upsert({ org_id: orgId, theme_id: themeId, signal_id: signalId }, { onConflict: "theme_id,signal_id", ignoreDuplicates: true });
      const th = themes.find((t) => t.id === themeId); const next = Array.from(new Set([...(th?.signal_ids ?? []), signalId]));
      await supabase.from("signal_themes").update({ signal_ids: next }).eq("id", themeId);
      await supabase.from("theme_events").insert({ org_id: orgId, theme_id: themeId, kind: "evidence_added", detail: { added: 1 }, actor: "human" });
      await load();
    } catch (e) { setError(errText(e, "Could not push into theme.")); }
  }
  async function mergeSelected() {
    if (sel.size === 0 || !mergeTitle.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await orgIdOr(); const ids = [...sel];
      const vals = signals.filter((s) => ids.includes(s.id)).map((s) => s.conf_level).filter((v): v is number => v != null);
      const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
      const { data: th, error } = await supabase.from("signal_themes").insert({ org_id: orgId, title: mergeTitle.trim(), category: "product", conf_level: avg, signal_ids: ids, state: "active", merged_by: "human" }).select("id").single();
      if (error) throw error;
      const tid = (th as { id: string }).id;
      await supabase.from("theme_signals").upsert(ids.map((sid) => ({ org_id: orgId, theme_id: tid, signal_id: sid })), { onConflict: "theme_id,signal_id", ignoreDuplicates: true });
      await supabase.from("theme_events").insert({ org_id: orgId, theme_id: tid, kind: "created", detail: { merged: ids.length }, actor: "human" });
      setSel(new Set()); setMergeTitle(""); await load();
    } catch (e) { setError(errText(e, "Could not merge.")); } finally { setBusy(false); }
  }
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  const SOURCES = ["all", "internal", "external", "competitive", "market", "frontier"];
  const feed = signals.filter((s) => src === "all" || sourceOf(s) === src);

  return (
    <div>
      <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", flexWrap: "wrap", alignItems: "center" }}>
        <span className="t-label">Product signals — in &amp; around the company</span>
        <div style={{ flex: 1 }} />
        {SOURCES.map((o) => <button key={o} className={`btn btn-sm ${src === o ? "" : "btn-secondary"}`} onClick={() => setSrc(o)}>{o === "all" ? "All" : o}</button>)}
      </div>
      <Banner>{error}</Banner>

      {sel.size > 0 && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-3)", borderColor: "var(--ac)" }}>
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <span className="t-label">{sel.size} selected</span>
            <input className="input" placeholder="Name the merged theme" value={mergeTitle} onChange={(e) => setMergeTitle(e.target.value)} style={{ flex: "1 1 220px" }} />
            <button className="btn btn-sm" disabled={busy || !mergeTitle.trim()} onClick={mergeSelected}>{busy ? "Merging…" : "Merge into new theme"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <div className="stack-2" style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
        {feed.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No product signals in this view.</div>}
        {feed.map((s) => (
          <div key={s.id} className="card card-pad">
            <div className="row gap-2" style={{ alignItems: "flex-start" }}>
              <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} style={{ marginTop: 4 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 620 }}>{s.title}</span>
                  <Chip tone={sourceOf(s) === "competitive" ? "amber" : sourceOf(s) === "frontier" ? "violet" : "default"}>{sourceOf(s)}</Chip>
                  {confText(s) && <Chip tone="green">{confText(s)}</Chip>}
                </div>
                {ctxId === s.id ? (
                  <div className="row gap-2" style={{ marginTop: 4 }}>
                    <input className="input" autoFocus value={ctxVal} onChange={(e) => setCtxVal(e.target.value)} placeholder="Add context…" style={{ flex: 1 }} />
                    <button className="btn btn-sm" onClick={saveContext}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setCtxId(null)}>Cancel</button>
                  </div>
                ) : <div className="t-sub t-muted" style={{ fontSize: 12 }}>{s.why || <span style={{ fontStyle: "italic" }}>No context yet.</span>}</div>}
              </div>
              <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
                {ctxId !== s.id && <button className="btn btn-secondary btn-sm" onClick={() => { setCtxId(s.id); setCtxVal(s.why ?? ""); }}>Context</button>}
                <select className="select" value="" onChange={(e) => pushIntoTheme(s.id, e.target.value)} style={{ fontSize: 11.5, padding: "4px 6px" }}>
                  <option value="">→ Theme…</option>{themes.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>Competitive gaps — from the matrix</div>
          <div className="stack-2">
            {gaps.map((g) => (
              <div key={g.cap.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}>
                <span style={{ minWidth: 0 }}><Chip tone="amber">gap</Chip> <span style={{ fontSize: 13, fontWeight: 600 }}>{g.cap.name}</span> <span className="t-mono-xs t-muted">{g.byName} {SCORE_LABEL[g.best]} · us {SCORE_LABEL[g.us]}</span></span>
                <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => onStartEpicFromGap(g.cap.id, `Close gap: ${g.cap.name}`, `We trail ${g.byName ?? "a rival"} on ${g.cap.name} (${SCORE_LABEL[g.best]} vs our ${SCORE_LABEL[g.us]}).`)}>Start epic →</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
