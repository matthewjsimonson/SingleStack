"use client";

// The living search-readiness gauge — computed from the REAL state of the
// workspace (records, modules, competitive board, signal flow), so it updates
// automatically as the company and the market evolve. Every dimension shows
// what it found and the exact fix: the grade is auditable, never vibes.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeReadiness, STAGES, type Readiness, type Stage } from "@/lib/readiness";
import { getOrgId } from "@/lib/org";

export default function ProfileReadiness({ compact = false, nonce = 0 }: { compact?: boolean; nonce?: number }) {
  const supabase = createClient();
  const [r, setR] = useState<Readiness | null>(null);
  const [stage, setStage] = useState<Stage>("early");
  const [gtmId, setGtmId] = useState<string | null>(null);
  // deno: inputs cached so a stage switch regrades instantly without refetching
  const [inputs, setInputs] = useState<Parameters<typeof computeReadiness>[0] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from("product_records").select("id").order("created_at").limit(1).maybeSingle();
      const { data: g } = await supabase.from("gtm_records").select("id").order("created_at").limit(1).maybeSingle();
      const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
      const [pf, gf, mods, comps, caps, cells, sigs, srcs] = await Promise.all([
        p ? supabase.from("record_fields").select("field_key, value").eq("product_id", p.id) : Promise.resolve({ data: [] }),
        g ? supabase.from("record_fields").select("field_key, value").eq("gtm_record_id", g.id) : Promise.resolve({ data: [] }),
        p ? supabase.from("modules").select("id", { count: "exact", head: true }).eq("product_id", p.id) : Promise.resolve({ count: 0 }),
        supabase.from("competitors").select("id", { count: "exact", head: true }),
        supabase.from("capabilities").select("id", { count: "exact", head: true }),
        supabase.from("capability_scores").select("id", { count: "exact", head: true }).not("scored_by", "is", null),
        supabase.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", cutoff),
        supabase.from("sources").select("id", { count: "exact", head: true }).neq("cadence", "manual").eq("status", "connected"),
      ]);
      const toMap = (rows: { field_key: string; value: string | null }[] | null) =>
        Object.fromEntries((rows ?? []).map((f) => [f.field_key, f.value]));
      setGtmId(g?.id ?? null);
      // Maturity stage lives ON the GTM record (field maturity_stage) — part of
      // the profile, not a UI preference.
      const gfMap = toMap((gf as { data: { field_key: string; value: string | null }[] | null }).data);
      const saved = (gfMap.maturity_stage ?? "").trim() as Stage;
      const st: Stage = ["exploring", "early", "scaling", "established"].includes(saved) ? saved : "early";
      setStage(st);
      const inp = {
        productFields: toMap((pf as { data: { field_key: string; value: string | null }[] | null }).data),
        gtmFields: gfMap,
        moduleCount: (mods as { count: number | null }).count ?? 0,
        competitorCount: (comps as { count: number | null }).count ?? 0,
        capabilityCount: (caps as { count: number | null }).count ?? 0,
        evidencedCells: (cells as { count: number | null }).count ?? 0,
        signals14d: (sigs as { count: number | null }).count ?? 0,
        liveSources: (srcs as { count: number | null }).count ?? 0,
      };
      setInputs(inp);
      setR(computeReadiness(inp, st));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  async function pickStage(st: Stage) {
    setStage(st);
    if (inputs) setR(computeReadiness(inputs, st));
    // persist on the GTM record (best-effort; the gauge regrades regardless)
    try {
      const orgId = await getOrgId(); if (!orgId || !gtmId) return;
      const { data: ex } = await supabase.from("record_fields").select("id").eq("gtm_record_id", gtmId).eq("field_key", "maturity_stage").maybeSingle();
      // Updating an existing value goes through the human edit channel (the
      // write-gate blocks raw value updates); a first-time insert is additive.
      if (ex?.id) await supabase.rpc("human_set_field_value", { p_field: ex.id, p_value: st });
      else await supabase.from("record_fields").insert({ org_id: orgId, gtm_record_id: gtmId, field_key: "maturity_stage", label: "Company maturity", value: st, section: "Motion" });
    } catch { /* best-effort */ }
  }

  if (!r) return null;
  const color = r.score >= 80 ? "var(--gn-text, #15803d)" : r.score >= 55 ? "var(--am-text, #D97706)" : "var(--ac)";

  return (
    <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
      <div className="row-between" style={{ marginBottom: 6, alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span className="t-label" style={{ color: "var(--tm)" }}>Search readiness — living, graded for your stage</span>
        <span className="row gap-2" style={{ alignItems: "baseline" }}>
          <span className="row" style={{ gap: 2 }}>
            {STAGES.map((st) => (
              <button key={st.key} onClick={() => pickStage(st.key)} title={st.blurb}
                className="t-mono-xs" style={{ padding: "2px 7px", borderRadius: 5, border: "none", cursor: "pointer", background: stage === st.key ? "var(--ac)" : "var(--fill)", color: stage === st.key ? "#fff" : "var(--tm)", fontWeight: 600 }}>
                {st.label}
              </button>
            ))}
          </span>
          <span className="t-mono-xs" style={{ fontWeight: 700, color }}>{r.score}%</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--fill)", overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${r.score}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
      </div>
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        {r.dims.map((d) => {
          if (!d.expected) return (
            <span key={d.key} className="t-mono-xs" title={`${d.label}: not expected at the ${r.stage} stage — it joins the bar as you mature`}
              style={{ padding: "3px 8px", borderRadius: 6, background: "transparent", border: "1px dashed var(--border)", color: "var(--tm)", fontWeight: 600, cursor: "default", opacity: 0.65 }}>
              ◌ {d.label} · later
            </span>
          );
          const full = d.got >= d.max;
          return (
            <span key={d.key} className="t-mono-xs" title={full ? `${d.label}: complete` : d.fix}
              style={{ padding: "3px 8px", borderRadius: 6, background: full ? "var(--gn-bg, #CDEBD6)" : "var(--fill)", color: full ? "var(--gn-text, #15803d)" : "var(--tm)", fontWeight: 600, cursor: "default" }}>
              {full ? "✓" : `${d.got}/${d.max}`} {d.label}
            </span>
          );
        })}
      </div>
      {!compact && r.score < 100 && (
        <div className="t-mono-xs t-muted" style={{ marginTop: 6 }}>
          {r.dims.filter((d) => d.expected && d.got < d.max).slice(0, 2).map((d) => d.fix).join(" · ")}
        </div>
      )}
    </div>
  );
}
