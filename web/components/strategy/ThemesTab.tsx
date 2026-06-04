"use client";

// Themes — merged PRODUCT signals, SORTED BY GROUP (groups aren't a separate
// thing; they're how themes are categorized). Open a theme for its provenance
// (source signals + how it was synthesized), add context, watch it, edit, push
// signals in, delete, or push it into an epic. AI synthesizes & classifies;
// humans merge & curate.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Modal, ConfirmDialog } from "@/components/ui";
import PlayActions from "@/components/PlayActions";
import { GROUPS, confText, errText, fetchAgentKey, authHeader, isProductSignal } from "@/lib/strategy";

type Theme = { id: string; title: string; summary: string | null; recommendation: string | null; conf_level: number | null; signal_ids: string[] | null; group_label: string | null; merged_by: string; watched: boolean; context: string | null; bundle_id: string | null };
type Signal = { id: string; title: string; why: string | null; origin: string; category: string | null; metadata: { domain?: string } | null; conf_level: number | null; conf_label: string | null };
type Epic = { id: string; title: string };
type Event = { id: string; kind: string; detail: Record<string, unknown> | null; actor: string | null; created_at: string };

const EVENT_LABEL: Record<string, string> = { created: "Created", evidence_added: "Evidence added", escalated: "Escalated", state_changed: "State changed", summary_updated: "Summary updated", merged_in: "Merged in", decayed: "Decayed", recommendation_changed: "Recommendation changed" };

export default function ThemesTab({ onStartEpic }: { onStartEpic: (themeId: string) => void }) {
  const supabase = createClient();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [srcSignals, setSrcSignals] = useState<Signal[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [edit, setEdit] = useState<{ title: string; summary: string; recommendation: string; context: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: th }, { data: s }, { data: b }] = await Promise.all([
      supabase.from("signal_themes").select("id, title, summary, recommendation, conf_level, signal_ids, group_label, merged_by, watched, context, bundle_id").neq("state", "dormant").order("watched", { ascending: false }).order("conf_level", { ascending: false, nullsFirst: false }),
      supabase.from("signals").select("id, title, why, origin, category, metadata, conf_level, conf_label").neq("strategy_state", "promoted"),
      supabase.from("strategy_bundles").select("id, title").eq("state", "open").order("created_at", { ascending: false }),
    ]);
    setThemes((th ?? []) as Theme[]); setSignals(((s ?? []) as Signal[]).filter(isProductSignal)); setEpics((b ?? []) as Epic[]);
    setAgentKey(await fetchAgentKey(supabase)); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const orgIdOr = async () => { const o = await getOrgId(); if (!o) throw new Error("Could not resolve your organization."); return o; };
  const epicTitle = (id: string | null) => epics.find((e) => e.id === id)?.title || (id ? "an epic" : null);

  async function openTheme(t: Theme) {
    setOpenId(t.id); setEdit({ title: t.title, summary: t.summary ?? "", recommendation: t.recommendation ?? "", context: t.context ?? "" }); setAdding(false);
    const ids = t.signal_ids ?? [];
    const [{ data: ss }, { data: ev }] = await Promise.all([
      ids.length ? supabase.from("signals").select("id, title, why, origin, category, metadata, conf_level, conf_label").in("id", ids) : Promise.resolve({ data: [] }),
      supabase.from("theme_events").select("id, kind, detail, actor, created_at").eq("theme_id", t.id).order("created_at", { ascending: true }),
    ]);
    setSrcSignals((ss ?? []) as Signal[]); setEvents((ev ?? []) as Event[]);
  }
  const open = themes.find((t) => t.id === openId) ?? null;

  async function saveEdit() {
    if (!open || !edit) return;
    await supabase.from("signal_themes").update({ title: edit.title, summary: edit.summary || null, recommendation: edit.recommendation || null, context: edit.context || null }).eq("id", open.id);
    await load();
  }
  async function setGroup(id: string, g: string) { await supabase.from("signal_themes").update({ group_label: g || null }).eq("id", id); await load(); }
  async function toggleWatch(t: Theme) { await supabase.from("signal_themes").update({ watched: !t.watched }).eq("id", t.id); await load(); }
  async function pushToEpic(id: string, epicId: string) { if (!epicId) return; await supabase.from("signal_themes").update({ bundle_id: epicId }).eq("id", id); await load(); }
  async function unpush(id: string) { await supabase.from("signal_themes").update({ bundle_id: null }).eq("id", id); await load(); }

  async function newTheme() {
    setError(null);
    try {
      const orgId = await orgIdOr();
      const { data, error } = await supabase.from("signal_themes").insert({ org_id: orgId, title: "Untitled theme", category: "product", state: "active", merged_by: "human" }).select("id").single();
      if (error) throw error;
      await supabase.from("theme_events").insert({ org_id: orgId, theme_id: (data as { id: string }).id, kind: "created", actor: "human" });
      await load(); const t = { id: (data as { id: string }).id, title: "Untitled theme", summary: null, recommendation: null, conf_level: null, signal_ids: [], group_label: null, merged_by: "human", watched: false, context: null, bundle_id: null } as Theme;
      openTheme(t);
    } catch (e) { setError(errText(e, "Could not create the theme.")); }
  }
  async function addSignalToTheme(signalId: string) {
    if (!open) return;
    try {
      const orgId = await orgIdOr();
      await supabase.from("theme_signals").upsert({ org_id: orgId, theme_id: open.id, signal_id: signalId }, { onConflict: "theme_id,signal_id", ignoreDuplicates: true });
      const next = Array.from(new Set([...(open.signal_ids ?? []), signalId]));
      await supabase.from("signal_themes").update({ signal_ids: next }).eq("id", open.id);
      await supabase.from("theme_events").insert({ org_id: orgId, theme_id: open.id, kind: "evidence_added", detail: { added: 1 }, actor: "human" });
      await load(); await openTheme({ ...open, signal_ids: next });
    } catch (e) { setError(errText(e, "Could not add the signal.")); }
  }
  async function removeSignalFromTheme(signalId: string) {
    if (!open) return;
    await supabase.from("theme_signals").delete().eq("theme_id", open.id).eq("signal_id", signalId);
    const next = (open.signal_ids ?? []).filter((x) => x !== signalId);
    await supabase.from("signal_themes").update({ signal_ids: next }).eq("id", open.id);
    await load(); await openTheme({ ...open, signal_ids: next });
  }

  async function synthesize() { setBusy("synth"); setError(null); try { const { data, error } = await supabase.functions.invoke("synthesize-signals", { body: {}, headers: await authHeader(supabase) }); if (error) throw error; if (data?.error) throw new Error(data.error); await load(); } catch (e) { setError(errText(e, "Synthesis failed.")); } finally { setBusy(null); } }
  async function aiClassify() {
    setBusy("classify"); setError(null);
    try {
      if (!agentKey) throw new Error("No officer available (seed agents first).");
      const ung = themes.filter((t) => !t.group_label);
      if (!ung.length) { setBusy(null); setError("Every theme is already grouped."); return; }
      const list = ung.map((t) => `- ${t.id}: ${t.title}${t.summary ? ` — ${t.summary}` : ""}`).join("\n");
      const prompt = `Classify each product theme into exactly ONE strategic group from: ${GROUPS.map((g) => g.key).join(", ")}.\nReturn ONLY a JSON array, no prose: [{"id":"<theme id>","group":"<group key>"}].\n\nThemes:\n${list}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", { body: { agent_key: agentKey, messages: [{ role: "user", content: prompt }] }, headers: await authHeader(supabase) });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      const m = String(data?.reply ?? "").match(/\[[\s\S]*\]/); if (!m) throw new Error("Couldn't parse the classification.");
      const valid = new Set(GROUPS.map((g) => g.key));
      for (const u of (JSON.parse(m[0]) as { id: string; group: string }[]).filter((x) => x.id && valid.has(x.group))) await supabase.from("signal_themes").update({ group_label: u.group }).eq("id", u.id);
      await load();
    } catch (e) { setError(errText(e, "AI classify failed.")); } finally { setBusy(null); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  const inThemeIds = new Set(open?.signal_ids ?? []);
  const addable = signals.filter((s) => !inThemeIds.has(s.id));
  const sectionOrder = [...GROUPS, { key: "__unsorted", label: "Unsorted", blurb: "Not yet grouped." }];

  return (
    <div>
      <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-label">Merged signals, sorted by group</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={newTheme}>+ New theme</button>
        <button className="btn btn-secondary btn-sm" disabled={busy === "classify"} onClick={aiClassify}>{busy === "classify" ? "Grouping…" : "✦ Group with AI"}</button>
        <button className="btn btn-secondary btn-sm" disabled={busy === "synth"} onClick={synthesize}>{busy === "synth" ? "Synthesizing…" : "↻ Synthesize"}</button>
      </div>
      <Banner>{error}</Banner>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${sectionOrder.length}, minmax(190px, 1fr))`, gap: "var(--sp-3)", overflowX: "auto", alignItems: "start" }}>
        {sectionOrder.map((g) => {
          const list = themes.filter((t) => (g.key === "__unsorted" ? !t.group_label : t.group_label === g.key));
          return (
            <div key={g.key}>
              <div className="t-label">{g.label} · {list.length}</div>
              <div className="t-sub t-muted" style={{ fontSize: 11, marginBottom: "var(--sp-3)" }}>{g.blurb}</div>
              <div className="stack-2">
                {list.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 11.5 }}>—</div>}
                {list.map((t) => (
                  <div key={t.id} className="card card-pad">
                    <div className="row-between" style={{ alignItems: "flex-start", gap: 6 }}>
                      <button onClick={() => openTheme(t)} style={{ background: "none", border: "none", textAlign: "left", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 640, color: "var(--tp)" }}>{t.title}</button>
                      <button title={t.watched ? "Watching" : "Watch"} onClick={() => toggleWatch(t)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: t.watched ? "var(--am-text, #b45309)" : "var(--tm)" }}>{t.watched ? "★" : "☆"}</button>
                    </div>
                    <div className="row gap-2" style={{ marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
                      {t.merged_by === "synthesis" && <Chip tone="violet">AI</Chip>}
                      {confText(t) && <Chip tone="green">{confText(t)}</Chip>}
                      <span className="t-mono-xs t-muted">{(t.signal_ids ?? []).length} sig</span>
                    </div>
                    <div className="row gap-2" style={{ marginTop: 6, alignItems: "center" }}>
                      {t.bundle_id ? <span className="t-mono-xs" style={{ color: "var(--ac-text)" }}>→ {epicTitle(t.bundle_id)}</span>
                        : <button className="btn btn-sm" onClick={() => onStartEpic(t.id)}>Start epic →</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Theme detail */}
      <Modal open={!!open} onClose={() => setOpenId(null)} title={open ? "Theme" : ""} width={640}>
        {open && edit && (
          <div>
            <input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={{ fontSize: 16, fontWeight: 660, marginBottom: 10 }} placeholder="Theme title" />
            <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", flexWrap: "wrap", alignItems: "center" }}>
              {open.merged_by === "synthesis" ? <Chip tone="violet">AI-synthesized</Chip> : <Chip>Human-merged</Chip>}
              {confText(open) && <Chip tone="green">{confText(open)}</Chip>}
              <select className="select" value={open.group_label ?? ""} onChange={(e) => setGroup(open.id, e.target.value)} style={{ flex: "0 0 150px", fontSize: 12 }}>
                <option value="">Unsorted</option>{GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => toggleWatch(open)}>{open.watched ? "★ Watching" : "☆ Watch"}</button>
            </div>

            <L label="Summary"><textarea className="textarea" rows={2} value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} placeholder="What the pattern is." /></L>
            <L label="Recommendation"><textarea className="textarea" rows={2} value={edit.recommendation} onChange={(e) => setEdit({ ...edit, recommendation: e.target.value })} placeholder="So we should…" /></L>
            <L label="Your context"><textarea className="textarea" rows={2} value={edit.context} onChange={(e) => setEdit({ ...edit, context: e.target.value })} placeholder="Add your own context — nuance the synthesis missed." /></L>
            <div className="row gap-2" style={{ marginBottom: "var(--sp-4)" }}><button className="btn btn-sm" onClick={saveEdit}>Save</button></div>

            <PlayActions surfaceKey="strategy_theme" targetId={open.id} targetName={open.title} />

            <div className="row-between" style={{ alignItems: "center", marginBottom: 6, marginTop: "var(--sp-4)" }}>
              <span className="t-label">Sources · {srcSignals.length}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? "Done" : "+ Push signal in"}</button>
            </div>
            <div className="stack-2" style={{ marginBottom: adding ? 10 : "var(--sp-4)" }}>
              {srcSignals.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No source signals yet.</div>}
              {srcSignals.map((s) => (
                <div key={s.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}>
                  <span style={{ minWidth: 0 }}><span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.title}</span>{s.why && <span className="t-sub t-muted" style={{ fontSize: 11.5, marginLeft: 6 }}>{s.why}</span>}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => removeSignalFromTheme(s.id)} style={{ flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
            {adding && (
              <div className="card card-pad" style={{ marginBottom: "var(--sp-4)", maxHeight: 200, overflowY: "auto" }}>
                {addable.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No more product signals to add.</div>}
                {addable.map((s) => (<div key={s.id} className="row-between" style={{ padding: "4px 0", alignItems: "center", gap: 8 }}><span style={{ fontSize: 12.5, minWidth: 0 }}>{s.title}</span><button className="btn btn-sm" onClick={() => addSignalToTheme(s.id)} style={{ flexShrink: 0 }}>+ Add</button></div>))}
              </div>
            )}

            <div className="t-label" style={{ marginBottom: 6 }}>How it was synthesized</div>
            <div className="stack-2" style={{ marginBottom: "var(--sp-4)" }}>
              {events.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No trajectory recorded.</div>}
              {events.map((ev) => (
                <div key={ev.id} className="row gap-2" style={{ fontSize: 11.5, alignItems: "center" }}>
                  <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{new Date(ev.created_at).toLocaleDateString()}</span>
                  <Chip tone={ev.actor === "synthesis" ? "violet" : "default"}>{ev.actor === "synthesis" ? "AI" : ev.actor ?? "system"}</Chip>
                  <span>{EVENT_LABEL[ev.kind] ?? ev.kind}{ev.detail && Object.keys(ev.detail).length ? ` · ${JSON.stringify(ev.detail)}` : ""}</span>
                </div>
              ))}
            </div>

            <div className="row-between" style={{ alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setDelId(open.id)} style={{ color: "var(--rd-text)" }}>Delete theme</button>
              {open.bundle_id ? (
                <span className="row gap-2"><span className="t-mono-xs" style={{ color: "var(--ac-text)" }}>In {epicTitle(open.bundle_id)}</span><button className="btn btn-secondary btn-sm" onClick={() => unpush(open.id)}>Remove from epic</button></span>
              ) : (
                <select className="select" value="" onChange={(e) => pushToEpic(open.id, e.target.value)} style={{ flex: "0 0 200px" }}>
                  <option value="">Push into epic…</option>{epics.map((ep) => <option key={ep.id} value={ep.id}>{ep.title || "Untitled epic"}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
      </Modal>

      {delId && (<ConfirmDialog title="Delete theme?" message="This deletes the theme and its links. The underlying signals stay. This can't be undone." confirmLabel="Delete"
        onConfirm={async () => { const id = delId; setDelId(null); setOpenId(null); await supabase.from("signal_themes").delete().eq("id", id); await load(); }}
        onCancel={() => setDelId(null)} />)}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><div className="t-h2" style={{ fontSize: 12.5, fontWeight: 620, marginBottom: 4 }}>{label}</div>{children}</div>;
}
