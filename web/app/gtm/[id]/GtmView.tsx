"use client";

// GTM record detail: breadcrumb to parent product, workspace, and Signals.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import RecordWorkspace from "@/components/RecordWorkspace";
import { Section, Chip, Confidence, Empty } from "@/components/ui";

type Gtm = { id: string; name: string; product_id: string };
type Product = { id: string; name: string };
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null };

export default function GtmView({ gtmId }: { gtmId: string }) {
  const supabase = createClient();
  const [gtm, setGtm] = useState<Gtm | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const { data: g } = await supabase.from("gtm_records").select("id, name, product_id").eq("id", gtmId).maybeSingle();
    if (!g) { setNotFound(true); setLoading(false); return; }
    const [{ data: p }, { data: sig }] = await Promise.all([
      supabase.from("product_records").select("id, name").eq("id", g.product_id).maybeSingle(),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at").eq("gtm_record_id", gtmId).order("observed_at", { ascending: false }),
    ]);
    setGtm(g); setProduct(p); setSignals(sig ?? []); setLoading(false);
  }, [supabase, gtmId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (notFound || !gtm) return <Empty title="GTM record not found" />;

  return (
    <div>
      <div className="row gap-2" style={{ marginBottom: 6 }}>
        <Chip tone="violet">GTM record</Chip>
        {product && <a href={`/records/${product.id}`} className="t-sub t-muted">under {product.name}</a>}
      </div>
      <h1 className="t-page" style={{ marginBottom: "var(--sp-6)" }}>{gtm.name}</h1>

      <RecordWorkspace target={{ kind: "gtm", id: gtmId }} />

      <Section label="Signals">
        {signals.length === 0 ? (
          <div className="t-sub t-muted">No signals yet. Signals are the evidence (observations, data points) that back this record.</div>
        ) : (
          <div className="stack-3">
            {signals.map((s) => (
              <div key={s.id} className="card card-pad">
                <div className="row-between" style={{ gap: 12, marginBottom: 5, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
                  <Confidence label={s.conf_label} level={s.conf_level} />
                </div>
                {s.why && <p className="t-sub" style={{ lineHeight: 1.5 }}>{s.why}</p>}
                {s.observed_at && <div className="t-mono-xs" style={{ marginTop: 6 }}>{new Date(s.observed_at).toLocaleDateString()}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
