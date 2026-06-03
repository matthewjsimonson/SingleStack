"use client";

// Agentic theme drawer — the side pop-out for an intelligence theme (used from
// the Signals homepage and the Map, so neither bounces to a new page). Shows the
// theme, its backing signals, the "so what" (recommendation), an embedded agent
// that gives a tailored read, and the ability to turn it into an initiative IN
// PLACE (no navigation). AI + human, together, on a theme.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { spawnInitiative } from "@/lib/routing";
import { Chip, Confidence } from "@/components/ui";

type Theme = {
  id: string; title: string; summary: string | null; recommendation: string | null;
  state: string | null; momentum: string | null; conf_level: number | null; category: string | null; signal_ids: string[] | null;
};
type Sig = { id: string; title: string; conf_label: string | null };

const OFFICER = (cat: string | null) => (cat === "gtm" ? { key: "cro", name: "CRO" } : { key: "cpo", name: "CPO" });

export default function ThemeDrawer({ themeId, onClose, onChanged }: { themeId: string | null; onClose: () => void; onChanged?: () => void }) {
  const supabase = createClient();
  const open = !!themeId;
  const [theme, setTheme] = useState<Theme | null>(null);
  const [signals, setSignals] = useState<Sig[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [gtms, setGtms] = useState<{ id: string; name: string }[]>([]);
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [rec, setRec] = useState<{ name: string; build: string; gtm: string; why: string } | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [recDone, setRecDone] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!themeId) return;
    setError(null); setTake(null); setRec(null); setRecDone(null);
    const { data: t } = await supabase.from("signal_themes").select("id, title, summary, recommendation, state, momentum, conf_level, category, signal_ids").eq("id", themeId).maybeSingle();
    setTheme(t as Theme | null);
    const ids = (t?.signal_ids as string[] | null) ?? [];
    const [{ data: sigs }, { data: pr }, { data: gt }] = await Promise.all([
      ids.length ? supabase.from("signals").select("id, title, conf_label").in("id", ids) : Promise.resolve({ data: [] as Sig[] }),
      supabase.from("product_records").select("id, name").order("created_at"),
      supabase.from("gtm_records").select("id, name").order("created_at"),
    ]);
    setSignals((sigs ?? []) as Sig[]);
    setProducts(pr ?? []); setGtms(gt ?? []);
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
      const prompt = `Interpret this intelligence theme for me. In 3–4 sentences: the "so what", and the single most important action.\n\nTheme: ${theme.title}\nSummary: ${theme.summary || "—"}\nCurrent recommendation: ${theme.recommendation || "—"}\nState: ${theme.state}/${theme.momentum} · backed by ${signals.length} signal(s): ${signals.slice(0, 6).map((x) => x.title).join("; ")}`;
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

  // Theme -> recommended initiative: the officer drafts a cross-functional PLG
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
      const initId = await spawnInitiative(supabase, orgId, {
        title: rec.name, description: rec.why || null, kind: "feature", scope: "both", lifecycle: "plan", priority: "high",
        productId: products[0]?.id ?? null, gtmRecordId: gtms[0]?.id ?? null,
        signalIds: theme.signal_ids ?? [],
        tasks: [{ area: "build", title: rec.build }, { area: "gtm", title: rec.gtm }],
      });
      setRecDone({ id: initId }); setRec(null); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create initiative."); }
    finally { setRecBusy(false); }
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

          {/* Theme -> recommended PLG initiative (rooted in this theme's evidence) */}
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
