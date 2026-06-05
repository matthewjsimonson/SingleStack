"use client";

// Market intel — a Perplexity-style DISCOVER feed of market stories, filtered by
// INDUSTRY and PERSONA. You SET signals (internal or external observations) and
// they serve up as story cards; open one for the full story and DEEPEN it with
// the analyst (an in-context play — a specific function, rendered inline, not a
// floating box). Backed by signals where metadata.domain='market'.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { fireWorkflows } from "@/lib/triggers";
import { Chip, Banner, Confidence, Modal } from "@/components/ui";
import { fetchAgentKey, errText } from "@/lib/strategy";
import { LiveReply, useAliveReply, streamAgentChat } from "@/components/alive";

type Meta = { domain?: string; lens?: string; industry?: string; persona?: string } | null;
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; origin: string; metadata: Meta };

const INDUSTRY_SEED = ["SaaS", "Fintech", "Healthcare", "E-commerce", "Manufacturing", "Media", "Public sector", "Security"];
const PERSONA_SEED = ["Product leader", "Engineering leader", "Marketing leader", "Sales leader", "Executive buyer", "End user", "Analyst"];

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 86400 ? `${Math.max(1, Math.round(s / 3600))}h ago` : `${Math.round(s / 86400)}d ago`;
}

export default function MarketView() {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Signal | null>(null);
  const [composing, setComposing] = useState(false);
  const [agentKey, setAgentKey] = useState<string | null>(null);

  const [fOrigin, setFOrigin] = useState<"all" | "internal" | "external">("all");
  const [fIndustry, setFIndustry] = useState("all");
  const [fPersona, setFPersona] = useState("all");

  const [form, setForm] = useState({ title: "", why: "", origin: "external", industry: "", persona: "", conf: "0.7" });
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState<string | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const reply = useAliveReply();

  const load = useCallback(async () => {
    const { data } = await supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, origin, metadata").order("observed_at", { ascending: false, nullsFirst: false });
    setSignals(((data ?? []) as Signal[]).filter((s) => s.metadata?.domain === "market"));
    setAgentKey(await fetchAgentKey(supabase));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const distinct = (k: "industry" | "persona") => Array.from(new Set(signals.map((s) => s.metadata?.[k]).filter((v): v is string => !!v)));
  const industries = Array.from(new Set([...distinct("industry"), ...INDUSTRY_SEED]));
  const personas = Array.from(new Set([...distinct("persona"), ...PERSONA_SEED]));

  const feed = signals.filter((s) =>
    (fOrigin === "all" || s.origin === fOrigin) &&
    (fIndustry === "all" || s.metadata?.industry === fIndustry) &&
    (fPersona === "all" || s.metadata?.persona === fPersona));

  async function setSignal(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(form.conf);
      const { data: sig, error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", origin: form.origin, title: form.title.trim(), why: form.why.trim() || null,
        conf_level: isNaN(lvl) ? null : lvl, conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
        observed_at: new Date().toISOString(),
        metadata: { domain: "market", industry: form.industry.trim() || undefined, persona: form.persona.trim() || undefined },
      }).select("id").single();
      if (error) throw error;
      await fireWorkflows(supabase, orgId, "on_signal", { label: form.title.trim(), why: form.why.trim() || undefined, signalId: sig?.id });
      setComposing(false); setForm({ title: "", why: "", origin: "external", industry: "", persona: "", conf: "0.7" }); await load();
    } catch (e) { setError(errText(e, "Could not set the signal.")); } finally { setBusy(false); }
  }

  // In-context PLAY: the analyst deepens the story into a briefing (real agent-chat).
  async function deepen(s: Signal) {
    setDeepBusy(true); setDeep(null); setError(null); reply.begin();
    try {
      if (!agentKey) throw new Error("No analyst available (seed agents first).");
      const tags = [s.metadata?.industry, s.metadata?.persona].filter(Boolean).join(" / ");
      const prompt = `You are a market analyst. Expand this market signal into a tight briefing (4–6 sentences): what's happening, why it matters for our product and positioning, and the specific implication${tags ? ` for ${tags}` : ""}. Return only the briefing prose.\n\nSignal: ${s.title}${s.why ? `\nContext: ${s.why}` : ""}\nSource: ${s.origin}`;
      const { data: sess } = await supabase.auth.getSession();
      await streamAgentChat({ agentKey, messages: [{ role: "user", content: prompt }], token: sess.session?.access_token, onChunk: reply.onChunk, onThinking: reply.onThinking, fnName: "agent-run", fallbackFnName: "agent-chat" });
      reply.finish();
    } catch (e) { reply.reset(); setError(errText(e, "Deepen failed.")); } finally { setDeepBusy(false); }
  }
  // Commit the briefing once it's fully typed out.
  useEffect(() => {
    if (!deepBusy && !reply.typing && reply.display) { setDeep(reply.display); reply.reset(); }
  }, [deepBusy, reply.typing, reply.display, reply.reset]);

  const Pills = ({ value, set, options }: { value: string; set: (v: string) => void; options: string[] }) => (
    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
      <button className={`btn btn-sm ${value === "all" ? "" : "btn-secondary"}`} onClick={() => set("all")}>All</button>
      {options.map((o) => <button key={o} className={`btn btn-sm ${value === o ? "" : "btn-secondary"}`} onClick={() => set(o)}>{o}</button>)}
    </div>
  );

  return (
    <div>
      <div className="row-between" style={{ alignItems: "flex-end", marginBottom: "var(--sp-4)" }}>
        <div><h1 className="t-page">Market intel</h1><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>What&apos;s happening across industries and personas — internal and external signals, served as stories.</div></div>
        <button className="btn" onClick={() => setComposing(true)}>+ Set signal</button>
      </div>
      <Banner>{error}</Banner>

      <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
        <div className="stack-2">
          <div className="row gap-2" style={{ alignItems: "center" }}><span className="t-label" style={{ width: 72 }}>Source</span><Pills value={fOrigin} set={(v) => setFOrigin(v as "all" | "internal" | "external")} options={["internal", "external"]} /></div>
          <div className="row gap-2" style={{ alignItems: "center" }}><span className="t-label" style={{ width: 72 }}>Industry</span><Pills value={fIndustry} set={setFIndustry} options={industries} /></div>
          <div className="row gap-2" style={{ alignItems: "center" }}><span className="t-label" style={{ width: 72 }}>Persona</span><Pills value={fPersona} set={setFPersona} options={personas} /></div>
        </div>
      </div>

      {loading ? <div className="t-sub t-muted">Loading…</div> : feed.length === 0 ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No stories yet</div><div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Set a signal — an internal or external observation about an industry or persona — and it shows up here as a story.</div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "var(--sp-4)" }}>
          {feed.map((s) => (
            <button key={s.id} onClick={() => { setOpen(s); setDeep(null); reply.reset(); }} className="card card-link" style={{ textAlign: "left", padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "14px 16px", flex: 1 }}>
                <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
                  <Chip tone={s.origin === "external" ? "violet" : "default"}>{s.origin}</Chip>
                  {s.metadata?.industry && <Chip tone="accent">{s.metadata.industry}</Chip>}
                  {s.metadata?.persona && <Chip>{s.metadata.persona}</Chip>}
                </div>
                <div style={{ fontSize: 15, fontWeight: 660, lineHeight: 1.3, marginBottom: 6 }}>{s.title}</div>
                {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.why}</div>}
              </div>
              <div className="row-between" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", alignItems: "center" }}>
                <Confidence label={s.conf_label} level={s.conf_level} />
                {s.observed_at && <span className="t-mono-xs t-muted">{ago(s.observed_at)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Set-signal composer */}
      <Modal open={composing} onClose={() => setComposing(false)} title="Set a market signal" width={540}>
        <form onSubmit={setSignal}>
          <div className="row gap-2" style={{ marginBottom: 10 }}>
            {(["external", "internal"] as const).map((o) => <button key={o} type="button" className={`btn btn-sm ${form.origin === o ? "" : "btn-secondary"}`} onClick={() => setForm({ ...form, origin: o })}>{o === "external" ? "External" : "Internal"}</button>)}
            <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>{form.origin === "external" ? "from the market / outside" : "from our own tools & engagements"}</span>
          </div>
          <input className="input" autoFocus placeholder="What did you observe? (the headline)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ marginBottom: 8 }} />
          <textarea className="textarea" rows={3} placeholder="The story — why it matters" value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} style={{ marginBottom: 8 }} />
          <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <input className="input" list="md-industries" placeholder="Industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} style={{ flex: "1 1 160px" }} />
            <datalist id="md-industries">{industries.map((i) => <option key={i} value={i} />)}</datalist>
            <input className="input" list="md-personas" placeholder="Persona" value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} style={{ flex: "1 1 160px" }} />
            <datalist id="md-personas">{personas.map((p) => <option key={p} value={p} />)}</datalist>
            <select className="select" value={form.conf} onChange={(e) => setForm({ ...form, conf: e.target.value })} style={{ flex: "0 0 130px" }}>
              <option value="0.9">High conf.</option><option value="0.7">Medium conf.</option><option value="0.4">Low conf.</option>
            </select>
          </div>
          <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Setting…" : "Set signal"}</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setComposing(false)}>Cancel</button></div>
        </form>
      </Modal>

      {/* Story detail */}
      {open && (
        <>
          <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, padding: 22, overflowY: "auto" }}>
            <div className="row-between" style={{ marginBottom: 14 }}>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                <Chip tone={open.origin === "external" ? "violet" : "default"}>{open.origin}</Chip>
                {open.metadata?.industry && <Chip tone="accent">{open.metadata.industry}</Chip>}
                {open.metadata?.persona && <Chip>{open.metadata.persona}</Chip>}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <h2 className="t-h2" style={{ marginBottom: 8, fontSize: 19, lineHeight: 1.25 }}>{open.title}</h2>
            <div className="row gap-2" style={{ marginBottom: 16 }}><Confidence label={open.conf_label} level={open.conf_level} />{open.observed_at && <span className="t-mono-xs t-muted">{ago(open.observed_at)}</span>}</div>
            {open.why && <p className="t-body" style={{ lineHeight: 1.6, marginBottom: 18 }}>{open.why}</p>}

            {/* In-context play — a specific function, inline, not a floating box */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div className="row-between" style={{ alignItems: "center", marginBottom: (deep || deepBusy || reply.typing) ? 10 : 0 }}>
                <span className="t-label">Analyst · Deepen this story</span>
                <button className="btn btn-sm" disabled={deepBusy} onClick={() => deepen(open)}>{deepBusy ? "Reading…" : deep ? "Re-run" : "✦ Deepen"}</button>
              </div>
              {(deepBusy || reply.typing) ? (
                <div className="t-body" style={{ lineHeight: 1.6, background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
                  <LiveReply officer="Analyst" thinking={reply.thinking} display={reply.display} typing={reply.typing} busy={deepBusy} />
                </div>
              ) : deep ? (
                <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap", background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>{deep}</div>
              ) : null}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
