"use client";

// Records home. Lists both record types and lets you create either one up front:
//   • Product record — top-level hub.
//   • GTM record — must belong to a product (pick the parent).
// Fetches client-side (session-carrying) so RLS returns the org's rows.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Product = { id: string; name: string; created_at: string };
type Gtm = { id: string; name: string; product_id: string; created_at: string };

type Mode = null | "product" | "gtm";

export default function RecordsView() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: p }, { data: g }] = await Promise.all([
      supabase.from("product_records").select("id, name, created_at").order("created_at", { ascending: false }),
      supabase.from("gtm_records").select("id, name, product_id, created_at").order("created_at", { ascending: false }),
    ]);
    setProducts(p ?? []);
    setGtm(g ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function startProduct() { setMode("product"); setName(""); setError(null); }
  function startGtm() {
    setMode("gtm"); setName(""); setError(null);
    setParentId(products[0]?.id ?? "");
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (mode === "gtm" && !parentId) { setError("Pick a parent product for the GTM record."); return; }
    setBusy(true);
    setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization. Try signing out and back in.");
      if (mode === "product") {
        const { data, error } = await supabase
          .from("product_records").insert({ org_id: orgId, name: name.trim() })
          .select("id").single();
        if (error) throw error;
        router.push(`/records/${data.id}`);
      } else {
        const { data, error } = await supabase
          .from("gtm_records").insert({ org_id: orgId, product_id: parentId, name: name.trim() })
          .select("id").single();
        if (error) throw error;
        router.push(`/gtm/${data.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create record.");
      setBusy(false);
    }
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";
  const isEmpty = !loading && products.length === 0 && gtm.length === 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 className="page-title">Records</h1>
        {mode === null && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={startProduct}>+ Product record</button>
            <button className="btn-ghost" onClick={startGtm} disabled={products.length === 0}
              title={products.length === 0 ? "Create a product first" : undefined}>
              + GTM record
            </button>
          </div>
        )}
      </div>

      {mode !== null && (
        <form onSubmit={create} className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span className={`chip ${mode === "product" ? "chip-accent" : "chip-violet"}`}>
              {mode === "product" ? "Product record" : "GTM record"}
            </span>
          </div>

          <label className="section-label" style={{ display: "block", marginBottom: 6 }}>Name</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder={mode === "product" ? "e.g. Acme Platform" : "e.g. Homepage hero · messaging"}
            style={{ marginBottom: 14 }} />

          {mode === "gtm" && (
            <>
              <label className="section-label" style={{ display: "block", marginBottom: 6 }}>Parent product</label>
              <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ marginBottom: 14 }}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}

          {error && (
            <div style={{ background: "var(--rdl)", color: "var(--rdt)", borderRadius: 7, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            <button type="button" className="btn-ghost" onClick={() => { setMode(null); setName(""); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {isEmpty && mode === null && (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <p className="secondary" style={{ fontSize: 14.5, marginBottom: 16 }}>
            No records yet. Start with a product record — GTM records live underneath it.
          </p>
          <button className="btn" onClick={startProduct}>+ Create your first product record</button>
        </div>
      )}

      {loading && <div className="muted" style={{ fontSize: 13.5 }}>Loading…</div>}

      {/* Product records */}
      {products.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 12 }}>Product records</div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", marginBottom: 30 }}>
            {products.map((r) => (
              <a key={r.id} href={`/records/${r.id}`} className="card card-hover" style={{ padding: 18, display: "block" }}>
                <span className="chip chip-accent">Product</span>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10, marginBottom: 5 }}>{r.name}</div>
                <div className="mono muted" style={{ fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString()}</div>
              </a>
            ))}
          </div>
        </>
      )}

      {/* GTM records */}
      {gtm.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 12 }}>GTM records</div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {gtm.map((g) => (
              <a key={g.id} href={`/gtm/${g.id}`} className="card card-hover" style={{ padding: 18, display: "block" }}>
                <span className="chip chip-violet">GTM</span>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10, marginBottom: 3 }}>{g.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>under {productName(g.product_id)}</div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
