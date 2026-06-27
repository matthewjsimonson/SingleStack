"use client";

// GTM record detail:
//   • Back to parent product + breadcrumb context
//   • Workspace (run agents / fields / proposals)
//   • Messaging — the PMA-style messaging & narrative framework (MessagingFramework),
//     the upstream source of truth content & campaigns derive from
// Raw signals do NOT live here: they're the org's intelligence stream, refined
// into proposals (the review queue) and themes — the record shows the refined
// truth, not the raw evidence. Browse signals at /signals.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import RecordWorkspace from "@/components/RecordWorkspace";
import MessagingFramework from "@/components/MessagingFramework";
import { Chip, Empty, BackLink, SubTabs } from "@/components/ui";

type Gtm = { id: string; name: string; product_id: string };
type Product = { id: string; name: string };

export default function GtmView({ gtmId }: { gtmId: string }) {
  const supabase = createClient();
  const [gtm, setGtm] = useState<Gtm | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<"workspace" | "messaging">("workspace");

  const load = useCallback(async () => {
    const { data: g } = await supabase.from("gtm_records").select("id, name, product_id").eq("id", gtmId).maybeSingle();
    if (!g) { setNotFound(true); setLoading(false); return; }
    const { data: p } = await supabase.from("product_records").select("id, name").eq("id", g.product_id).maybeSingle();
    setGtm(g); setProduct(p); setLoading(false);
  }, [supabase, gtmId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (notFound || !gtm) return <Empty title="GTM record not found" />;

  return (
    <div>
      <BackLink href="/gtm" label="GTM records" />
      <div className="row gap-2" style={{ marginBottom: 6 }}>
        <Chip tone="violet">GTM record</Chip>
        {product && <span className="t-sub t-muted">under {product.name}</span>}
      </div>
      <h1 className="t-page" style={{ marginBottom: "var(--sp-6)" }}>{gtm.name}</h1>

      <SubTabs<typeof view>
        tabs={[{ key: "workspace", label: "Workspace" }, { key: "messaging", label: "Messaging" }]}
        active={view} onChange={setView}
      />

      {view === "workspace" && <RecordWorkspace target={{ kind: "gtm", id: gtmId }} recordName={gtm.name} />}
      {view === "messaging" && <MessagingFramework gtmId={gtmId} />}
    </div>
  );
}
