"use client";

// Records home. Product + GTM records in separate sections; create either type
// up front (GTM requires a parent product). Client-fetched (session-carrying).
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Empty, Spinner } from "@/components/ui";

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

  function start(m: Mode) {
    setMode(m); setName(""); setError(null);
    if (m === "gtm") setParentId(products[0]?.id ?? "");
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (mode === "gtm" && !parentId) { setError("Pick a parent product."); return; }
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization. Try signing out and back in.");
      if (mode === "product") {
        const { data, error } = await supabase.from("product_records").insert({ org_id: orgId, name: name.trim() }).select("id").single();
        if (error) throw error;
        router.push(`/records/${data.id}`);
      } else {
        const { data, error } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: parentId, name: name.trim() }).select("id").single();
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
      <PageHeader
        title="Records"
        meta={loading ? undefined : `${products.length} product${products.length === 1 ? "" : "s"} · ${gtm.length} GTM`}
        actions={mode === null ? (
          <>
            <button className="btn" onClick={() => start("product")}>+ Product</button>
            <button className="btn-secondary btn" onClick={() => start("gtm")} disabled={products.length === 0}
              title={products.length === 0 ? "Create a product first" : undefined}>+ GTM</button>
          </>
        ) : undefined}
      />

      {mode !== null && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
            <Chip tone={mode === "product" ? "accent" : "violet"}>{mode === "product" ? "Product record" : "GTM record"}</Chip>
          </div>
          <label className="field">
            <span className="t-label">Name</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={mode === "product" ? "e.g. Acme Platform" : "e.g. Homepage hero · messaging"} />
          </label>
          {mode === "gtm" && (
            <label className="field">
              <span className="t-label">Parent product</span>
              <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <Banner>{error}</Banner>
          <div className="row gap-2">
            <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            <button className="btn btn-secondary" type="button" onClick={() => { setMode(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {loading && <Spinner />}

      {isEmpty && mode === null && (
        <Empty
          title="No records yet"
          hint="Start with a product record — it's the hub. GTM records (messaging, go-to-market) live underneath a product."
          action={<button className="btn" onClick={() => start("product")}>+ Create your first product</button>}
        />
      )}

      {products.length > 0 && (
        <Section label="Product records">
          <div className="grid-cards">
            {products.map((r) => (
              <a key={r.id} href={`/records/${r.id}`} className="card card-link card-pad">
                <Chip tone="accent">Product</Chip>
                <div style={{ fontSize: 15, fontWeight: 620, marginTop: 12, marginBottom: 4 }}>{r.name}</div>
                <div className="t-mono-xs">{new Date(r.created_at).toLocaleDateString()}</div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {gtm.length > 0 && (
        <Section label="GTM records">
          <div className="grid-cards">
            {gtm.map((g) => (
              <a key={g.id} href={`/gtm/${g.id}`} className="card card-link card-pad">
                <Chip tone="violet">GTM</Chip>
                <div style={{ fontSize: 15, fontWeight: 620, marginTop: 12, marginBottom: 3 }}>{g.name}</div>
                <div className="t-sub t-muted">under {productName(g.product_id)}</div>
              </a>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
