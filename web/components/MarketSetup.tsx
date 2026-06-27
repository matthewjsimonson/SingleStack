"use client";

// MarketSetup — the guided, HITL way to stand up the RIGHT market watches, the
// market twin of the per-competitor Finalize. It calls setup-market, which keys
// the watches off the INTERSECTION of our GTM industries/personas and the
// modules/features that serve them (so we watch what we actually serve, not
// generic industry news), then stands each up as a market-lens source + a
// tracking topic and ignites the first pull.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip } from "@/components/ui";
import { CATALOG_BY_KIND } from "@/lib/sources";

type Watch = { lens: "industry" | "persona" | "analyst" | "tech"; value: string; serves: string; why: string; guidance: string; kinds: string[]; keep: boolean };
type Pull = { id: string; label: string; state: "pulling" | "ok" | "error"; startedAt: number; msg?: string };

async function fnError(error: unknown, data: unknown): Promise<string | null> {
  if (data && typeof data === "object" && (data as { error?: string }).error) return (data as { error: string }).error;
  if (!error) return null;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.clone().json().catch(() => null)) as { error?: string } | null;
    if (body?.error) return body.error;
    if (ctx.status === 504 || ctx.status === 546) return "The proposal ran past the server time limit — try again.";
  }
  return error instanceof Error ? error.message : "failed";
}
const lensTone = (l: string): "accent" | "violet" | "amber" | "default" => l === "industry" ? "accent" : l === "persona" ? "violet" : l === "tech" ? "amber" : "default";

export default function MarketSetup({ onDone }: { onDone: () => void }) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [, setTick] = useState(0);

  async function propose() {
    setBusy("propose"); setError(null); setNote(null); setPulls([]);
    try {
      const { data, error } = await supabase.functions.invoke("setup-market", { body: {} });
      const err = await fnError(error, data); if (err) throw new Error(err);
      const ws = ((data as { watches?: Omit<Watch, "keep">[] }).watches ?? []).map((w) => ({ ...w, keep: true }));
      if (!ws.length) throw new Error("No aligned watches came back — fill out your product & GTM records, then retry.");
      setWatches(ws);
      setNote((data as { note?: string }).note || `Proposed ${ws.length} watches aligned to what you actually serve. Review, then stand them up.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not propose watches."); }
    finally { setBusy(null); }
  }

  const edit = (i: number, patch: Partial<Watch>) => setWatches((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  async function standUp() {
    const keep = watches.filter((w) => w.keep && w.value.trim());
    if (!keep.length) { setError("Keep at least one watch."); return; }
    setBusy("standup"); setError(null); setNote(null); setPulls([]);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      // One source per (watch × kind) + one tracking topic per watch. Market-lens +
      // config carry the segment so harvested signals tag industry/persona.
      const sourceRows: Record<string, unknown>[] = [];
      const topicRows: Record<string, unknown>[] = [];
      for (const w of keep) {
        const cfg = w.lens === "industry" ? { industry: w.value.trim() } : w.lens === "persona" ? { persona: w.value.trim() } : {};
        const kinds = (w.kinds.length ? w.kinds : ["web_search"]).filter((k) => CATALOG_BY_KIND[k]);
        for (const kind of kinds) {
          const def = CATALOG_BY_KIND[kind];
          sourceRows.push({
            org_id: orgId, label: w.value.trim(), icon: def.icon, origin: "external", kind,
            status: "connected", auth_mode: def.authMode, access_scope: def.accessScope,
            focus: "both", max_per_pull: def.defaultMaxPerPull, cadence: "daily",
            config: cfg, guidance: w.guidance.trim() || null, market_lens: w.lens,
          });
        }
        topicRows.push({ org_id: orgId, category: "market", prompt: `${w.value.trim()} — ${w.why.trim()}`, focus: null, origin: "human", status: "active" });
      }
      const { data: created, error: sErr } = await supabase.from("sources").insert(sourceRows).select("id, label");
      if (sErr) throw sErr;
      if (topicRows.length) await supabase.from("tracking_topics").insert(topicRows);
      // Ignite the first pull on each, concurrently, with live status.
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const startedAt = Date.now();
      const items = (created ?? []) as { id: string; label: string }[];
      setPulls(items.map((c) => ({ id: c.id, label: c.label, state: "pulling", startedAt })));
      const tick = setInterval(() => setTick((n) => n + 1), 1000);
      let ok = 0, landed = 0;
      await Promise.all(items.map(async (src) => {
        try {
          const { data, error } = await supabase.functions.invoke("connector-runner", { body: { source_id: src.id }, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
          const err = await fnError(error, data); if (err) throw new Error(err);
          const d = data as { created?: number; fetched?: number };
          ok++; landed += d.created ?? 0;
          setPulls((ps) => ps.map((p) => (p.id === src.id ? { ...p, state: "ok", msg: `fetched ${d.fetched ?? 0} → ${d.created ?? 0} signal${d.created === 1 ? "" : "s"}` } : p)));
        } catch (e) {
          setPulls((ps) => ps.map((p) => (p.id === src.id ? { ...p, state: "error", msg: e instanceof Error ? e.message : "pull failed" } : p)));
        }
      }));
      clearInterval(tick);
      onDone();
      setNote(`Stood up ${items.length} market source${items.length === 1 ? "" : "s"} · ${ok} pulled · ${landed} signal${landed === 1 ? "" : "s"} landed. They re-pull daily — synthesize on the strategy boards to fold them in.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stand up the watches."); }
    finally { setBusy(null); }
  }

  return (
    <div className="card card-pad" style={{ borderTop: "3px solid var(--ac)", marginBottom: "var(--sp-4)" }}>
      <div className="row-between" style={{ marginBottom: 8, alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 680 }}>Set up market signals</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Aligned to what you actually serve — watches keyed to your industries/personas × the modules &amp; features that serve them, not generic news.</div>
        </div>
        {watches.length === 0 && <button className="btn btn-sm" onClick={propose} disabled={busy === "propose"}>{busy === "propose" ? "Reading your records…" : "✦ Propose aligned watches"}</button>}
      </div>
      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      {watches.length > 0 && (
        <div className="stack-3">
          {watches.map((w, i) => (
            <div key={i} className="card card-pad" style={{ background: "var(--panel-2)", opacity: w.keep ? 1 : 0.55 }}>
              <div className="row-between" style={{ gap: 8, alignItems: "flex-start" }}>
                <label className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                  <input type="checkbox" checked={w.keep} onChange={() => edit(i, { keep: !w.keep })} />
                  <Chip tone={lensTone(w.lens)}>{w.lens}</Chip>
                  <input className="input" value={w.value} onChange={(e) => edit(i, { value: e.target.value })} style={{ fontWeight: 660, fontSize: 13.5, maxWidth: 240 }} />
                </label>
                <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{w.kinds.join(" · ") || "web_search"}</span>
              </div>
              <div className="t-sub" style={{ fontSize: 12, marginTop: 6 }}><b>Serves:</b> {w.serves}</div>
              <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{w.why}</div>
              <textarea className="textarea" rows={2} value={w.guidance} onChange={(e) => edit(i, { guidance: e.target.value })} style={{ fontSize: 12, marginTop: 6 }} />
            </div>
          ))}
          {pulls.length > 0 && (
            <div className="card card-pad stack-2" style={{ background: "var(--panel-2)", padding: "8px 10px" }}>
              {pulls.map((p) => {
                const secs = Math.max(0, Math.round((Date.now() - p.startedAt) / 1000));
                return (
                  <div key={p.id} className="row-between" style={{ gap: 10, alignItems: "baseline" }}>
                    <span className="t-mono-xs" style={{ color: p.state === "error" ? "var(--rd-text)" : p.state === "ok" ? "var(--gn-text)" : "var(--tm)" }}>{p.state === "pulling" ? "… " : p.state === "ok" ? "✓ " : "✕ "}{p.label}{p.msg ? ` — ${p.msg}` : ""}</span>
                    {p.state === "pulling" && <span className="t-mono-xs t-muted">{secs}s</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="row gap-2">
            <button className="btn btn-sm" onClick={standUp} disabled={busy === "standup"}>{busy === "standup" ? "Standing up & pulling…" : `✦ Stand up ${watches.filter((w) => w.keep).length} watch${watches.filter((w) => w.keep).length === 1 ? "" : "es"} & pull`}</button>
            <button className="btn btn-secondary btn-sm" onClick={propose} disabled={busy === "propose"}>{busy === "propose" ? "…" : "↺ Re-propose"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
