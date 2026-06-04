"use client";

// Strategy — the product strategist's pipeline, no scroll, four stages:
//   Signals → the multi-source routing hub: add context, route a signal into an
//             epic, or multi-select and MERGE signals into a theme (human merge).
//   Themes  → merged signals (AI synthesis + human merges). Assign a strategic
//             GROUP (or let AI classify); start an epic, pre-drafted from the data.
//   Groups  → themes bucketed by strategic category (feature gaps, expansions,
//             big bets, quality, adjacent). Start an epic from any.
//   Epics   → craft & refine, push to Ship (delegated to EpicsTab).
// AI + human throughout: synthesize-signals merges, agent-chat drafts/classifies.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, SubTabs } from "@/components/ui";
import EpicsTab from "@/components/strategy/EpicsTab";
import { SCORE_LABEL, GROUPS, gapsOf, confText, errText, fetchAgentKey, authHeader, type Cap, type Score, type Competitor } from "@/lib/strategy";

type Meta = { domain?: string; provider?: string; area?: string; lens?: string } | null;
type Signal = { id: string; title: string; why: string | null; conf_level: number | null; conf_label: string | null; origin: string; metadata: Meta; bundle_id: string | null };
type Theme = { id: string; title: string; summary: string | null; recommendation: string | null; conf_level: number | null; signal_ids: string[] | null; group_label: string | null; merged_by: string };
type EpicMini = { id: string; title: string };

type View = "signals" | "themes" | "groups" | "epics";

export default function StrategyView() {
  const supabase = createClient();
  const [view, setView] = useState<View>("themes");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [epics, setEpics] = useState<EpicMini[]>([]);
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which async op is running
  const [startedEpicId, setStartedEpicId] = useState<string | null>(null);

  // Signals tab interaction state
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mergeTitle, setMergeTitle] = useState("");
  const [ctxId, setCtxId] = useState<string | null>(null);
  const [ctxVal, setCtxVal] = useState("");
  const [src, setSrc] = useState<string>("all");

  const load = useCallback(async () => {
    const [{ data: s }, { data: th }, { data: c }, { data: sc }, { data: co }, { data: b }] = await Promise.all([
      supabase.from("signals").select("id, title, why, conf_level, conf_label, origin, metadata, bundle_id").neq("strategy_state", "promoted").order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("signal_themes").select("id, title, summary, recommendation, conf_level, signal_ids, group_label, merged_by").neq("state", "dormant").order("conf_level", { ascending: false, nullsFirst: false }),
      supabase.from("capabilities").select("id, name").order("position"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score"),
      supabase.from("competitors").select("id, name"),
      supabase.from("strategy_bundles").select("id, title").eq("state", "open").order("created_at", { ascending: false }),
    ]);
    setSignals((s ?? []) as Signal[]); setThemes((th ?? []) as Theme[]); setCaps((c ?? []) as Cap[]);
    setScores((sc ?? []) as Score[]); setCompetitors((co ?? []) as Competitor[]); setEpics((b ?? []) as EpicMini[]);
    setAgentKey(await fetchAgentKey(supabase));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };
  const gaps = gapsOf(caps, scores, competitors);
  const avail = signals.filter((s) => !s.bundle_id);
  const dom = (s: Signal) => s.metadata?.domain ?? null;
  const sourceOf = (s: Signal) => (dom(s) === "competitive" ? "competitive" : dom(s) === "market" ? "market" : dom(s) === "capability" ? "frontier" : s.origin);
  const SOURCES = ["all", "internal", "external", "competitive", "market", "frontier"];

  // ---- start an epic, pre-seeded, and jump to the craft tab ----------------
  async function startEpic(seed: { title?: string; problem?: string; story?: string; signalIds?: string[]; capId?: string }) {
    setError(null);
    try {
      const orgId = await orgIdOr();
      const { data, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: seed.title ?? "", problem: seed.problem ?? null, story: seed.story ?? null, priority: "medium" }).select("id").single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      if (seed.signalIds?.length) await supabase.from("signals").update({ bundle_id: id, strategy_state: "bundled", verified_at: new Date().toISOString() }).in("id", seed.signalIds).neq("strategy_state", "promoted");
      if (seed.capId) await supabase.from("bundle_capabilities").insert({ org_id: orgId, bundle_id: id, capability_id: seed.capId });
      setStartedEpicId(id); setSel(new Set()); setView("epics"); await load();
    } catch (e) { setError(errText(e, "Could not start the epic.")); }
  }

  // ---- Signals: context, route to epic, human merge -----------------------
  async function saveContext() { if (!ctxId) return; await supabase.from("signals").update({ why: ctxVal }).eq("id", ctxId); setCtxId(null); await load(); }
  async function routeToEpic(signalId: string, epicId: string) { if (!epicId) return; await supabase.from("signals").update({ bundle_id: epicId, strategy_state: "bundled", verified_at: new Date().toISOString() }).eq("id", signalId); await load(); }
  async function mergeSelected() {
    if (sel.size === 0 || !mergeTitle.trim()) return;
    setBusy("merge"); setError(null);
    try {
      const orgId = await orgIdOr();
      const ids = [...sel];
      const avg = (() => { const vals = signals.filter((s) => ids.includes(s.id)).map((s) => s.conf_level).filter((v): v is number => v != null); return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null; })();
      const { data: th, error } = await supabase.from("signal_themes").insert({ org_id: orgId, title: mergeTitle.trim(), category: "product", conf_level: avg, signal_ids: ids, state: "active", merged_by: "human" }).select("id").single();
      if (error) throw error;
      await supabase.from("theme_signals").upsert(ids.map((sid) => ({ org_id: orgId, theme_id: (th as { id: string }).id, signal_id: sid })), { onConflict: "theme_id,signal_id", ignoreDuplicates: true });
      setSel(new Set()); setMergeTitle(""); setView("themes"); await load();
    } catch (e) { setError(errText(e, "Could not merge.")); } finally { setBusy(null); }
  }

  // ---- Themes: group assignment, AI classify, synthesize ------------------
  async function assignGroup(themeId: string, group: string) { await supabase.from("signal_themes").update({ group_label: group || null }).eq("id", themeId); await load(); }
  async function synthesize() { setBusy("synth"); setError(null); try { const { data, error } = await supabase.functions.invoke("synthesize-signals", { body: {}, headers: await authHeader(supabase) }); if (error) throw error; if (data?.error) throw new Error(data.error); await load(); } catch (e) { setError(errText(e, "Synthesis failed.")); } finally { setBusy(null); } }
  async function aiClassify() {
    setBusy("classify"); setError(null);
    try {
      if (!agentKey) throw new Error("No officer available (seed agents first).");
      const ung = themes.filter((t) => !t.group_label);
      if (!ung.length) { setBusy(null); setError("All themes are already grouped."); return; }
      const list = ung.map((t) => `- ${t.id}: ${t.title}${t.summary ? ` — ${t.summary}` : ""}`).join("\n");
      const groupKeys = GROUPS.map((g) => g.key).join(", ");
      const prompt = `Classify each product theme into exactly ONE strategic group from: ${groupKeys}.\nReturn ONLY a JSON array, no prose: [{"id":"<theme id>","group":"<group key>"}].\n\nThemes:\n${list}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", { body: { agent_key: agentKey, messages: [{ role: "user", content: prompt }] }, headers: await authHeader(supabase) });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      const raw = String(data?.reply ?? "");
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Couldn't parse the classification.");
      const arr = JSON.parse(match[0]) as { id: string; group: string }[];
      const valid = new Set(GROUPS.map((g) => g.key));
      const updates = arr.filter((x) => x.id && valid.has(x.group));
      for (const u of updates) await supabase.from("signal_themes").update({ group_label: u.group }).eq("id", u.id);
      await load();
    } catch (e) { setError(errText(e, "AI classify failed.")); } finally { setBusy(null); }
  }

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const feed = avail.filter((s) => src === "all" || sourceOf(s) === src);

  return (
    <div>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <h1 className="t-page">Strategy</h1>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Read what&apos;s happening, merge and group signals, craft epics, and push them to Ship.</div>
      </div>
      <SubTabs<View> tabs={[{ key: "signals", label: `Signals · ${avail.length}` }, { key: "themes", label: `Themes · ${themes.length}` }, { key: "groups", label: "Groups" }, { key: "epics", label: `Epics · ${epics.length}` }]} active={view} onChange={setView} />
      <Banner>{error}</Banner>

      {loading ? <div className="t-sub t-muted">Loading…</div> : view === "epics" ? (
        <EpicsTab initialEpicId={startedEpicId} onChange={load} />
      ) : view === "signals" ? (
        /* ---------------- SIGNALS: routing hub ----------------------------- */
        <div>
          <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", flexWrap: "wrap", alignItems: "center" }}>
            <span className="t-label">Signal feed — in &amp; around the company</span>
            <div style={{ flex: 1 }} />
            {SOURCES.map((o) => <button key={o} className={`btn btn-sm ${src === o ? "" : "btn-secondary"}`} onClick={() => setSrc(o)}>{o === "all" ? "All" : o}</button>)}
          </div>

          {sel.size > 0 && (
            <div className="card card-pad" style={{ marginBottom: "var(--sp-3)", borderColor: "var(--ac)" }}>
              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <span className="t-label">{sel.size} selected</span>
                <input className="input" placeholder="Name the merged theme" value={mergeTitle} onChange={(e) => setMergeTitle(e.target.value)} style={{ flex: "1 1 220px" }} />
                <button className="btn btn-sm" disabled={busy === "merge" || !mergeTitle.trim()} onClick={mergeSelected}>{busy === "merge" ? "Merging…" : "Merge into theme"}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSel(new Set())}>Clear</button>
              </div>
            </div>
          )}

          <div className="stack-2" style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
            {feed.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No signals in this view.</div>}
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
                        <button className="btn btn-sm" onClick={saveContext}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setCtxId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="t-sub t-muted" style={{ fontSize: 12 }}>{s.why || <span style={{ fontStyle: "italic" }}>No context yet.</span>}</div>
                    )}
                  </div>
                  <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
                    {ctxId !== s.id && <button className="btn btn-secondary btn-sm" onClick={() => { setCtxId(s.id); setCtxVal(s.why ?? ""); }}>Context</button>}
                    <select className="select" value="" onChange={(e) => routeToEpic(s.id, e.target.value)} style={{ fontSize: 11.5, padding: "4px 6px" }}>
                      <option value="">→ Epic…</option>
                      {epics.map((ep) => <option key={ep.id} value={ep.id}>{ep.title || "Untitled epic"}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : view === "themes" ? (
        /* ---------------- THEMES: merged signals -------------------------- */
        <div>
          <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
            <span className="t-label">Merged signals — what the patterns are telling us</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary btn-sm" disabled={busy === "classify"} onClick={aiClassify}>{busy === "classify" ? "Grouping…" : "✦ Group with AI"}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy === "synth"} onClick={synthesize}>{busy === "synth" ? "Synthesizing…" : "↻ Synthesize"}</button>
          </div>
          <div className="stack-3" style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
            {themes.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No themes yet. Synthesize the signals, or merge some in the Signals tab.</div>}
            {themes.map((t) => (
              <div key={t.id} className="card card-pad">
                <div className="row-between" style={{ alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 660 }}>{t.title}</span>
                  <span className="row gap-2" style={{ flexShrink: 0 }}>{t.merged_by === "synthesis" && <Chip tone="violet">AI</Chip>}{confText(t) && <Chip tone="green">{confText(t)}</Chip>}</span>
                </div>
                {t.summary && <div className="t-sub t-muted" style={{ fontSize: 12.5, margin: "4px 0" }}>{t.summary}</div>}
                {t.recommendation && <div className="t-body" style={{ fontSize: 12.5, lineHeight: 1.5 }}><span className="t-label" style={{ marginRight: 4 }}>Do</span>{t.recommendation}</div>}
                <div className="row gap-2" style={{ marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select className="select" value={t.group_label ?? ""} onChange={(e) => assignGroup(t.id, e.target.value)} style={{ flex: "0 0 150px", fontSize: 11.5 }}>
                    <option value="">Unsorted</option>
                    {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </select>
                  <button className="btn btn-sm" onClick={() => startEpic({ title: t.title, problem: t.summary ?? undefined, story: t.recommendation ?? undefined, signalIds: t.signal_ids ?? [] })}>Start epic →</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ---------------- GROUPS: themes by strategic category ------------ */
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${GROUPS.length}, minmax(180px, 1fr))`, gap: "var(--sp-3)", overflowX: "auto", alignItems: "start" }}>
          {GROUPS.map((g) => {
            const list = themes.filter((t) => t.group_label === g.key);
            return (
              <div key={g.key}>
                <div className="t-label">{g.label} · {list.length}</div>
                <div className="t-sub t-muted" style={{ fontSize: 11, marginBottom: "var(--sp-3)" }}>{g.blurb}</div>
                <div className="stack-2">
                  {list.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 11.5 }}>—</div>}
                  {list.map((t) => (
                    <div key={t.id} className="card card-pad">
                      <div style={{ fontSize: 12.5, fontWeight: 620, marginBottom: 4 }}>{t.title}</div>
                      {t.recommendation && <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{t.recommendation}</div>}
                      <button className="btn btn-sm" onClick={() => startEpic({ title: t.title, problem: t.summary ?? undefined, story: t.recommendation ?? undefined, signalIds: t.signal_ids ?? [] })}>Start epic →</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Competitive gaps live alongside the signal feed as a routable source. */}
      {view === "signals" && gaps.length > 0 && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>Competitive gaps — from the matrix</div>
          <div className="stack-2">
            {gaps.map((g) => (
              <div key={g.cap.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}>
                <span style={{ minWidth: 0 }}><Chip tone="amber">gap</Chip> <span style={{ fontSize: 13, fontWeight: 600 }}>{g.cap.name}</span> <span className="t-mono-xs t-muted">{g.byName} {SCORE_LABEL[g.best]} · us {SCORE_LABEL[g.us]}</span></span>
                <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => startEpic({ title: `Close gap: ${g.cap.name}`, problem: `We trail ${g.byName ?? "a rival"} on ${g.cap.name} (${SCORE_LABEL[g.best]} vs our ${SCORE_LABEL[g.us]}).`, capId: g.cap.id })}>Start epic →</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
