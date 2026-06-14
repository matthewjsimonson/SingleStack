"use client";

// The cost dial (F2.2) — cost-↔-quality alignment, governed.
//   • Org preset (F2.2a): the baseline every task routes through, by stakes tier.
//   • Per-agent / per-task overrides (F2.2b): most-specific-wins (task-pin > agent
//     > org), each re-pricing that scope's OWN last-30-day spend.
// Writes ai_policies rows directly (RLS-fenced), like the autonomy dial writes
// review_policies. Each scope target is a partial unique index, so we
// delete-then-insert. The runtime always clamps to the tier floor, so the
// "at floor" markers shown here reflect what actually executes.
//
// Projection re-prices token counts at the candidate model (exact for the model
// swap). Effort also moves spend but isn't priced here — shown per tier as a
// directional note. Agent runs carry no task tag, so they're tiered as reasoning
// for the per-agent projection (labelled).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip } from "@/components/ui";
import {
  PRESETS, TIER_LABEL, MODEL_LABEL, FLOORS, resolvedLever, isAtFloor,
  projectPreset, TASK_LABEL, tierOf, type Preset, type Tier, type UsageRow,
} from "@/lib/aiPolicy";

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const TIERS: Tier[] = ["authoring", "reasoning", "conversational", "extraction"];
type OrgPreset = Exclude<Preset, "custom"> | "default";
type Sel = Exclude<Preset, "custom"> | "inherit";

type Row = UsageRow & { agent_id?: string | null };
type RunRow = { agent_id: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null };
type AgentRow = { id: string; name: string };
type PolRow = { scope: string; agent_id: string | null; task: string | null; preset: string };

export default function CostDial() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [pols, setPols] = useState<PolRow[]>([]);
  const [hover, setHover] = useState<OrgPreset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ data: u }, { data: r }, { data: a }, { data: p }] = await Promise.all([
      supabase.from("ai_usage").select("task, agent_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd").gte("created_at", since).limit(5000),
      supabase.from("agent_runs").select("agent_id, model, input_tokens, output_tokens, cost_usd").not("cost_usd", "is", null).gte("created_at", since).limit(5000),
      supabase.from("agents").select("id, name").eq("is_active", true).order("name"),
      supabase.from("ai_policies").select("scope, agent_id, task, preset"),
    ]);
    setRows((u ?? []) as Row[]); setRuns((r ?? []) as RunRow[]);
    setAgents((a ?? []) as AgentRow[]); setPols((p ?? []) as PolRow[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const orgPreset: OrgPreset = (pols.find((p) => p.scope === "org")?.preset as OrgPreset) ?? "default";
  const agentOverride = (id: string) => pols.find((p) => p.scope === "agent" && p.agent_id === id)?.preset as Exclude<Preset, "custom"> | undefined;
  const taskOverride = (t: string) => pols.find((p) => p.scope === "task" && p.task === t)?.preset as Exclude<Preset, "custom"> | undefined;

  // --- org-level projection (ai_usage tasks) --------------------------------
  const baseline = useMemo(() => rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0), [rows]);
  const orgProj = useMemo(() => {
    const m = {} as Record<Exclude<Preset, "custom">, number>;
    for (const p of PRESETS) m[p.key] = projectPreset(rows, p.key).projected;
    return m;
  }, [rows]);
  const orgProjOf = (p: OrgPreset) => (p === "default" ? baseline : orgProj[p]);

  // --- write helpers (delete-then-insert per partial-unique scope target) ----
  async function write(key: string, fn: (orgId: string) => Promise<void>) {
    setSaving(key); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      await fn(orgId);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the policy."); }
    finally { setSaving(null); }
  }
  const setOrg = (p: OrgPreset) => write("org", async (orgId) => {
    const del = await supabase.from("ai_policies").delete().eq("scope", "org");
    if (del.error) throw del.error;
    if (p !== "default") {
      const { error } = await supabase.from("ai_policies").insert({ org_id: orgId, scope: "org", preset: p, updated_at: new Date().toISOString(), updated_by: "web" });
      if (error) throw error;
    }
  });
  const setAgent = (id: string, sel: Sel) => write(`agent:${id}`, async (orgId) => {
    const del = await supabase.from("ai_policies").delete().eq("scope", "agent").eq("agent_id", id);
    if (del.error) throw del.error;
    if (sel !== "inherit") {
      const { error } = await supabase.from("ai_policies").insert({ org_id: orgId, scope: "agent", agent_id: id, preset: sel, updated_at: new Date().toISOString(), updated_by: "web" });
      if (error) throw error;
    }
  });
  const setTask = (t: string, sel: Sel) => write(`task:${t}`, async (orgId) => {
    const del = await supabase.from("ai_policies").delete().eq("scope", "task").eq("task", t);
    if (del.error) throw del.error;
    if (sel !== "inherit") {
      const { error } = await supabase.from("ai_policies").insert({ org_id: orgId, scope: "task", task: t, preset: sel, updated_at: new Date().toISOString(), updated_by: "web" });
      if (error) throw error;
    }
  });

  // --- scoped spend + projection --------------------------------------------
  const effPreset = (override?: Exclude<Preset, "custom">): OrgPreset => override ?? orgPreset;
  const agentSpend = (id: string) =>
    rows.filter((r) => r.agent_id === id).reduce((s, r) => s + (r.cost_usd ?? 0), 0) +
    runs.filter((r) => r.agent_id === id).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const agentProj = (id: string, eff: OrgPreset) => {
    if (eff === "default") return agentSpend(id);
    const ai = rows.filter((r) => r.agent_id === id);
    const rn = runs.filter((r) => r.agent_id === id).map((r) => ({ task: "", model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: r.cost_usd } as UsageRow));
    return projectPreset(ai, eff).projected + projectPreset(rn, eff, "reasoning").projected;
  };
  const taskSpend = (t: string) => rows.filter((r) => r.task === t).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const taskProj = (t: string, eff: OrgPreset) => (eff === "default" ? taskSpend(t) : projectPreset(rows.filter((r) => r.task === t), eff).projected);

  const tasksWithUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.task, (m.get(r.task) ?? 0) + (r.cost_usd ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [rows]);

  const shown = hover ?? orgPreset;
  const delta = orgProjOf(shown) - baseline;
  const pct = baseline > 0 ? (delta / baseline) * 100 : 0;
  const deltaColor = delta < -0.005 ? "var(--gn-text)" : delta > 0.005 ? "var(--am)" : "var(--tm)";

  const OPTIONS: { key: OrgPreset; label: string; blurb: string }[] = [
    { key: "default", label: "Default", blurb: "Today's behavior — Opus where each generator already runs. No policy set." },
    ...PRESETS,
  ];
  const SEL_OPTS: { key: Sel; label: string }[] = [
    { key: "inherit", label: "Org" }, { key: "quality", label: "Qual" }, { key: "balanced", label: "Bal" }, { key: "economy", label: "Econ" },
  ];

  // Compact inherit/preset selector + spend→projected for one scoped row.
  // A plain render function (not a nested component) so the scroll containers
  // don't remount — and reset scroll — on every parent re-render.
  const renderRow = ({ id, name, sub, sel, spend, proj, onPick, busy }: {
    id: string; name: string; sub?: string; sel: Sel; spend: number; proj: number;
    onPick: (s: Sel) => void; busy: boolean;
  }) => {
    const d = proj - spend;
    return (
      <div key={id} className="row-between" style={{ alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--fill-2)" }}>
        <span style={{ minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ fontSize: 13, fontWeight: 620, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{name}</span>
          {sub && <span className="t-sub t-muted" style={{ fontSize: 11 }}>{sub}</span>}
        </span>
        <span className="t-mono-xs t-muted" style={{ flexShrink: 0, fontSize: 11, minWidth: 96, textAlign: "right" }}>
          {usd(spend)}{Math.abs(d) >= 0.005 && <> → <strong style={{ color: d < 0 ? "var(--gn-text)" : "var(--am)" }}>{usd(proj)}</strong></>}
        </span>
        <span className="row" style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", flexShrink: 0 }}>
          {SEL_OPTS.map((o) => (
            <button key={o.key} disabled={busy} onClick={() => onPick(o.key)} title={o.key === "inherit" ? "Follow the org preset" : o.label}
              style={{ border: "none", background: sel === o.key ? "var(--ac)" : "var(--panel)", color: sel === o.key ? "#fff" : "var(--ts)", fontWeight: 600, fontSize: 11, padding: "5px 9px", cursor: "pointer" }}>{o.label}</button>
          ))}
        </span>
      </div>
    );
  };

  return (
    <Section label="AI & cost — the dial">
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Align <strong>which model</strong> and <strong>how much effort</strong> the platform spends to the value of the work. The org preset is the baseline every task routes through, by <strong>stakes tier</strong>; a tier&apos;s <strong>quality floor</strong> is enforced at runtime, so spend can go down without quality silently dropping. Per-agent and per-task overrides win over the org preset (task &gt; agent &gt; org).
      </div>
      {error && <div className="banner" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <>
          {/* Org preset cards */}
          <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
            {OPTIONS.map((o) => {
              const on = orgPreset === o.key;
              const proj = orgProjOf(o.key);
              const d = proj - baseline;
              return (
                <button key={o.key}
                  onMouseEnter={() => setHover(o.key)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(o.key)} onBlur={() => setHover(null)}
                  disabled={saving !== null} onClick={() => setOrg(o.key)}
                  className="card card-pad" style={{
                    flex: "1 1 180px", textAlign: "left", cursor: "pointer",
                    border: on ? "1.5px solid var(--ac)" : "1px solid var(--border)",
                    background: on ? "var(--ac-fill)" : "var(--panel)",
                  }}>
                  <div className="row-between" style={{ alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 680, color: on ? "var(--ac-text)" : "var(--tp)" }}>{o.label}</span>
                    {o.key === "balanced" && <Chip tone="accent">recommended</Chip>}
                    {on && o.key !== "balanced" && <Chip tone="accent">active</Chip>}
                  </div>
                  <div className="t-sub t-muted" style={{ fontSize: 11.5, lineHeight: 1.4, marginBottom: 8, minHeight: 32 }}>{o.blurb}</div>
                  <div className="row-between" style={{ alignItems: "baseline" }}>
                    <span className="t-mono-xs" style={{ fontWeight: 720, fontSize: 15 }}>{saving === "org" ? "…" : usd(proj)}</span>
                    <span className="t-mono-xs t-muted" style={{ fontSize: 11, color: Math.abs(d) < 0.005 ? "var(--tm)" : d < 0 ? "var(--gn-text)" : "var(--am)" }}>
                      {Math.abs(d) < 0.005 ? "—" : `${d < 0 ? "−" : "+"}${usd(Math.abs(d))}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Per-tier implication detail */}
          <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
            <div className="row-between" style={{ alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>
                {shown === "default" ? "Default" : PRESETS.find((p) => p.key === shown)?.label} · per tier
              </span>
              <span className="t-mono-xs" style={{ fontSize: 12 }}>
                30-day task spend: <strong>{usd(baseline)}</strong> → <strong>{usd(orgProjOf(shown))}</strong>{" "}
                <span style={{ color: deltaColor, fontWeight: 700 }}>
                  ({Math.abs(pct) < 0.5 ? "no change" : `${delta < 0 ? "−" : "+"}${Math.abs(pct).toFixed(0)}%`})
                </span>
              </span>
            </div>
            <div className="stack-2">
              {TIERS.map((t) => {
                const lever = shown === "default" ? null : resolvedLever(shown, t);
                return (
                  <div key={t} className="row-between" style={{ alignItems: "baseline", gap: 8 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 620 }}>{TIER_LABEL[t].label}</span>
                      <span className="t-sub t-muted" style={{ fontSize: 11.5, marginLeft: 8 }}>{TIER_LABEL[t].blurb}</span>
                    </span>
                    <span className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
                      {lever ? (
                        <>
                          <span className="t-mono-xs" style={{ fontSize: 11.5, fontWeight: 640 }}>{MODEL_LABEL[lever.model] ?? lever.model}</span>
                          <span className="chip" style={{ fontSize: 9.5, background: "var(--fill-2)", color: "var(--tm)" }}>{lever.effort}</span>
                          {isAtFloor(lever, t) && <Chip>at floor</Chip>}
                        </>
                      ) : <span className="t-mono-xs t-muted" style={{ fontSize: 11.5 }}>generator default</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.45 }}>
              Floor = the minimum a tier may run at; a cheaper preset never drops a tier below it. Projection re-prices your last 30 days of task spend at each preset&apos;s model (exact). <strong>Effort</strong> shifts spend too — shown per tier, not priced here, so treat the % as directional.
            </div>
          </div>

          {/* Per-agent overrides */}
          <div className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Per agent</div>
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Override the preset for one agent — its proposals, chats, runs, and tailoring. <strong>Org</strong> = follow the baseline. Spend shown is this agent&apos;s last 30 days (tasks + runs).</div>
            {agents.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>No agents yet.</div> : (
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {agents.map((a) => {
                  const ov = agentOverride(a.id);
                  const sel: Sel = ov ?? "inherit";
                  return renderRow({ id: a.id, name: a.name, sub: ov ? `override: ${ov}` : "follows org",
                    sel, spend: agentSpend(a.id), proj: agentProj(a.id, effPreset(ov)),
                    onPick: (s) => setAgent(a.id, s), busy: saving === `agent:${a.id}` });
                })}
              </div>
            )}
          </div>

          {/* Per-task pins */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Per task</div>
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Pin a specific task — protect a high-value one on Quality, or economize a throwaway. <strong>Org</strong> = follow the baseline. Tasks with spend in the last 30 days, by cost.</div>
            {tasksWithUsage.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>No task spend in the last 30 days yet.</div> : (
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {tasksWithUsage.map((t) => {
                  const ov = taskOverride(t);
                  const sel: Sel = ov ?? "inherit";
                  return renderRow({ id: t, name: TASK_LABEL[t] ?? t, sub: TIER_LABEL[tierOf(t)].label.toLowerCase(),
                    sel, spend: taskSpend(t), proj: taskProj(t, effPreset(ov)),
                    onPick: (s) => setTask(t, s), busy: saving === `task:${t}` });
                })}
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
