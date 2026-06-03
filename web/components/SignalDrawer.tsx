"use client";

// Signal drawer — read one signal, ask the relevant officer about it (a short
// chat with a few ready-made prompts), tie it to an initiative (assign an
// existing one OR have the officer recommend a new one), and otherwise dismiss
// it. Dismiss is a hard delete: a thrown-away signal just goes away — it does
// NOT feed the agents. What informs the agents is what you ACT on (a signal you
// add to an initiative), not what you discard.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { spawnInitiative } from "@/lib/routing";
import { Chip, Confidence, ConfirmDialog, SourceChip } from "@/components/ui";

export type DrawerSignal = {
  id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null;
  observed_at: string | null; category: string | null; origin: string; product_id: string | null; source_id?: string | null;
};
type Initiative = { id: string; title: string; scope: string; stage?: string | null };
type LinkedTheme = { id: string; title: string; recommendation: string | null };
type ChatMsg = { role: "user" | "assistant"; content: string; runId?: string | null; rating?: "helpful" | "not_helpful" | null };
type Rec = { name: string; scope: string; build: string; gtm: string; why: string };

const OFFICER = (cat: string | null) => (cat === "gtm" ? { key: "cro", name: "CRO" } : { key: "cpo", name: "CPO" });
// An initiative is cross-functional — you choose its SCOPE (which sides have
// work), not a single lane. Scope seeds a starter task on each chosen side.
const SCOPES: [string, string][] = [["product", "Build"], ["gtm", "GTM"], ["both", "Both"]];
const SCOPE_FOR = (cat: string | null) => (cat === "gtm" ? "gtm" : cat === "both" ? "both" : "product");
const scopeLabel = (s: string) => SCOPES.find(([k]) => k === s)?.[1] ?? s;
const tasksForScope = (scope: string, title: string): { area: "build" | "gtm"; title: string }[] =>
  scope === "gtm" ? [{ area: "gtm", title }]
    : scope === "both" ? [{ area: "build", title }, { area: "gtm", title }]
    : [{ area: "build", title }];

// Ready-made prompts so the operator doesn't have to think of how to ask.
const PRESETS: { label: string; q: string }[] = [
  { label: "What's the so-what?", q: "In 3–4 sentences: what's the 'so what' of this signal, and the single most important action you'd recommend?" },
  { label: "Impact on initiatives", q: "How does this signal impact our current initiatives — does it reinforce, threaten, or reprioritize any of them? Name them if you can." },
  { label: "Are we addressing it?", q: "Are we already addressing this through an existing initiative, record, or workstream? If so, where; if not, say so plainly." },
];

// Surface an external link if the signal carries one in its metadata.
function firstLink(meta: Record<string, unknown>): string | null {
  for (const k of ["url", "link", "source_url", "href"]) {
    const v = meta[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

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
  const [scope, setScope] = useState("product");
  const [source, setSource] = useState<{ label: string; icon: string } | null>(null);
  // Ask-an-agent chat
  const [thread, setThread] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  // Recommend-an-initiative draft
  const [rec, setRec] = useState<Rec | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  // Hard-dismiss confirmation
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  const load = useCallback(async () => {
    if (!signal) return;
    setError(null); setThread([]); setChatInput(""); setRec(null); setConfirmDismiss(false);
    setScope(SCOPE_FOR(signal.category));
    setEdit({ title: signal.title, why: signal.why ?? "", conf_level: signal.conf_level != null ? String(signal.conf_level) : "", category: signal.category ?? "" });
    const [{ data: full }, { data: ls }, { data: lt }, { data: inits }, { data: src }] = await Promise.all([
      supabase.from("signals").select("metadata").eq("id", signal.id).maybeSingle(),
      supabase.from("initiative_signals").select("initiatives ( id, title, scope, stage )").eq("signal_id", signal.id),
      supabase.from("theme_signals").select("signal_themes ( id, title, recommendation )").eq("signal_id", signal.id),
      supabase.from("initiatives").select("id, title, scope").order("created_at", { ascending: false }).limit(100),
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
  const link = firstLink(meta);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  // The signal is the subject of the chat. Fold its details into the FIRST user
  // turn only (keeps the visible thread clean and roles alternating).
  function payloadFor(t: ChatMsg[]): ChatMsg[] {
    const preamble = `We're discussing ONE signal. Treat it as the subject of this conversation.\nSignal: ${edit.title}\nWhy it matters: ${edit.why || "(none given)"}\nConfidence: ${edit.conf_level || "n/a"}\nInforms: ${edit.category || "untriaged"}${context ? `\nOperator's context: ${context}` : ""}`;
    return t.map((m, i) => (i === 0 && m.role === "user" ? { ...m, content: `${preamble}\n\n${m.content}` } : m));
  }

  async function ask(q: string) {
    const next: ChatMsg[] = [...thread, { role: "user", content: q }];
    setThread(next); setChatBusy(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: officer.key, messages: payloadFor(next), context: { area: "signals" } },
        headers: (await token()) ? { Authorization: `Bearer ${await token()}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setThread([...next, { role: "assistant", content: data.reply, runId: data.run_id ?? null }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the officer."); }
    finally { setChatBusy(false); }
  }
  // Outcome loop: rate the officer's answer — feeds back into its future answers + skill evolution.
  async function rate(i: number, rating: "helpful" | "not_helpful") {
    const m = thread[i]; if (!m?.runId) return;
    setThread((t) => t.map((x, j) => (j === i ? { ...x, rating } : x)));
    await supabase.from("agent_runs").update({ rating, rated_at: new Date().toISOString() }).eq("id", m.runId);
  }
  function sendFree() {
    const q = chatInput.trim();
    if (!q || chatBusy) return;
    setChatInput("");
    ask(q);
  }

  async function recommendInitiative() {
    setRecBusy(true); setError(null);
    try {
      const prompt = `Propose ONE initiative from this signal. Reply EXACTLY in this format, nothing else:\nINITIATIVE: <short name>\nSCOPE: <product|gtm|both>\nBUILD: <one concrete build workstream, or ->\nGTM: <one concrete go-to-market workstream, or ->\nWHY: <one sentence tying it to the signal>\n\nSignal: ${edit.title}\nWhy it matters: ${edit.why || "—"}\nInforms: ${edit.category || "untriaged"}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: officer.key, messages: [{ role: "user", content: prompt }], context: { area: "signals" } },
        headers: (await token()) ? { Authorization: `Bearer ${await token()}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const txt = String(data.reply ?? "");
      const grab = (re: RegExp) => (txt.match(re)?.[1] ?? "").trim();
      const sc = grab(/SCOPE:\s*(.+)/i).toLowerCase();
      const clean = (s: string) => (s === "-" || s === "—" ? "" : s);
      setRec({
        name: grab(/INITIATIVE:\s*(.+)/i) || edit.title,
        scope: ["product", "gtm", "both"].includes(sc) ? sc : SCOPE_FOR(signal!.category),
        build: clean(grab(/BUILD:\s*(.+)/i)),
        gtm: clean(grab(/GTM:\s*(.+)/i)),
        why: grab(/WHY:\s*(.+)/i),
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft an initiative."); }
    finally { setRecBusy(false); }
  }

  async function createRecommended() {
    if (!rec) return;
    setRecBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const tasks: { area: "build" | "gtm"; title: string }[] = [];
      if (rec.scope !== "gtm") tasks.push({ area: "build", title: rec.build || rec.name });
      if (rec.scope !== "product") tasks.push({ area: "gtm", title: rec.gtm || rec.name });
      await spawnInitiative(supabase, orgId, {
        title: rec.name, description: rec.why || edit.why?.trim() || null,
        scope: rec.scope as "product" | "gtm" | "both", priority: "high",
        productId: signal!.product_id ?? null, signalIds: [signal!.id], tasks,
      });
      setRec(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create initiative."); }
    finally { setRecBusy(false); }
  }

  async function saveContext() {
    setBusy("context"); setError(null);
    const { error } = await supabase.from("signals").update({ metadata: { ...meta, context: context.trim() || undefined } }).eq("id", signal!.id);
    if (error) setError(error.message); else setMeta({ ...meta, context: context.trim() });
    setBusy(null);
  }

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
      const title = edit.title.trim() || signal!.title;
      await spawnInitiative(supabase, orgId, {
        title, description: edit.why?.trim() || null, scope: scope as "product" | "gtm" | "both",
        priority: "medium", productId: signal!.product_id ?? null,
        signalIds: [signal!.id], tasks: tasksForScope(scope, title),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create initiative."); }
    setBusy(null);
  }

  // Hard dismiss — the signal just goes away (cascades clean up any links).
  async function dismiss() {
    setBusy("dismiss"); setError(null);
    const { error } = await supabase.from("signals").delete().eq("id", signal!.id);
    if (error) { setError(error.message); setBusy(null); return; }
    onChanged(); onClose();
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

          {/* Overview — a short description, a link if there is one, provenance. */}
          <div className="card card-pad">
            {signal.why
              ? <div className="t-body" style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 10 }}>{signal.why}</div>
              : <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No description.</div>}
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
              {source
                ? <SourceChip icon={source.icon} label={source.label} when={signal.observed_at ? new Date(signal.observed_at).toLocaleDateString() : null} />
                : <SourceChip label={signal.origin === "external" ? "External · unlinked" : "Manual entry"} when={signal.observed_at ? new Date(signal.observed_at).toLocaleDateString() : null} />}
              {link && <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ac-text)" }}>Open source ↗</a>}
            </div>
          </div>

          {/* Ask an agent — a button that opens a short chat with ready prompts. */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="row-between" style={{ alignItems: "center", marginBottom: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Ask {officer.name}</span>
              {thread.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => { setThread([]); setChatInput(""); }}>Clear</button>}
            </div>
            {themes.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {themes.map((t) => (
                  <div key={t.id} style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 620 }}>Theme: {t.title}</span>
                    {t.recommendation && <span className="t-sub" style={{ fontSize: 12 }}> — {t.recommendation}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Conversation */}
            {thread.length > 0 && (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {thread.map((m, i) => (
                  <div key={i} className="card card-pad" style={{ background: m.role === "user" ? "var(--panel)" : "var(--fill)", borderLeft: m.role === "assistant" ? "2px solid var(--ac)" : undefined }}>
                    <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>{m.role === "user" ? "You" : officer.name}</div>
                    <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.content}</div>
                    {m.role === "assistant" && m.runId && (
                      <div className="row gap-2" style={{ marginTop: 6 }}>
                        {m.rating
                          ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{m.rating === "helpful" ? "marked helpful ✓" : "marked not helpful ✓"}</span>
                          : <><button className="btn btn-secondary btn-sm" onClick={() => rate(i, "helpful")}>Helpful</button><button className="btn btn-secondary btn-sm" onClick={() => rate(i, "not_helpful")}>Not helpful</button></>}
                      </div>
                    )}
                  </div>
                ))}
                {chatBusy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{officer.name} is thinking…</div>}
              </div>
            )}

            {/* Ready-made prompts */}
            <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
              {PRESETS.map((p) => (
                <button key={p.label} className="chip" style={{ cursor: "pointer" }} disabled={chatBusy} onClick={() => ask(p.q)}>{p.label}</button>
              ))}
            </div>

            {/* Free-form question */}
            <div className="row gap-2">
              <input className="input" style={{ flex: 1 }} value={chatInput} disabled={chatBusy}
                placeholder={`Ask ${officer.name} anything about this signal…`}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendFree(); } }} />
              <button className="btn btn-sm" style={{ background: "var(--ac)", color: "#fff" }} disabled={chatBusy || !chatInput.trim()} onClick={sendFree}>Send</button>
            </div>
          </div>

          {/* Initiatives — assign to an existing one, or have the officer recommend one. */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Tied to initiatives</div>
            {linked.length > 0 && (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {linked.map((i) => (
                  <div key={i.id} className="row-between" style={{ gap: 8 }}>
                    <span className="row gap-2"><Chip>{scopeLabel(i.scope)}</Chip><span style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</span></span>
                    <button className="btn btn-secondary btn-sm" onClick={() => unlink(i.id)} disabled={busy === "link"}>Unlink</button>
                  </div>
                ))}
              </div>
            )}

            {/* Assign to an existing initiative */}
            {linkable.length > 0 && (
              <select className="select" defaultValue="" onChange={(e) => { linkInitiative(e.target.value); e.target.value = ""; }} disabled={busy === "link"} style={{ maxWidth: 320, marginBottom: 8 }}>
                <option value="">+ Assign to an existing initiative…</option>
                {linkable.map((i) => <option key={i.id} value={i.id}>{scopeLabel(i.scope)} · {i.title}</option>)}
              </select>
            )}

            {/* Recommend a new one (officer drafts), or create one manually */}
            {rec ? (
              <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                <label className="field"><span className="t-label">Initiative</span><input className="input" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} /></label>
                <label className="field"><span className="t-label">Scope</span>
                  <select className="select" value={rec.scope} onChange={(e) => setRec({ ...rec, scope: e.target.value })}>
                    {SCOPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select></label>
                {rec.scope !== "gtm" && <label className="field"><span className="t-label" style={{ color: "var(--ac-text)" }}>Build workstream</span><textarea className="textarea" rows={2} value={rec.build} onChange={(e) => setRec({ ...rec, build: e.target.value })} /></label>}
                {rec.scope !== "product" && <label className="field"><span className="t-label" style={{ color: "var(--vl-text)" }}>GTM workstream</span><textarea className="textarea" rows={2} value={rec.gtm} onChange={(e) => setRec({ ...rec, gtm: e.target.value })} /></label>}
                {rec.why && <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>Why: {rec.why}</div>}
                <div className="row gap-2"><button className="btn btn-success btn-sm" onClick={createRecommended} disabled={recBusy}>{recBusy ? "Creating…" : "Create initiative"}</button><button className="btn btn-secondary btn-sm" onClick={() => setRec(null)}>Discard</button></div>
              </div>
            ) : (
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-sm" style={{ background: "var(--gn)", color: "#fff" }} onClick={recommendInitiative} disabled={recBusy}>{recBusy ? "Drafting…" : `Recommend an initiative`}</button>
                <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} style={{ maxWidth: 150 }}>
                  {SCOPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm" onClick={createInitiative} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "+ Create manually"}</button>
              </div>
            )}
          </div>

          {/* Your context */}
          <details className="card card-pad">
            <summary className="t-label" style={{ color: "var(--tm)", cursor: "pointer" }}>Your context</summary>
            <div style={{ marginTop: 10 }}>
              <textarea className="textarea" rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Add what you know that the data doesn't — nuance, caveats. The agents read this." />
              <button className="btn btn-secondary btn-sm" onClick={saveContext} disabled={busy === "context"} style={{ marginTop: 8 }}>{busy === "context" ? "Saving…" : "Save context"}</button>
            </div>
          </details>

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

        {/* Footer — dismiss (hard delete). */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDismiss(true)} disabled={busy === "dismiss"}>Dismiss signal</button>
        </div>
      </aside>

      {confirmDismiss && (
        <ConfirmDialog
          title="Dismiss signal?"
          message="This removes the signal for good. It won't inform the agents — dismissed signals just go away."
          confirmLabel={busy === "dismiss" ? "Removing…" : "Dismiss"}
          onConfirm={dismiss}
          onCancel={() => setConfirmDismiss(false)}
        />
      )}
    </>
  );
}
