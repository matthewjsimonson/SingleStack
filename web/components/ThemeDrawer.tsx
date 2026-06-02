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
type Decision = { id: string; title: string; status: string; rationale: string | null; input_context: string | null; assignee_id: string | null };
type Routed = { id: string; title: string; lane: string };
export type Person = { id: string; name: string; title: string | null; area: string | null };
export type Rec = { id: string; name: string };
export type Init = { id: string; title: string; lane: string; product_id: string | null; gtm_record_id: string | null };

const OFFICER = (cat: string | null) => (cat === "gtm" ? { key: "cro", name: "CRO" } : { key: "cpo", name: "CPO" });

export default function ThemeDrawer({ themeId, onClose, onChanged }: { themeId: string | null; onClose: () => void; onChanged?: () => void }) {
  const supabase = createClient();
  const open = !!themeId;
  const [theme, setTheme] = useState<Theme | null>(null);
  const [signals, setSignals] = useState<Sig[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [routed, setRouted] = useState<Record<string, { id: string; title: string; lane: string }>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [products, setProducts] = useState<Rec[]>([]);
  const [gtms, setGtms] = useState<Rec[]>([]);
  const [inits, setInits] = useState<Init[]>([]);
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [rec, setRec] = useState<{ name: string; build: string; gtm: string; why: string } | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [recDone, setRecDone] = useState<{ id: string } | null>(null);
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
      supabase.from("decision_evidence").select("decisions ( id, title, status, rationale, input_context, assignee_id )").eq("theme_id", themeId),
    ]);
    const [{ data: pl }, { data: pr }, { data: gt }, { data: it }] = await Promise.all([
      supabase.from("people").select("id, name, title, area").eq("is_active", true).order("name"),
      supabase.from("product_records").select("id, name").order("created_at"),
      supabase.from("gtm_records").select("id, name").order("created_at"),
      supabase.from("initiatives").select("id, title, lane, product_id, gtm_record_id").order("created_at", { ascending: false }).limit(100),
    ]);
    setPeople(pl ?? []); setProducts(pr ?? []); setGtms(gt ?? []); setInits((it ?? []) as Init[]);
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

  // Signals -> recommended initiative: the officer drafts a cross-functional PLG
  // initiative (name + a Build action + a GTM action) from this theme's evidence.
  async function recommendInitiative() {
    if (!theme) return;
    setRecBusy(true); setError(null); setRec(null); setRecDone(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const prompt = `Propose ONE product-led-growth initiative from this intelligence. It must span Build and GTM. Reply EXACTLY in this format, nothing else:\nINITIATIVE: <short name>\nBUILD: <one concrete product/build workstream>\nGTM: <one concrete go-to-market workstream>\nWHY: <one sentence tying it to the evidence>\n\nTheme: ${theme.title}\nSummary: ${theme.summary || "—"}\nRecommendation: ${theme.recommendation || "—"}\nSignals: ${signals.slice(0, 6).map((x) => x.title).join("; ")}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", { body: { agent_key: officer.key, messages: [{ role: "user", content: prompt }], context: { area: "signals" } }, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      const txt: string = data.reply ?? "";
      const grab = (k: string) => (txt.match(new RegExp(`${k}:\\s*(.+)`, "i"))?.[1] ?? "").trim();
      setRec({ name: grab("INITIATIVE") || theme.title, build: grab("BUILD") || `Build: ${theme.title}`, gtm: grab("GTM") || `Position: ${theme.title}`, why: grab("WHY") || theme.recommendation || "" });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft an initiative."); }
    finally { setRecBusy(false); }
  }

  async function createRecommended() {
    if (!theme || !rec) return;
    setRecBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { data: ini, error } = await supabase.from("initiatives").insert({
        org_id: orgId, lane: theme.category === "gtm" ? "enablement" : "ship", title: rec.name, description: rec.why || null, kind: "feature",
        scope: "both", lifecycle: "plan", product_id: products[0]?.id ?? null, gtm_record_id: gtms[0]?.id ?? null, stage: "backlog", priority: "high",
      }).select("id").single();
      if (error) throw error;
      await supabase.from("initiative_workstreams").insert([
        { org_id: orgId, initiative_id: ini.id, area: "build", lifecycle_stage: "plan", title: rec.build, stage: "backlog" },
        { org_id: orgId, initiative_id: ini.id, area: "gtm", lifecycle_stage: "plan", title: rec.gtm, stage: "backlog" },
      ]);
      const sids = theme.signal_ids ?? [];
      if (sids.length) await supabase.from("initiative_signals").insert(sids.map((sid) => ({ org_id: orgId, initiative_id: ini.id, signal_id: sid })));
      setRecDone({ id: ini.id }); setRec(null); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create initiative."); }
    finally { setRecBusy(false); }
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

          {/* Signals -> recommended PLG initiative (rooted in this theme's evidence) */}
          <div className="card card-pad" style={{ borderLeft: "3px solid var(--gn)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Initiative (the PLG motion)</div>
            {recDone ? (
              <div className="t-sub" style={{ fontSize: 12.5 }}>✓ Created, rooted in this theme&rsquo;s signals. <a href={`/initiatives/${recDone.id}`} style={{ color: "var(--ac-text)", fontWeight: 600 }}>Open workstreams →</a></div>
            ) : rec ? (
              <div className="stack-3">
                <label className="field"><span className="t-label">Initiative</span><input className="input" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} /></label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
                  <label className="field"><span className="t-label" style={{ color: "var(--ac-text)" }}>Build workstream</span><textarea className="textarea" rows={2} value={rec.build} onChange={(e) => setRec({ ...rec, build: e.target.value })} /></label>
                  <label className="field"><span className="t-label" style={{ color: "var(--vl-text)" }}>GTM workstream</span><textarea className="textarea" rows={2} value={rec.gtm} onChange={(e) => setRec({ ...rec, gtm: e.target.value })} /></label>
                </div>
                {rec.why && <div className="t-sub t-muted" style={{ fontSize: 12 }}>Why: {rec.why}</div>}
                <div className="row gap-2"><button className="btn btn-success btn-sm" onClick={createRecommended} disabled={recBusy}>{recBusy ? "Creating…" : "Create initiative"}</button><button className="btn btn-secondary btn-sm" onClick={() => setRec(null)}>Discard</button></div>
              </div>
            ) : (
              <>
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Turn this intelligence into a cross-functional effort — {officer.name} drafts the Build + GTM workstreams; you tailor and create.</div>
                <button className="btn btn-sm" onClick={recommendInitiative} disabled={recBusy} style={{ background: "var(--gn)", color: "#fff" }}>{recBusy ? "Drafting…" : "✦ Recommend an initiative"}</button>
              </>
            )}
          </div>

          {/* Decisions — made, routed, and managed fully in place */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Decisions</div>
            {decisions.length > 0 ? (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {decisions.map((d) => (
                  <DecisionCard key={d.id} d={d} theme={theme} signalCount={signals.length} routed={routed[d.id]}
                    people={people} products={products} gtms={gtms} inits={inits}
                    reload={async () => { await load(); onChanged?.(); }} />
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
function DecisionCard({ d, theme, signalCount, routed, people, products, gtms, inits, reload }: { d: Decision; theme: Theme | null; signalCount: number; routed?: Routed; people: Person[]; products: Rec[]; gtms: Rec[]; inits: Init[]; reload: () => Promise<void>; }) {
  const supabase = createClient();
  const [rationale, setRationale] = useState(d.rationale ?? "");
  const [input, setInput] = useState(d.input_context ?? "");
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // routing panel state
  const [routing, setRouting] = useState(false);
  const defaultType = theme?.category === "gtm" ? "gtm" : "product";
  const [rt, setRt] = useState<{ recordType: "product" | "gtm"; recordId: string; target: string; assigneeId: string }>(
    { recordType: defaultType, recordId: "", target: "new", assigneeId: d.assignee_id ?? "" });
  const [sugg, setSugg] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const ownerName = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;

  async function patch(fields: Record<string, unknown>, key: string) {
    setBusy(key); setErr(null);
    const { error } = await supabase.from("decisions").update(fields).eq("id", d.id);
    if (error) setErr(error.message); else await reload();
    setBusy(null);
  }

  // Agent suggests an owner by area/role; human confirms (sets rt.assigneeId).
  async function suggestOwner() {
    if (!people.length) { setErr("Add people in Settings → Team first."); return; }
    setSuggesting(true); setErr(null); setSugg(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const roster = people.map((p) => `${p.name} — ${p.title ?? "?"} (${p.area ?? "?"})`).join("; ");
      const officer = theme?.category === "gtm" ? "cro" : "cpo";
      const prompt = `Decision to own: "${d.title}"${rationale ? ` — ${rationale}` : ""} (area: ${theme?.category ?? "general"}). Pick the single best owner from this team and say why in one short sentence. Reply EXACTLY as: NAME — reason.\nTeam: ${roster}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", { body: { agent_key: officer, messages: [{ role: "user", content: prompt }], context: { area: "signals" } }, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      const reply: string = data.reply ?? "";
      const match = people.find((p) => reply.toLowerCase().includes(p.name.toLowerCase()));
      if (match) setRt((r) => ({ ...r, assigneeId: match.id }));
      setSugg(reply.trim());
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not suggest an owner."); }
    finally { setSuggesting(false); }
  }

  // Route the decision INTO an initiative on a specific product/GTM record, with an owner.
  async function route() {
    setBusy("route"); setErr(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const lane = rt.recordType === "gtm" ? "enablement" : "ship";
      const wsArea = rt.recordType === "gtm" ? "gtm" : "build";
      const assignee = rt.assigneeId || null;
      let initiativeId = rt.target;
      if (rt.target === "new") {
        const row: Record<string, unknown> = { org_id: orgId, lane, scope: rt.recordType === "gtm" ? "gtm" : "product", lifecycle: "plan", title: `Act: ${d.title}`, description: rationale || theme?.recommendation || null, decision_id: d.id, assignee_id: assignee, stage: "backlog", priority: "high" };
        row[rt.recordType === "gtm" ? "gtm_record_id" : "product_id"] = rt.recordId || null;
        const { data: ini, error: ie } = await supabase.from("initiatives").insert(row).select("id").single(); if (ie) throw ie;
        initiativeId = ini.id;
      } else {
        const { error: ue } = await supabase.from("initiatives").update({ decision_id: d.id, assignee_id: assignee }).eq("id", rt.target); if (ue) throw ue;
      }
      // seed the matching workstream so the effort is born with the right work
      await supabase.from("initiative_workstreams").insert({ org_id: orgId, initiative_id: initiativeId, area: wsArea, lifecycle_stage: "plan", title: d.title, assignee_id: assignee, stage: "backlog" });
      await supabase.from("decisions").update({ status: "routed", decided_at: new Date().toISOString(), assignee_id: assignee }).eq("id", d.id);
      setRouting(false); await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not route."); }
    setBusy(null);
  }
  async function del() { setBusy("del"); await supabase.from("decisions").delete().eq("id", d.id); await reload(); setBusy(null); }

  const recs = rt.recordType === "gtm" ? gtms : products;
  const targetInits = inits.filter((i) => i.lane === (rt.recordType === "gtm" ? "enablement" : "ship"));

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
        <div className="t-sub" style={{ fontSize: 12, marginBottom: 8 }}>→ Routed to <strong>{routed.lane === "ship" ? "Build · Ship" : "GTM · Enablement"}</strong>: {routed.title}{ownerName(d.assignee_id) ? ` · owner ${ownerName(d.assignee_id)}` : ""}</div>
      ) : (
        <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Evidence: this theme + {signalCount} signal{signalCount === 1 ? "" : "s"}. Write the call, assign an owner, then route it onto an initiative.</div>
      )}

      {/* owner */}
      <label className="field"><span className="t-label">Owner</span>
        <div className="row gap-2">
          <select className="select" value={d.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || null }, "owner")} style={{ flex: 1 }}>
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` · ${p.title}` : ""}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" type="button" onClick={suggestOwner} disabled={suggesting}>{suggesting ? "…" : "✦ Suggest"}</button>
        </div>
      </label>
      {sugg && <div className="t-sub" style={{ fontSize: 12, marginBottom: 8 }}>✦ {sugg}{rt.assigneeId && rt.assigneeId !== (d.assignee_id ?? "") && <> · <button className="btn-link" style={{ background: "none", border: "none", color: "var(--ac-text)", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 12 }} onClick={() => patch({ assignee_id: rt.assigneeId }, "owner")}>Assign {ownerName(rt.assigneeId)}</button></>}</div>}

      {/* the decision / rationale */}
      <label className="field"><span className="t-label">The decision &amp; why</span>
        <textarea className="textarea" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What are we doing, and why — in a sentence or two." /></label>
      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => patch({ rationale: rationale.trim() || null }, "save")} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
        {d.status === "open" && <button className="btn btn-success btn-sm" onClick={() => patch({ status: "decided", decided_at: new Date().toISOString(), rationale: rationale.trim() || null }, "decide")} disabled={busy === "decide"}>Mark decided</button>}
        {d.status !== "routed" && <button className="btn btn-sm" onClick={() => setRouting((v) => !v)}>{routing ? "Cancel route" : "Route to action →"}</button>}
        {d.status !== "open" && <button className="btn btn-secondary btn-sm" onClick={() => patch({ status: "open", decided_at: null }, "reopen")} disabled={busy === "reopen"}>Reopen</button>}
        <button className="btn btn-secondary btn-sm" onClick={del} disabled={busy === "del"} style={{ marginLeft: "auto", color: "var(--rd-text)" }}>Delete</button>
      </div>

      {/* routing panel — onto a specific Product/GTM initiative, with an owner */}
      {routing && (
        <div className="card card-pad" style={{ background: "var(--panel)", marginBottom: 8 }}>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Route onto an initiative</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Lives on</span>
              <select className="select" value={rt.recordType} onChange={(e) => setRt({ ...rt, recordType: e.target.value as "product" | "gtm", recordId: "", target: "new" })}>
                <option value="product">Product (→ Ship)</option><option value="gtm">GTM (→ Enablement)</option>
              </select></label>
            <label className="field"><span className="t-label">{rt.recordType === "gtm" ? "GTM record" : "Product"}</span>
              <select className="select" value={rt.recordId} onChange={(e) => setRt({ ...rt, recordId: e.target.value })}>
                <option value="">— select —</option>{recs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
          </div>
          <label className="field"><span className="t-label">Initiative</span>
            <select className="select" value={rt.target} onChange={(e) => setRt({ ...rt, target: e.target.value })}>
              <option value="new">+ New initiative (&ldquo;Act: {d.title}&rdquo;)</option>
              {targetInits.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
            </select></label>
          <label className="field"><span className="t-label">Owner</span>
            <div className="row gap-2">
              <select className="select" value={rt.assigneeId} onChange={(e) => setRt({ ...rt, assigneeId: e.target.value })} style={{ flex: 1 }}>
                <option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" type="button" onClick={suggestOwner} disabled={suggesting}>{suggesting ? "…" : "✦ Suggest"}</button>
            </div>
          </label>
          <button className="btn btn-sm" onClick={route} disabled={busy === "route"}>{busy === "route" ? "Routing…" : "Route →"}</button>
        </div>
      )}

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
