"use client";

// Homepage portfolio roll-up (multi-product orgs, "All products" scope).
// One card per product line: Foundation completeness (same template-expected
// math as the org widget, scoped to the line), 7-day signal activity, pending
// proposals, and active themes. Clicking a card switches the app-wide product
// context to that line — "one active context, everywhere".
// Single-product orgs never see this (the org widgets ARE their line).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { templateFor } from "@/lib/templates";
import { Section } from "@/components/ui";

type Line = { id: string; name: string; pct: number; signals7d: number; pending: number; themes: number };

export default function PortfolioRollup() {
  const supabase = createClient();
  const { active, setActive, products } = useProductScope();
  const [lines, setLines] = useState<Line[] | null>(null);

  const show = (active === "all" || active === "company") && products.length > 1;

  useEffect(() => {
    if (!show) { setLines(null); return; }
    (async () => {
      const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
      // One batch; group client-side per line (dashboard-scale data).
      const [{ data: gtms }, { data: fields }, { data: sigs }, { data: props }, { data: themes }] = await Promise.all([
        supabase.from("gtm_records").select("id, product_id"),
        supabase.from("record_fields").select("product_id, gtm_record_id, value, field_kind"),
        supabase.from("signals").select("product_id").gte("observed_at", d7),
        supabase.from("proposals").select("product_id, gtm_record_id").eq("status", "pending"),
        supabase.from("signal_themes").select("product_id, state"),
      ]);
      const gtmLine = new Map((gtms ?? []).map((g) => [g.id, g.product_id]));
      const lineOf = (r: { product_id: string | null; gtm_record_id: string | null }) =>
        r.product_id ?? (r.gtm_record_id ? gtmLine.get(r.gtm_record_id) ?? null : null);

      const prodFields = templateFor("product").reduce((n, s) => n + s.fields.length, 0);
      const gtmFields = templateFor("gtm").reduce((n, s) => n + s.fields.length, 0);

      setLines(products.map((p) => {
        // Completeness: filled narrative fields on the line's product + GTM
        // records vs the template-expected counts (mirrors the org widget).
        const mine = (fields ?? []).filter((f) => lineOf(f) === p.id);
        const filled = mine.filter((f) => f.field_kind !== "metric" && f.value && f.value.trim()).length;
        const gtmCount = (gtms ?? []).filter((g) => g.product_id === p.id).length;
        const expected = prodFields + gtmCount * gtmFields;
        return {
          id: p.id, name: p.name,
          pct: expected ? Math.min(100, Math.round((filled / expected) * 100)) : 0,
          signals7d: (sigs ?? []).filter((s) => s.product_id === p.id).length,
          pending: (props ?? []).filter((r) => lineOf(r) === p.id).length,
          themes: (themes ?? []).filter((t) => t.product_id === p.id && t.state !== "fading").length,
        };
      }));
    })();
  }, [show, products, supabase]);

  if (!show || !lines) return null;

  return (
    <Section label="By product line">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
        {lines.map((l) => (
          <button key={l.id} className="card card-pad pop" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setActive(l.id)}
            title={`Switch to ${l.name} — every module scopes to this line`}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 640 }}>{l.name}</span>
              <Ring pct={l.pct} />
            </div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{l.pct}% filled</span>
              <span className="t-mono-xs" style={{ color: l.signals7d ? "var(--gn-text)" : "var(--tm)" }}>{l.signals7d} signal{l.signals7d === 1 ? "" : "s"} · 7d</span>
              <span className="t-mono-xs" style={{ color: l.pending ? "var(--vl-text)" : "var(--tm)" }}>{l.pending} to review</span>
              <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{l.themes} theme{l.themes === 1 ? "" : "s"}</span>
            </div>
            <span style={{ color: "var(--ac-text)", fontSize: 12.5, fontWeight: 600, marginTop: 8, display: "inline-block" }}>Enter line →</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 8, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  const color = pct === 100 ? "var(--gn)" : pct > 0 ? "var(--ac)" : "var(--border-strong)";
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--fill-2)" strokeWidth="2.5" />
      <circle cx="10" cy="10" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
    </svg>
  );
}
