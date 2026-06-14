"use client";

// The cost dial (F2.2) — org-level cost-↔-quality alignment. Pick a preset and
// see the projected spend + what it does to each tier (with the quality floor
// surfaced, never hidden). Writes one ai_policies row (scope='org'); absent row
// = today's behavior. Per-agent / per-task overrides layer on top (F2.2b).
//
// The projection re-prices the last 30 days of TASK spend (ai_usage, which is
// tier-tagged) at each preset's model — exact for the model swap. Effort changes
// (which also move spend) are shown per tier but not priced: directional, and we
// say so. Agent runs are governed per-agent, not by this org task preset.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip } from "@/components/ui";
import {
  PRESETS, TIER_LABEL, MODEL_LABEL, FLOORS, resolvedLever, isAtFloor,
  projectPreset, type Preset, type Tier, type UsageRow,
} from "@/lib/aiPolicy";

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const TIERS: Tier[] = ["authoring", "reasoning", "conversational", "extraction"];
type OrgPreset = Exclude<Preset, "custom"> | "default";

export default function CostDial() {
  const supabase = createClient();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [current, setCurrent] = useState<OrgPreset>("default");
  const [hover, setHover] = useState<OrgPreset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<OrgPreset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ data: u }, { data: pol }] = await Promise.all([
      supabase.from("ai_usage")
        .select("task, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd")
        .gte("created_at", since).limit(5000),
      supabase.from("ai_policies").select("preset").eq("scope", "org").maybeSingle(),
    ]);
    setRows((u ?? []) as UsageRow[]);
    setCurrent((pol?.preset as OrgPreset) ?? "default");
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  // Current actual 30d task spend, and the projection per preset.
  const baseline = useMemo(() => rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0), [rows]);
  const projections = useMemo(() => {
    const m = {} as Record<Exclude<Preset, "custom">, { current: number; projected: number }>;
    for (const p of PRESETS) m[p.key] = projectPreset(rows, p.key);
    return m;
  }, [rows]);
  const projOf = (p: OrgPreset) => (p === "default" ? baseline : projections[p].projected);

  async function choose(p: OrgPreset) {
    setSaving(p); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      // The org-scope row is governed by a PARTIAL unique index (org_id WHERE
      // scope='org'), which on_conflict can't reliably target — so replace it:
      // clear the existing org row, then insert the new preset (RLS scopes both).
      const del = await supabase.from("ai_policies").delete().eq("scope", "org");
      if (del.error) throw del.error;
      if (p !== "default") {
        const { error } = await supabase.from("ai_policies").insert(
          { org_id: orgId, scope: "org", preset: p, updated_at: new Date().toISOString(), updated_by: "web" },
        );
        if (error) throw error;
      }
      setCurrent(p);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not set the preset."); }
    finally { setSaving(null); }
  }

  const shown = hover ?? current; // the preset whose breakdown + projection we detail
  const delta = projOf(shown) - baseline;
  const pct = baseline > 0 ? (delta / baseline) * 100 : 0;
  const deltaColor = delta < -0.005 ? "var(--gn-text)" : delta > 0.005 ? "var(--am)" : "var(--tm)";

  const OPTIONS: { key: OrgPreset; label: string; blurb: string }[] = [
    { key: "default", label: "Default", blurb: "Today's behavior — Opus where each generator already runs. No policy set." },
    ...PRESETS,
  ];

  return (
    <Section label="AI & cost — the dial">
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Align <strong>which model</strong> and <strong>how much effort</strong> the platform spends to the value of the work — org-wide. Each preset routes every task through its <strong>stakes tier</strong>; a tier&apos;s <strong>quality floor</strong> is enforced at runtime, so spend can go down without quality silently dropping. Per-agent and per-task overrides layer on top.
      </div>
      {error && <div className="banner" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <>
          <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
            {OPTIONS.map((o) => {
              const on = current === o.key;
              const proj = projOf(o.key);
              const d = proj - baseline;
              return (
                <button key={o.key}
                  onMouseEnter={() => setHover(o.key)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(o.key)} onBlur={() => setHover(null)}
                  disabled={saving !== null} onClick={() => choose(o.key)}
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
                    <span className="t-mono-xs" style={{ fontWeight: 720, fontSize: 15 }}>{saving === o.key ? "…" : usd(proj)}</span>
                    <span className="t-mono-xs t-muted" style={{ fontSize: 11, color: Math.abs(d) < 0.005 ? "var(--tm)" : d < 0 ? "var(--gn-text)" : "var(--am)" }}>
                      {Math.abs(d) < 0.005 ? "—" : `${d < 0 ? "−" : "+"}${usd(Math.abs(d))}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Implication detail for the active/hovered preset */}
          <div className="card card-pad" style={{ marginBottom: 12 }}>
            <div className="row-between" style={{ alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>
                {shown === "default" ? "Default" : PRESETS.find((p) => p.key === shown)?.label} · per tier
              </span>
              <span className="t-mono-xs" style={{ fontSize: 12 }}>
                30-day task spend: <strong>{usd(baseline)}</strong> → <strong>{usd(projOf(shown))}</strong>{" "}
                <span style={{ color: deltaColor, fontWeight: 700 }}>
                  ({Math.abs(pct) < 0.5 ? "no change" : `${delta < 0 ? "−" : "+"}${Math.abs(pct).toFixed(0)}%`})
                </span>
              </span>
            </div>
            <div className="stack-2">
              {TIERS.map((t) => {
                const lever = shown === "default" ? null : resolvedLever(shown, t);
                const floor = FLOORS[t];
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
                      ) : (
                        <span className="t-mono-xs t-muted" style={{ fontSize: 11.5 }}>generator default</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.45 }}>
              Floor = the minimum a tier may run at; selecting a cheaper preset never drops a tier below it. Projection re-prices your last 30 days of task spend at each preset&apos;s model (exact). <strong>Effort</strong> shifts spend too — shown per tier, not priced here, so treat the % as directional. Agent runs are governed per-agent, not by this dial.
            </div>
          </div>
        </>
      )}
    </Section>
  );
}
