"use client";

// A module's TECHNICAL foundation — how this module works, what it's built on,
// and where it's aging. Three panes that keep the technical truth honest:
//   1. Fields   — the standing technical detail (record_fields under module_id),
//                 edited exactly like a product/GTM record via SectionedFields.
//   2. Signals  — product-lens intel tagged to THIS module (a new model/API/
//                 platform shift that affects it). Drift between what the fields
//                 SAY and what the signals show is the tech-debt early warning.
//   3. Build    — the module's feature count: the stated detail sits next to the
//                 actual build so the two can be compared at a glance.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip, Banner, Confidence } from "@/components/ui";
import SectionedFields from "@/components/SectionedFields";

type Sig = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; category: string | null; module_id: string | null };

export default function ModuleTechnical({ moduleId, productId, featureCount }: {
  moduleId: string; productId: string; featureCount: number;
}) {
  const supabase = createClient();
  const [tagged, setTagged] = useState<Sig[]>([]);
  const [candidates, setCandidates] = useState<Sig[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Signals on this module, plus this product's untagged product-lens signals
    // (the pool you can attach from). Org-wide signals stay out — module intel is
    // product-specific by nature.
    const [{ data: on }, { data: pool }] = await Promise.all([
      supabase.from("signals").select("id, title, why, conf_label, conf_level, category, module_id").eq("module_id", moduleId).order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, category, module_id").eq("product_id", productId).is("module_id", null).in("category", ["product", "both"]).order("observed_at", { ascending: false, nullsFirst: false }).limit(40),
    ]);
    setTagged(on ?? []); setCandidates(pool ?? []);
  }, [supabase, moduleId, productId]);
  useEffect(() => { load(); }, [load]);

  async function attach(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").update({ module_id: moduleId }).eq("id", id);
    if (error) setError(error.message); else { setPicking(false); await load(); }
  }
  async function detach(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").update({ module_id: null }).eq("id", id);
    if (error) setError(error.message); else await load();
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <Banner>{error}</Banner>

      {/* 1. Technical fields — same editor as product/GTM, scoped to the module */}
      <SectionedFields target={{ kind: "module", id: moduleId }} />

      {/* 2. Technical signals — what's pushing on this module's implementation */}
      <Section
        label={`Technical signals${tagged.length ? ` · ${tagged.length}` : ""}`}
        action={!picking ? <button className="btn btn-secondary btn-sm" onClick={() => setPicking(true)} disabled={candidates.length === 0}>+ Attach signal</button> : <button className="btn btn-secondary btn-sm" onClick={() => setPicking(false)}>Done</button>}
      >
        <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Product-lens signals that bear on how this module is built — a new model, API, or platform shift. Drift from the fields above is your tech-debt early warning.
        </div>

        {picking && (
          <div className="card card-pad" style={{ marginBottom: "var(--sp-3)", background: "var(--panel-2)" }}>
            {candidates.length === 0 ? (
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No untagged product signals to attach. Log product-lens signals on this product, then attach them here.</div>
            ) : (
              <div className="stack-2">
                {candidates.map((s) => (
                  <button key={s.id} className="card card-link card-pad" style={{ textAlign: "left", width: "100%" }} onClick={() => attach(s.id)}>
                    <div className="row-between" style={{ gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                      <span className="t-mono-xs" style={{ color: "var(--ac-text)", flexShrink: 0 }}>attach →</span>
                    </div>
                    {s.why && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{s.why}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tagged.length === 0 && !picking ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No technical signals on this module yet. Attach product signals that affect how it&rsquo;s built.</div>
        ) : (
          <div className="stack-3">
            {tagged.map((s) => (
              <div key={s.id} className="card card-pad" style={{ borderLeft: "3px solid var(--vl)" }}>
                <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 620 }}>{s.title}</span>
                  <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
                    <Confidence label={s.conf_label} level={s.conf_level} />
                    <button className="t-muted" onClick={() => detach(s.id)} title="Detach from module" aria-label="Detach signal" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                  </div>
                </div>
                {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{s.why}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3. Build readout — the stated detail next to the actual build */}
      <div className="card card-pad" style={{ marginTop: "var(--sp-3)", display: "flex", alignItems: "center", gap: 10 }}>
        <Chip tone="accent">Build</Chip>
        <span className="t-sub" style={{ fontSize: 12.5 }}>
          {featureCount} feature{featureCount === 1 ? "" : "s"} shipped in this module. Keep the technical detail above honest against what&rsquo;s actually built.
        </span>
      </div>
    </div>
  );
}
