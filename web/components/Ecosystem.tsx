"use client";

// The Ecosystem (Phase G.2) — the agent workforce home. A living read of where
// the workforce's attention and spend sit across the recursive PLG loop, what's
// covered vs neglected, and where imbalance threatens the loop — so a human can
// SEE the balance and act (the rebalance itself is conversational, G.3).
//
// Status is always answerable (singlestack-ui §1.5): the harmony banner says
// what's happening; every dark stage / over-committed area carries a control to
// act. Reads the verified model (web/lib/lifecycle.ts) over RLS-fenced data.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip } from "@/components/ui";
import {
  STAGES, STAGE_META, computeBalance, classifyBalance,
  type Stage, type StageStatus, type AreaStatus, type Harmony,
} from "@/lib/lifecycle";

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const ago = (ms: number | null, now: number) => {
  if (ms == null) return "never";
  const d = Math.floor((now - ms) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "1d ago" : d < 14 ? `${d}d ago` : d < 60 ? `${Math.floor(d / 7)}w ago` : "stale";
};
// Where to go to act on a stage (navigational HITL — the human decides + acts).
const STAGE_SURFACE: Record<Stage, { href: string; label: string }> = {
  sense: { href: "/signals", label: "Signals" }, synthesize: { href: "/signals", label: "Signals" },
  decide: { href: "/strategy", label: "Strategy" }, build: { href: "/ship", label: "Ship" },
  validate: { href: "/ship", label: "Ship" }, position: { href: "/products", label: "Records" },
  sell: { href: "/sell", label: "Sell desk" }, steward: { href: "/agents", label: "Roster" },
};

const stageTone = (s: StageStatus) => s === "active" ? { fill: "var(--gn-fill)", text: "var(--gn-text)" } : s === "quiet" ? { fill: "color-mix(in srgb, var(--am) 14%, transparent)", text: "var(--am)" } : { fill: "var(--fill-2)", text: "var(--tm)" };
const harmonyTone = (h: Harmony) => h === "healthy" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Healthy" } : h === "watch" ? { fill: "color-mix(in srgb, var(--am) 16%, transparent)", text: "var(--am)", label: "Watch" } : { fill: "color-mix(in srgb, var(--rd) 14%, transparent)", text: "var(--rd)", label: "At risk" };
const areaChip: Record<AreaStatus, { tone: "default" | "accent" | "violet" | "green" | "amber"; label: string }> = {
  "over-committed": { tone: "amber", label: "over-committed" }, balanced: { tone: "green", label: "balanced" },
  "under-invested": { tone: "amber", label: "under-invested" }, neglected: { tone: "amber", label: "neglected" }, uncovered: { tone: "default", label: "no agent" },
};

export default function Ecosystem() {
  const supabase = createClient();
  const [data, setData] = useState<Parameters<typeof computeBalance>[0] | null>(null);
  const [counts, setCounts] = useState({ products: 0, gtm: 0, agents: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ data: ag }, { data: conns }, { data: u }, { data: r }, { count: pc }, { count: gc }] = await Promise.all([
      supabase.from("agents").select("id, name").eq("is_active", true).order("name"),
      supabase.from("connections").select("agent_id, area").eq("kind", "internal"),
      supabase.from("ai_usage").select("task, agent_id, cost_usd, created_at").gte("created_at", since).limit(5000),
      supabase.from("agent_runs").select("agent_id, cost_usd, created_at").not("cost_usd", "is", null).gte("created_at", since).limit(5000),
      supabase.from("product_records").select("id", { count: "exact", head: true }),
      supabase.from("gtm_records").select("id", { count: "exact", head: true }),
    ]);
    const agents = (ag ?? []) as { id: string; name: string }[];
    setData({
      agents,
      connections: (conns ?? []) as { agent_id: string | null; area: string | null }[],
      usage: (u ?? []) as { task: string; agent_id: string | null; cost_usd: number | null; created_at: string | null }[],
      runs: (r ?? []) as { agent_id: string | null; cost_usd: number | null; created_at: string | null }[],
    });
    setCounts({ products: pc ?? 0, gtm: gc ?? 0, agents: agents.length });
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const balance = useMemo(() => (data ? computeBalance(data) : null), [data]);
  const health = useMemo(() => (balance ? classifyBalance(balance) : null), [balance]);

  if (loading || !balance || !health) return <div className="t-sub t-muted">Loading the ecosystem…</div>;
  const now = balance.nowMs;
  const loopStages = STAGES.filter((s) => STAGE_META[s].kind === "loop");
  const otherStages = STAGES.filter((s) => STAGE_META[s].kind !== "loop");
  const noRecords = counts.products === 0 && counts.gtm === 0;
  const noAgents = counts.agents === 0;

  // --- blank-slate onboarding path (the symbiotic setup arc) ----------------
  const Step = ({ n, done, title, body, href, cta }: { n: number; done: boolean; title: string; body: string; href: string; cta: string }) => (
    <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: done ? 0.6 : 1 }}>
      <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 720, background: done ? "var(--gn-fill)" : "var(--ac-fill)", color: done ? "var(--gn-text)" : "var(--ac-text)" }}>{done ? "✓" : n}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 660, fontSize: 13.5 }}>{title}</div>
        <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>{body}</div>
      </div>
      {!done && <a className="btn btn-sm" href={href} style={{ flexShrink: 0 }}>{cta}</a>}
    </div>
  );

  const ht = harmonyTone(health.harmony.status);

  return (
    <div className="stack-4" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      {/* Harmony banner — status is always answerable */}
      <div className="card card-pad" style={{ background: ht.fill, borderColor: ht.text }}>
        <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: ht.text, flexShrink: 0 }} />
            <span style={{ fontWeight: 720, color: ht.text }}>{ht.label}</span>
            <span style={{ fontSize: 13.5, color: "var(--tp)", minWidth: 0 }}>{health.harmony.headline}</span>
          </div>
          <span className="t-mono-xs t-muted" style={{ flexShrink: 0, fontSize: 11.5 }}>{usd(balance.totalSpend)} · 30d · {counts.agents} agent{counts.agents === 1 ? "" : "s"}</span>
        </div>
      </div>

      {(noRecords || noAgents) && (
        <Section label="Stand up your ecosystem">
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>The workforce co-maintains your product &amp; GTM truth. Set the foundation, then put agents on the lifecycle — coverage and harmony fill in as they run.</div>
          <div className="stack-2">
            <Step n={1} done={!noRecords} title="Set your Product &amp; GTM records" body="The company/product truth every agent reasons from. The ecosystem can't balance work it has no truth for." href="/products" cta="Set up records" />
            <Step n={2} done={!noAgents} title="Put agents on the lifecycle" body="Create executive agents with cornerstones + child skills tailored to your business, aligned to the areas they own." href="/agents?tab=agents" cta="Add agents" />
            <Step n={3} done={!balance.totalSpend} title="Let them run" body="As agents sense, decide, build, and validate, this map comes alive — and flags any stage going dark or area being over-committed." href="/agents?tab=workflows" cta="Set up workflows" />
          </div>
        </Section>
      )}

      {/* Loop-risk alerts — the recursion safeguard */}
      {health.risks.length > 0 && (
        <Section label="Loop risks">
          <div className="stack-2">
            {health.risks.slice(0, 4).map((r, i) => {
              const tone = r.level === "high" ? "var(--rd)" : "var(--am)";
              return (
                <div key={i} className="card card-pad" style={{ borderLeft: `3px solid ${tone}` }}>
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row gap-2" style={{ alignItems: "center", marginBottom: 2 }}>
                        <span className="chip" style={{ fontSize: 9.5, background: "color-mix(in srgb, " + tone + " 14%, transparent)", color: tone, fontWeight: 700 }}>{r.level}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 640 }}>{STAGE_META[r.feeder].label} → {STAGE_META[r.downstream].label}</span>
                      </div>
                      <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>{r.message}</div>
                    </div>
                    <a className="btn btn-secondary btn-sm" href={STAGE_SURFACE[r.feeder].href} style={{ flexShrink: 0 }}>Feed {STAGE_META[r.feeder].label} →</a>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* The lifecycle loop */}
      <Section label="The lifecycle loop">
        <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 10 }}>Sense → Synthesize → Decide → Build → Validate, and back. Each agent run lands in a stage; a dark stage is where the loop can break.</div>
        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "stretch", marginBottom: "var(--sp-3)" }}>
          {loopStages.map((s, i) => {
            const h = health.stageHealth[s]; const t = stageTone(h.status); const surf = STAGE_SURFACE[s];
            return (
              <div key={s} className="row gap-2" style={{ alignItems: "stretch", flex: "1 1 150px" }}>
                <a href={surf.href} className="card card-pad pop" style={{ flex: 1, textDecoration: "none", color: "inherit", background: t.fill, borderColor: h.status === "empty" ? "var(--border)" : t.text }}>
                  <div className="row gap-2" style={{ alignItems: "center", marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: t.text, flexShrink: 0 }} />
                    <span style={{ fontWeight: 660, fontSize: 13 }}>{STAGE_META[s].label}</span>
                  </div>
                  <div className="t-mono-xs" style={{ fontSize: 12, fontWeight: 680 }}>{usd(h.spend)}</div>
                  <div className="t-sub t-muted" style={{ fontSize: 10.5, marginTop: 2 }}>{h.status === "empty" ? "no activity" : `${h.status} · ${ago(h.lastAtMs, now)}`}</div>
                </a>
                {i < loopStages.length - 1 && <span className="t-muted" style={{ alignSelf: "center", fontSize: 13 }}>→</span>}
              </div>
            );
          })}
        </div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          {otherStages.map((s) => {
            const h = health.stageHealth[s]; const t = stageTone(h.status);
            return (
              <a key={s} href={STAGE_SURFACE[s].href} className="card card-pad pop" style={{ flex: "1 1 160px", textDecoration: "none", color: "inherit" }}>
                <div className="row-between" style={{ alignItems: "center" }}>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: t.text }} />
                    <span style={{ fontWeight: 640, fontSize: 12.5 }}>{STAGE_META[s].label}</span>
                  </div>
                  <span className="t-mono-xs t-muted" style={{ fontSize: 11 }}>{usd(h.spend)}</span>
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 10.5, marginTop: 3 }}>{STAGE_META[s].blurb}</div>
              </a>
            );
          })}
        </div>
      </Section>

      {/* Area focus — the workforce-allocation + cost lens */}
      <Section label="Where the workforce is focused">
        <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 10 }}>Agent spend by solution area (last 30 days). Watch for one area taking an outsized share while others starve. Tune model/effort per area in <a href="/settings">Settings → AI &amp; cost</a>.</div>
        {health.areaHealth.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>No agent-attributed spend yet — align agents to areas to populate this.</div> : (
          <div className="stack-2">
            {health.areaHealth.map((a) => {
              const c = areaChip[a.status];
              return (
                <div key={a.area} className="card card-pad">
                  <div className="row-between" style={{ alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                      <span style={{ fontWeight: 640, fontSize: 13 }}>{a.area}</span>
                      <Chip tone={c.tone}>{c.label}</Chip>
                      <span className="t-sub t-muted" style={{ fontSize: 11 }}>{a.agents} agent{a.agents === 1 ? "" : "s"}</span>
                    </div>
                    <span className="t-mono-xs" style={{ flexShrink: 0, fontSize: 12, fontWeight: 660 }}>{usd(a.spend)} · {(a.share * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: "var(--fill-2)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, a.share * 100)}%`, height: "100%", background: a.status === "over-committed" ? "var(--am)" : a.status === "balanced" ? "var(--gn-text)" : "var(--tm)" }} />
                  </div>
                  {(a.status === "uncovered" || a.status === "neglected") && (
                    <div style={{ marginTop: 8 }}><a className="btn btn-secondary btn-sm" href="/agents?tab=agents">+ Put an agent on {a.area}</a></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
