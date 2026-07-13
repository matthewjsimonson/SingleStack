"use client";

// Market intel — a DISCOVER feed of market stories the signals profile pulled
// in. Setup lives on Signals (the market focus, as nodes); this page CONSUMES
// what those nodes catch, grouped under the node that pulled each story, and
// lets you DEEPEN one with the analyst inline. Backed by signals where
// domain='market'.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chip, Banner, Confidence } from "@/components/ui";
import { fetchAgentKey, errText } from "@/lib/strategy";
import { signalDomain, SIGNAL_DOMAIN, groupByNode, sourceNameOf, sourceUrlOf, type NodeMeta } from "@/lib/signals";
import { LiveReply, useAliveReply, streamAgentChat } from "@/components/alive";
import { Markdown } from "@/components/Markdown";
import SignalProfile from "@/components/SignalProfile";

type Meta = { domain?: string; node_key?: string; source?: string; channel?: string; url?: string } | null;
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; origin: string; metadata: Meta };

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 86400 ? `${Math.max(1, Math.round(s / 3600))}h ago` : `${Math.round(s / 86400)}d ago`;
}

export default function MarketView() {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [nodes, setNodes] = useState<NodeMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Signal | null>(null);
  const [agentKey, setAgentKey] = useState<string | null>(null);

  const [fOrigin, setFOrigin] = useState<"all" | "internal" | "external">("all");
  const [deep, setDeep] = useState<string | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const reply = useAliveReply();

  const load = useCallback(async () => {
    const { data } = await supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, origin, metadata").order("observed_at", { ascending: false, nullsFirst: false });
    setSignals(((data ?? []) as Signal[]).filter((s) => signalDomain(s) === SIGNAL_DOMAIN.market));
    setAgentKey(await fetchAgentKey(supabase));
    // The market focus of the landscape profile — so stories group under the
    // node that pulled them, in the profile's own order.
    const { data: prof } = await supabase.from("signal_profiles").select("id").eq("scope", "landscape").is("competitor_id", null).maybeSingle();
    if (prof) {
      const { data: ns } = await supabase.from("signal_profile_fields").select("field_key, label, weight, parent_key").eq("profile_id", prof.id).eq("vector", "market");
      setNodes((ns ?? []) as NodeMeta[]);
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const feed = signals.filter((s) => fOrigin === "all" || s.origin === fOrigin);
  const groups = groupByNode(feed, nodes);

  // In-context PLAY: the analyst deepens the story into a briefing (real agent-chat).
  async function deepen(s: Signal) {
    setDeepBusy(true); setDeep(null); setError(null); reply.begin();
    try {
      if (!agentKey) throw new Error("No analyst available (seed agents first).");
      const prompt = `You are a market analyst. Expand this market signal into a tight briefing (4–6 sentences): what's happening, why it matters for our product and positioning, and the specific implication. Return only the briefing prose.\n\nSignal: ${s.title}${s.why ? `\nContext: ${s.why}` : ""}\nSource: ${s.origin}`;
      const { data: sess } = await supabase.auth.getSession();
      await streamAgentChat({ agentKey, messages: [{ role: "user", content: prompt }], token: sess.session?.access_token, onChunk: reply.onChunk, onThinking: reply.onThinking, fnName: "agent-run", fallbackFnName: "agent-chat" });
      reply.finish();
    } catch (e) { reply.reset(); setError(errText(e, "Deepen failed.")); } finally { setDeepBusy(false); }
  }
  // Commit the briefing once it's fully typed out.
  useEffect(() => {
    if (!deepBusy && !reply.typing && reply.display) { setDeep(reply.display); reply.reset(); }
  }, [deepBusy, reply.typing, reply.display, reply.reset]);

  const card = (s: Signal) => {
    const src = sourceNameOf(s); const url = sourceUrlOf(s);
    return (
      <button key={s.id} onClick={() => { setOpen(s); setDeep(null); reply.reset(); }} className="card card-link" style={{ textAlign: "left", padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", flex: 1 }}>
          <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <Chip tone={s.origin === "external" ? "violet" : "default"}>{s.origin}</Chip>
            {src && <span className="t-mono-xs t-muted">{src}</span>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 660, lineHeight: 1.3, marginBottom: 6 }}>{s.title}</div>
          {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.why}</div>}
        </div>
        <div className="row-between" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", alignItems: "center" }}>
          <Confidence label={s.conf_label} level={s.conf_level} />
          <div className="row gap-2" style={{ alignItems: "center" }}>
            {url && <span className="t-mono-xs" style={{ color: "var(--ac-text)" }}>↗ source</span>}
            {s.observed_at && <span className="t-mono-xs t-muted">{ago(s.observed_at)}</span>}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div>
      <div className="row-between" style={{ alignItems: "flex-end", marginBottom: "var(--sp-4)" }}>
        <div><h1 className="t-page">Market intel</h1><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Market stories your signals profile pulled in, grouped by the node that caught them.</div></div>
      </div>
      <Banner>{error}</Banner>

      {/* The market focus of your signals profile — the slice of the brain that
          aims this tab. Read-only here; set it up on Signals. */}
      <div style={{ marginBottom: "var(--sp-4)" }}>
        <SignalProfile scope="landscape" vectorFilter="market" />
      </div>

      <div className="row gap-2" style={{ alignItems: "center", marginBottom: "var(--sp-4)" }}>
        <span className="t-label" style={{ width: 56 }}>Source</span>
        <button className={`btn btn-sm ${fOrigin === "all" ? "" : "btn-secondary"}`} onClick={() => setFOrigin("all")}>All</button>
        {(["internal", "external"] as const).map((o) => <button key={o} className={`btn btn-sm ${fOrigin === o ? "" : "btn-secondary"}`} onClick={() => setFOrigin(o)}>{o}</button>)}
      </div>

      {loading ? <div className="t-sub t-muted">Loading…</div> : feed.length === 0 ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No market stories yet</div><div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Set up the market focus of your signals profile on <a href="/signals" style={{ color: "var(--ac-text)" }}>Signals</a> — its nodes aim the search, and what they catch shows up here.</div></div>
      ) : (
        <div>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="row gap-2" style={{ alignItems: "baseline", marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 680 }}>{g.label}</span>
                <span className="t-sub t-muted" style={{ fontSize: 12 }}>{g.signals.length}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "var(--sp-4)", marginBottom: "var(--sp-4)" }}>
                {g.signals.map(card)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Story detail */}
      {open && (
        <>
          <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, padding: 22, overflowY: "auto" }}>
            <div className="row-between" style={{ marginBottom: 14 }}>
              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <Chip tone={open.origin === "external" ? "violet" : "default"}>{open.origin}</Chip>
                {sourceNameOf(open) && <span className="t-mono-xs t-muted">{sourceNameOf(open)}</span>}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <h2 className="t-h2" style={{ marginBottom: 8, fontSize: 19, lineHeight: 1.25 }}>{open.title}</h2>
            <div className="row gap-2" style={{ marginBottom: 16, alignItems: "center" }}><Confidence label={open.conf_label} level={open.conf_level} />{open.observed_at && <span className="t-mono-xs t-muted">{ago(open.observed_at)}</span>}{sourceUrlOf(open) && <a href={sourceUrlOf(open)!} target="_blank" rel="noreferrer" className="t-mono-xs" style={{ color: "var(--ac-text)" }}>↗ open source</a>}</div>
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
                <Markdown className="t-body" style={{ lineHeight: 1.6, background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }} text={deep} />
              ) : null}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
