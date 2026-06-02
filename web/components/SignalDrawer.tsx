"use client";

// Agentic signal drawer — the place a human and the relevant officer meet on a
// single signal: read it, edit/add human context, get the officer's "so what"
// inline, and tie it to the things that make it matter (themes → recommendation,
// initiatives → action). This is the HITL depth layer: AI + humans together.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Confidence } from "@/components/ui";

export type DrawerSignal = {
  id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null;
  observed_at: string | null; category: string | null; origin: string; product_id: string | null; source_id?: string | null;
};
const IMPACTS: Record<string, string[]> = {
  product: ["Product strategy", "Roadmap & delivery"],
  gtm: ["GTM & messaging", "Sales enablement"],
  both: ["Product strategy", "GTM & messaging"],
};
type Initiative = { id: string; title: string; lane: string; stage?: string | null };
type LinkedTheme = { id: string; title: string; recommendation: string | null };

const OFFICER = (cat: string | null) => (cat === "gtm" ? { key: "cro", name: "CRO" } : { key: "cpo", name: "CPO" });
// Only lanes that actually have a board are valid destinations (no voids).
const LANES: [string, string][] = [["ship", "Build (Ship)"], ["enablement", "GTM (Enablement)"]];
const LANE_FOR = (cat: string | null) => (cat === "gtm" ? "enablement" : "ship");

export default function SignalDrawer({ signal, onClose, onChanged }: { signal: DrawerSignal | null; onClose: () => void; onChanged: () => void }) {
  const supabase = createClient();
  const open = !!signal;
  const [edit, setEdit] = useState({ title: "", why: "", conf_level: "", category: "" });
  const [context, setContext] = useState("");
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [themes, setThemes] = useState<LinkedTheme[]>([]);
  const [linked, setLinked] = useState<Initiative[]>([]);
  const [allInit, setAllInit] = useState<Initiative[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [lane, setLane] = useState("ship");
  const [source, setSource] = useState<{ label: string; icon: string } | null>(null);

  const load = useCallback(async () => {
    if (!signal) return;
    setError(null); setTake(null);
    setLane(LANE_FOR(signal.category));
    setEdit({ title: signal.title, why: signal.why ?? "", conf_level: signal.conf_level != null ? String(signal.conf_level) : "", category: signal.category ?? "" });
    const [{ data: full }, { data: ls }, { data: lt }, { data: inits }, { data: src }] = await Promise.all([
      supabase.from("signals").select("metadata").eq("id", signal.id).maybeSingle(),
      supabase.from("initiative_signals").select("initiatives ( id, title, lane, stage )").eq("signal_id", signal.id),
      supabase.from("theme_signals").select("signal_themes ( id, title, recommendation )").eq("signal_id", signal.id),
      supabase.from("initiatives").select("id, title, lane").order("created_at", { ascending: false }).limit(100),
      signal.source_id ? supabase.from("sources").select("label, icon").eq("id", signal.source_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setSource(src ? { label: (src as { label?: string }).label ?? "Source", icon: (src as { icon?: string }).icon ?? "🔌" } : null);
    const m = (full?.metadata as Record<string, unknown>) ?? {};
    setMeta(m); setContext(typeof m.context === "string" ? m.context : "");
    // deno-lint-ignore no-explicit-any
    setLinked(((ls ?? []) as any[]).map((r) => r.initiatives).filter(Boolean));
    // deno-lint-ignore no-explicit-any
    setThemes(((lt ?? []) as any[]).map((r) => r.signal_themes).filter(Boolean));
    setAllInit(inits ?? []);
  }, [supabase, signal]);
  useEffect(() => { load(); }, [load]);

  if (!signal) return null;
  const officer = OFFICER(signal.category);

  async function saveEdit() {
    setBusy("edit"); setError(null);
    const lvl = parseFloat(edit.conf_level);
    const { error } = await supabase.from("signals").update({
      title: edit.title.trim() || signal!.title, why: edit.why.trim() || null,
      conf_level: isNaN(lvl) ? null : Math.min(1, Math.max(0, lvl)),
      conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
      category: edit.category || null,
    }).eq("id", signal!.id);
    if (error) setError(error.message); else onChanged();
    setBusy(null);
  }

  async function saveContext() {
    setBusy("context"); setError(null);
    const { error } = await supabase.from("signals").update({ metadata: { ...meta, context: context.trim() || undefined } }).eq("id", signal!.id);
    if (error) setError(error.message); else { setMeta({ ...meta, context: context.trim() }); }
    setBusy(null);
  }

  async function askOfficer() {
    setThinking(true); setError(null); setTake(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const prompt = `Interpret this signal for me. In 3–4 sentences: what's the "so what", and the single most important action you'd recommend.\n\nSignal: ${edit.title}\nWhy it matters: ${edit.why || "(none given)"}\nConfidence: ${edit.conf_level || "n/a"}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: officer.key, messages: [{ role: "user", content: prompt }], context: { area: "signals" } },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTake(data.reply);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the officer."); }
    finally { setThinking(false); }
  }

  async function linkInitiative(initiativeId: string) {
    if (!initiativeId) return;
    setBusy("link"); setError(null);
    const orgId = await getOrgId();
    const { error } = await supabase.from("initiative_signals").insert({ org_id: orgId, initiative_id: initiativeId, signal_id: signal!.id });
    if (error && (error as { code?: string }).code !== "23505") setError(error.message);
    await load(); setBusy(null);
  }
  async function unlink(initiativeId: string) {
    setBusy("link"); setError(null);
    await supabase.from("initiative_signals").delete().eq("initiative_id", initiativeId).eq("signal_id", signal!.id);
    await load(); setBusy(null);
  }
  async function createInitiative() {
    setBusy("create"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { data, error } = await supabase.from("initiatives").insert({
        org_id: orgId, lane, title: edit.title.trim() || signal!.title,
        description: edit.why?.trim() || null, product_id: signal!.product_id ?? null, stage: "backlog", priority: "medium",
      }).select("id").single();
      if (error) throw error;
      await supabase.from("initiative_signals").insert({ org_id: orgId, initiative_id: data.id, signal_id: signal!.id });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create initiative."); }
    setBusy(null);
  }

  const linkedIds = new Set(linked.map((i) => i.id));
  const linkable = allInit.filter((i) => !linkedIds.has(i.id));

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, transition: "opacity 0.18s ease", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap" }}>
              <Confidence label={signal.conf_label} level={signal.conf_level} />
              <Chip tone={signal.origin === "external" ? "violet" : "default"}>{signal.origin}</Chip>
              {signal.category && <Chip tone={signal.category === "gtm" ? "violet" : "accent"}>{signal.category}</Chip>}
            </div>
            <div style={{ fontSize: 16, fontWeight: 680, lineHeight: 1.3 }}>{signal.title}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}

          {/* What it is — detail, source system, who it impacts */}
          <div className="card card-pad">
            {signal.why && <div className="t-body" style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 10 }}>{signal.why}</div>}
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Source</span>
              {source ? <Chip>{source.icon} {source.label}</Chip> : <Chip tone="default">{signal.origin === "external" ? "External · unlinked" : "Manual entry"}</Chip>}
              {signal.observed_at && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{new Date(signal.observed_at).toLocaleDateString()}</span>}
            </div>
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Impacts</span>
              {(IMPACTS[signal.category ?? ""] ?? ["Triage — tag a lens"]).map((x) => <Chip key={x} tone={signal.category === "gtm" ? "violet" : "accent"}>{x}</Chip>)}
            </div>
          </div>

          {/* The so-what — themes + officer take */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>The “so what”</div>
            {themes.length > 0 ? themes.map((t) => (
              <div key={t.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 620 }}>{t.title}</div>
                {t.recommendation && <div className="t-sub" style={{ fontSize: 12.5 }}>→ {t.recommendation}</div>}
              </div>
            )) : <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Not yet tied to a theme. Ask {officer.name} for a read, or tie it to an initiative below.</div>}
            <button className="btn btn-sm" onClick={askOfficer} disabled={thinking} style={{ background: "var(--ac)", color: "#fff" }}>{thinking ? `${officer.name} is reading…` : `✦ Ask ${officer.name}: what's the so-what?`}</button>
            {take && (
              <div className="card card-pad" style={{ marginTop: 10, background: "var(--panel)" }}>
                <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{take}</div>
              </div>
            )}
          </div>

          {/* Tie to an initiative (the action) */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Tied to initiatives</div>
            {linked.length > 0 && (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {linked.map((i) => (
                  <div key={i.id} className="row-between" style={{ gap: 8 }}>
                    <span className="row gap-2"><Chip>{i.lane}</Chip><span style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</span></span>
                    <button className="btn btn-secondary btn-sm" onClick={() => unlink(i.id)} disabled={busy === "link"}>Unlink</button>
                  </div>
                ))}
              </div>
            )}
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {linkable.length > 0 && (
                <select className="select" defaultValue="" onChange={(e) => { linkInitiative(e.target.value); e.target.value = ""; }} disabled={busy === "link"} style={{ maxWidth: 280 }}>
                  <option value="">+ Link existing initiative…</option>
                  {linkable.map((i) => <option key={i.id} value={i.id}>{i.lane} · {i.title}</option>)}
                </select>
              )}
              <select className="select" value={lane} onChange={(e) => setLane(e.target.value)} style={{ maxWidth: 170 }}>
                {LANES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <button className="btn btn-sm" onClick={createInitiative} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "+ Create initiative"}</button>
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Lands in {lane === "ship" ? "Build → Ship" : "Go-to-market → Enablement"}, with this signal linked as its evidence.</div>
          </div>

          {/* Human context */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Your context</div>
            <textarea className="textarea" rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Add what you know that the data doesn't — nuance, caveats, what to do about it. The agents read this." />
            <button className="btn btn-secondary btn-sm" onClick={saveContext} disabled={busy === "context"} style={{ marginTop: 8 }}>{busy === "context" ? "Saving…" : "Save context"}</button>
          </div>

          {/* Edit the signal */}
          <details className="card card-pad">
            <summary className="t-label" style={{ color: "var(--tm)", cursor: "pointer" }}>Edit signal</summary>
            <div style={{ marginTop: 10 }}>
              <label className="field"><span className="t-label">Title</span><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
              <label className="field"><span className="t-label">Why it matters</span><textarea className="textarea" rows={2} value={edit.why} onChange={(e) => setEdit({ ...edit, why: e.target.value })} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
                <label className="field"><span className="t-label">Confidence (0–1)</span><input className="input" value={edit.conf_level} onChange={(e) => setEdit({ ...edit, conf_level: e.target.value })} placeholder="0.7" /></label>
                <label className="field"><span className="t-label">Informs</span>
                  <select className="select" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                    <option value="">Unsorted</option><option value="product">Product</option><option value="gtm">GTM</option><option value="both">Both</option>
                  </select></label>
              </div>
              <button className="btn btn-sm" onClick={saveEdit} disabled={busy === "edit"}>{busy === "edit" ? "Saving…" : "Save changes"}</button>
            </div>
          </details>
        </div>
      </aside>
    </>
  );
}
