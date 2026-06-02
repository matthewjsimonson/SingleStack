"use client";

// Agentic theme drawer — the side pop-out for an intelligence theme (used from
// the Signals homepage and the Map, so neither bounces to a new page). Shows the
// theme, its backing signals, the "so what" (recommendation), an embedded agent
// that gives a tailored read, the decisions it already drives, and the ability
// to make a decision IN PLACE (no navigation). AI + human, together, on a theme.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Confidence } from "@/components/ui";

type Theme = {
  id: string; title: string; summary: string | null; recommendation: string | null;
  state: string | null; momentum: string | null; conf_level: number | null; category: string | null; signal_ids: string[] | null;
};
type Sig = { id: string; title: string; conf_label: string | null };
type Decision = { id: string; title: string; status: string; rationale: string | null; input_context: string | null };
type Routed = { id: string; title: string; lane: string };

const OFFICER = (cat: string | null) => (cat === "gtm" ? { key: "cro", name: "CRO" } : { key: "cpo", name: "CPO" });

export default function ThemeDrawer({ themeId, onClose, onChanged }: { themeId: string | null; onClose: () => void; onChanged?: () => void }) {
  const supabase = createClient();
  const open = !!themeId;
  const [theme, setTheme] = useState<Theme | null>(null);
  const [signals, setSignals] = useState<Sig[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [routed, setRouted] = useState<Record<string, { id: string; title: string; lane: string }>>({});
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!themeId) return;
    setError(null); setTake(null);
    const { data: t } = await supabase.from("signal_themes").select("id, title, summary, recommendation, state, momentum, conf_level, category, signal_ids").eq("id", themeId).maybeSingle();
    setTheme(t as Theme | null);
    const ids = (t?.signal_ids as string[] | null) ?? [];
    const [{ data: sigs }, { data: ev }] = await Promise.all([
      ids.length ? supabase.from("signals").select("id, title, conf_label").in("id", ids) : Promise.resolve({ data: [] as Sig[] }),
      supabase.from("decision_evidence").select("decisions ( id, title, status, rationale, input_context )").eq("theme_id", themeId),
    ]);
    setSignals((sigs ?? []) as Sig[]);
    // deno-lint-ignore no-explicit-any
    const decs = ((ev ?? []) as any[]).map((r) => r.decisions).filter(Boolean);
    const seen = new Set<string>();
    const uniq = decs.filter((d: Decision) => (seen.has(d.id) ? false : seen.add(d.id)));
    setDecisions(uniq);
    // routed initiatives (the impact / where each decision went)
    if (uniq.length) {
      const { data: inits } = await supabase.from("initiatives").select("id, title, lane, decision_id").in("decision_id", uniq.map((d) => d.id));
      const map: Record<string, { id: string; title: string; lane: string }> = {};
      for (const it of inits ?? []) if (it.decision_id) map[it.decision_id] = { id: it.id, title: it.title, lane: it.lane };
      setRouted(map);
    } else setRouted({});
  }, [supabase, themeId]);
  useEffect(() => { load(); }, [load]);

  if (!themeId) return null;
  const officer = theme ? OFFICER(theme.category) : { key: "cpo", name: "CPO" };

  async function ask() {
    if (!theme) return;
    setThinking(true); setError(null); setTake(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const prompt = `Interpret this intelligence theme for me. In 3–4 sentences: the "so what", and the single most important decision or action.\n\nTheme: ${theme.title}\nSummary: ${theme.summary || "—"}\nCurrent recommendation: ${theme.recommendation || "—"}\nState: ${theme.state}/${theme.momentum} · backed by ${signals.length} signal(s): ${signals.slice(0, 6).map((x) => x.title).join("; ")}`;
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

  async function makeDecision() {
    if (!theme) return;
    setBusy("decision"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { data: dec, error } = await supabase.from("decisions").insert({ org_id: orgId, title: theme.title, status: "open", scope: "org", theme_id: theme.id }).select("id").single();
      if (error) throw error;
      const evidence: Record<string, unknown>[] = [{ org_id: orgId, decision_id: dec.id, theme_id: theme.id }];
      for (const sid of theme.signal_ids ?? []) evidence.push({ org_id: orgId, decision_id: dec.id, signal_id: sid });
      await supabase.from("decision_evidence").insert(evidence);
      await load(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create decision."); }
    setBusy(null);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, transition: "opacity 0.18s ease", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap" }}>
              {theme?.category && <Chip tone={theme.category === "gtm" ? "violet" : "accent"}>{theme.category}</Chip>}
              {theme?.state && <Chip>{theme.state}{theme.momentum ? ` · ${theme.momentum}` : ""}</Chip>}
              <Confidence label={theme?.conf_level != null ? (theme.conf_level >= 0.75 ? "High" : theme.conf_level >= 0.5 ? "Med" : "Low") : null} level={theme?.conf_level ?? null} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 680, lineHeight: 1.3 }}>{theme?.title ?? "Theme"}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}
          {theme?.summary && <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }}>{theme.summary}</div>}

          {/* The so-what + officer read */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>The “so what”</div>
            {theme?.recommendation ? <div className="t-body" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>→ {theme.recommendation}</div> : <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No recommendation yet.</div>}
            <button className="btn btn-sm" onClick={ask} disabled={thinking} style={{ background: "var(--ac)", color: "#fff" }}>{thinking ? `${officer.name} is reading…` : `✦ Ask ${officer.name}`}</button>
            {take && <div className="card card-pad" style={{ marginTop: 10, background: "var(--panel)" }}><div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{take}</div></div>}
          </div>

          {/* Decisions — made, routed, and managed fully in place */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Decisions</div>
            {decisions.length > 0 ? (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {decisions.map((d) => (
                  <DecisionCard key={d.id} d={d} theme={theme} signalCount={signals.length} routed={routed[d.id]} reload={async () => { await load(); onChanged?.(); }} />
                ))}
              </div>
            ) : <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No decision yet. Turn this theme into a decision — its signals carry over as evidence.</div>}
            <button className="btn btn-sm" onClick={makeDecision} disabled={busy === "decision"}>{busy === "decision" ? "Creating…" : "+ Make a decision"}</button>
          </div>

          {/* Backing signals */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Backed by {signals.length} signal{signals.length === 1 ? "" : "s"}</div>
            {signals.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No linked signals.</div> : (
              <div className="stack-3">
                {signals.map((s) => (
                  <div key={s.id} className="row-between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{s.title}</span>
                    {s.conf_label && <Chip>{s.conf_label}</Chip>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// A decision, fully managed in place: evidence → rationale → decide → route, plus
// request-input (copy a summary to share on Slack/email, paste the reply back as
// context). No second screen.
function DecisionCard({ d, theme, signalCount, routed, reload }: { d: Decision; theme: Theme | null; signalCount: number; routed?: Routed; reload: () => Promise<void>; }) {
  const supabase = createClient();
  const [rationale, setRationale] = useState(d.rationale ?? "");
  const [input, setInput] = useState(d.input_context ?? "");
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function patch(fields: Record<string, unknown>, key: string) {
    setBusy(key); setErr(null);
    const { error } = await supabase.from("decisions").update(fields).eq("id", d.id);
    if (error) setErr(error.message); else await reload();
    setBusy(null);
  }
  async function route() {
    setBusy("route"); setErr(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const lane = theme?.category === "gtm" ? "enablement" : "ship";
      const { error: ie } = await supabase.from("initiatives").insert({ org_id: orgId, lane, title: `Act: ${d.title}`, description: rationale || theme?.recommendation || null, decision_id: d.id, stage: "backlog", priority: "high" });
      if (ie) throw ie;
      await supabase.from("decisions").update({ status: "routed", decided_at: new Date().toISOString() }).eq("id", d.id);
      await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not route."); }
    setBusy(null);
  }
  async function del() { setBusy("del"); await supabase.from("decisions").delete().eq("id", d.id); await reload(); setBusy(null); }

  const summary = `Decision: ${d.title}\n\nContext (theme): ${theme?.title ?? ""}\n${theme?.summary ? theme.summary + "\n" : ""}Backed by ${signalCount} signal(s).\n\nLeaning: ${rationale || "(undecided)"}\n\nWhat's your take? Reply and I'll fold it in.`;
  const mailto = `mailto:?subject=${encodeURIComponent("Input needed: " + d.title)}&body=${encodeURIComponent(summary)}`;
  async function copy() { try { await navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } }

  return (
    <div className="card card-pad" style={{ background: "var(--panel-2)", padding: 12 }}>
      {err && <div className="banner banner-error" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="row-between" style={{ gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 620 }}>{d.title}</span>
        <Chip tone={d.status === "open" ? "amber" : d.status === "routed" ? "accent" : "green"}>{d.status}</Chip>
      </div>

      {/* evidence + impact */}
      {routed ? (
        <div className="t-sub" style={{ fontSize: 12, marginBottom: 8 }}>→ Routed to <strong>{routed.lane === "ship" ? "Build · Ship" : "GTM · Enablement"}</strong>: {routed.title}</div>
      ) : (
        <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Evidence: this theme + {signalCount} signal{signalCount === 1 ? "" : "s"}. Write the call, then route it into action.</div>
      )}

      {/* the decision / rationale */}
      <label className="field"><span className="t-label">The decision &amp; why</span>
        <textarea className="textarea" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What are we doing, and why — in a sentence or two." /></label>
      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => patch({ rationale: rationale.trim() || null }, "save")} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
        {d.status === "open" && <button className="btn btn-success btn-sm" onClick={() => patch({ status: "decided", decided_at: new Date().toISOString(), rationale: rationale.trim() || null }, "decide")} disabled={busy === "decide"}>Mark decided</button>}
        {d.status !== "routed" && <button className="btn btn-sm" onClick={route} disabled={busy === "route"}>{busy === "route" ? "Routing…" : "Route to action →"}</button>}
        {d.status !== "open" && <button className="btn btn-secondary btn-sm" onClick={() => patch({ status: "open", decided_at: null }, "reopen")} disabled={busy === "reopen"}>Reopen</button>}
        <button className="btn btn-secondary btn-sm" onClick={del} disabled={busy === "del"} style={{ marginLeft: "auto", color: "var(--rd-text)" }}>Delete</button>
      </div>

      {/* request input from a colleague (Slack/email), fold the reply back in */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        {!asking ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setAsking(true)}>✉ Request input</button>
        ) : (
          <div className="stack-3">
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? "Copied ✓" : "Copy summary"}</button>
              <a className="btn btn-secondary btn-sm" href={mailto}>Open in email</a>
              <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>paste into Slack/email, then drop their reply below</span>
            </div>
            <label className="field"><span className="t-label">Input received</span>
              <textarea className="textarea" rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste their response here — it becomes context on this decision." /></label>
            <div className="row gap-2"><button className="btn btn-sm" onClick={() => patch({ input_context: input.trim() || null }, "input")} disabled={busy === "input"}>{busy === "input" ? "Saving…" : "Save input"}</button><button className="btn btn-secondary btn-sm" onClick={() => setAsking(false)}>Done</button></div>
          </div>
        )}
        {d.input_context && !asking && <div className="t-sub" style={{ fontSize: 12, marginTop: 6 }}><strong>Input:</strong> {d.input_context}</div>}
      </div>
    </div>
  );
}
