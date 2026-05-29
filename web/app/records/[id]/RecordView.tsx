"use client";

// Product record detail. Header + the shared workspace (fields/agents/proposals)
// + a GTM records section: the GTM branches that belong to this product, with
// inline create. GTM records are the messaging/go-to-market layer beneath a
// product (gtm_records.product_id → this product).
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import RecordWorkspace from "@/components/RecordWorkspace";

type Gtm = { id: string; name: string; created_at: string };

export default function RecordView({ recordId }: { recordId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [record, setRecord] = useState<{ id: string; name: string } | null>(null);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [creatingGtm, setCreatingGtm] = useState(false);
  const [gtmName, setGtmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rec } = await supabase
      .from("product_records").select("id, name").eq("id", recordId).maybeSingle();
    if (!rec) { setNotFound(true); setLoading(false); return; }
    const { data: g } = await supabase
      .from("gtm_records").select("id, name, created_at").eq("product_id", recordId).order("created_at");
    setRecord(rec);
    setGtm(g ?? []);
    setLoading(false);
  }, [supabase, recordId]);

  useEffect(() => { load(); }, [load]);

  async function createGtm(e: React.FormEvent) {
    e.preventDefault();
    if (!gtmName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase
        .from("gtm_records")
        .insert({ org_id: orgId, product_id: recordId, name: gtmName.trim() })
        .select("id").single();
      if (error) throw error;
      router.push(`/gtm/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create GTM record.");
      setBusy(false);
    }
  }

  if (loading) return <div className="muted" style={{ fontSize: 13.5 }}>Loading…</div>;
  if (notFound || !record) return <div className="card" style={{ padding: 24 }}>Record not found.</div>;

  return (
    <div>
      <a href="/" className="btn-ghost" style={{ display: "inline-block", marginBottom: 16 }}>← Records</a>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span className="chip chip-accent">Product</span>
      </div>
      <h1 className="page-title" style={{ marginBottom: 28 }}>{record.name}</h1>

      <RecordWorkspace target={{ kind: "product", id: recordId }} />

      {/* GTM records nested under this product */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 12 }}>
        <span className="section-label">GTM records</span>
        {!creatingGtm && <button className="btn-ghost" onClick={() => setCreatingGtm(true)}>+ New GTM record</button>}
      </div>

      {creatingGtm && (
        <form onSubmit={createGtm} className="card" style={{ padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ts)" }}>GTM record name</label>
          <input className="input" autoFocus placeholder="e.g. Homepage hero · messaging"
            value={gtmName} onChange={(e) => setGtmName(e.target.value)}
            style={{ marginTop: 6, marginBottom: 12 }} />
          {error && <div style={{ background: "var(--rdl)", color: "var(--rdt)", borderRadius: 7, padding: "8px 11px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            <button type="button" className="btn-ghost" onClick={() => { setCreatingGtm(false); setGtmName(""); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {gtm.length === 0 && !creatingGtm ? (
        <div className="muted" style={{ fontSize: 13 }}>
          No GTM records yet. These are the go-to-market / messaging branches under this product.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {gtm.map((g) => (
            <a key={g.id} href={`/gtm/${g.id}`} className="card card-hover" style={{ padding: 16, display: "block" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{g.name}</div>
              <div className="mono muted" style={{ fontSize: 11, marginTop: 5 }}>{new Date(g.created_at).toLocaleDateString()}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
