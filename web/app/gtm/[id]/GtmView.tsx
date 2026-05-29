"use client";

// GTM record detail: header with a breadcrumb back to its parent product, the
// shared workspace (fields/agents/proposals), and Signals — the evidence that
// backs this GTM record (unique to GTM records; products don't have them).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import RecordWorkspace from "@/components/RecordWorkspace";

type Gtm = { id: string; name: string; product_id: string };
type Product = { id: string; name: string };
type Signal = {
  id: string; title: string; why: string | null;
  conf_label: string | null; conf_level: number | null; observed_at: string | null;
};

export default function GtmView({ gtmId }: { gtmId: string }) {
  const supabase = createClient();
  const [gtm, setGtm] = useState<Gtm | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const { data: g } = await supabase
      .from("gtm_records").select("id, name, product_id").eq("id", gtmId).maybeSingle();
    if (!g) { setNotFound(true); setLoading(false); return; }
    const [{ data: p }, { data: sig }] = await Promise.all([
      supabase.from("product_records").select("id, name").eq("id", g.product_id).maybeSingle(),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at").eq("gtm_record_id", gtmId).order("observed_at", { ascending: false }),
    ]);
    setGtm(g);
    setProduct(p);
    setSignals(sig ?? []);
    setLoading(false);
  }, [supabase, gtmId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="muted" style={{ fontSize: 13.5 }}>Loading…</div>;
  if (notFound || !gtm) return <div className="card" style={{ padding: 24 }}>GTM record not found.</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 13 }}>
        <a href="/" className="muted" style={{ fontWeight: 500 }}>Records</a>
        <span className="muted">/</span>
        {product && <a href={`/records/${product.id}`} style={{ color: "var(--at)", fontWeight: 600 }}>{product.name}</a>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span className="chip chip-violet">GTM record</span>
      </div>
      <h1 className="page-title" style={{ marginBottom: 28 }}>{gtm.name}</h1>

      <RecordWorkspace target={{ kind: "gtm", id: gtmId }} />

      {/* Signals — evidence backing this GTM record */}
      <div className="section-label" style={{ marginTop: 8, marginBottom: 12 }}>Signals</div>
      {signals.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          No signals yet. Signals are the evidence (observations, data points) that back this record.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {signals.map((s) => (
            <div key={s.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 5 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{s.title}</span>
                {s.conf_label && (
                  <span className="chip" style={{ flexShrink: 0 }}>
                    {s.conf_label}{s.conf_level != null ? ` · ${Math.round(s.conf_level * 100)}%` : ""}
                  </span>
                )}
              </div>
              {s.why && <p className="secondary" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{s.why}</p>}
              {s.observed_at && (
                <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>{new Date(s.observed_at).toLocaleDateString()}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
