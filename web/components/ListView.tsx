"use client";

// Filtered list of one record type (product or gtm) — the Foundation child tabs.
// Create inline; click to drill in.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner, Empty } from "@/components/ui";
import RecordSetup from "@/components/RecordSetup";

type Product = { id: string; name: string; created_at: string };
type Gtm = { id: string; name: string; product_id: string; created_at: string };

export default function ListView({ kind }: { kind: "product" | "gtm" }) {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Purchase-day path: materials + interview -> drafted records you refine.
  const [aiSetup, setAiSetup] = useState(false);

  const load = useCallback(async () => {
    if (kind === "product") {
      const { data } = await supabase.from("product_records").select("id, name, created_at").order("created_at", { ascending: false });
      setProducts(data ?? []);
    } else {
      const [{ data: g }, { data: p }] = await Promise.all([
        supabase.from("gtm_records").select("id, name, product_id, created_at").order("created_at", { ascending: false }),
        supabase.from("product_records").select("id, name, created_at"),
      ]);
      setGtm(g ?? []); setProducts(p ?? []);
    }
    setLoading(false);
  }, [supabase, kind]);

  useEffect(() => { load(); }, [load]);

  function start() { setCreating(true); setName(""); setError(null); if (kind === "gtm") setParentId(products[0]?.id ?? ""); }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (kind === "gtm" && !parentId) { setError("Pick a parent product."); return; }
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      if (kind === "product") {
        const { data, error } = await supabase.from("product_records").insert({ org_id: orgId, name: name.trim() }).select("id").single();
        if (error) throw error;
        router.push(`/records/${data.id}`);
      } else {
        const { data, error } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: parentId, name: name.trim() }).select("id").single();
        if (error) throw error;
        router.push(`/gtm/${data.id}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); setBusy(false); }
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";
  const title = kind === "product" ? "Product records" : "GTM records";
  const empty = kind === "product" ? products.length === 0 : gtm.length === 0;

  return (
    <div>
      <PageHeader
        title={title}
        actions={!creating && !aiSetup ? (
          <span className="row gap-2">
            {kind === "product" && <button className="btn" onClick={() => setAiSetup(true)} title="Bring your materials (paste, URLs, PDFs), answer a short interview, refine the drafted records — then they're created.">✦ Set up with AI</button>}
            <button className={kind === "product" ? "btn btn-secondary" : "btn"} onClick={start} disabled={kind === "gtm" && products.length === 0}
              title={kind === "gtm" && products.length === 0 ? "Create a product first" : undefined}>
              + New {kind === "product" ? "product" : "GTM record"}
            </button>
          </span>
        ) : undefined}
      />

      {aiSetup && (
        <div style={{ marginBottom: "var(--sp-6)" }}>
          <RecordSetup onDone={(productId) => { setAiSetup(false); if (productId) router.push(`/records/${productId}`); else load(); }} />
        </div>
      )}

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">Name</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "product" ? "e.g. Acme Platform" : "e.g. Homepage hero · messaging"} /></label>
          {kind === "gtm" && (
            <label className="field"><span className="t-label">Parent product</span>
              <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          )}
          <Banner>{error}</Banner>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => { setCreating(false); setError(null); }}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : empty && !creating && !aiSetup ? (
          <Empty title={`No ${kind === "product" ? "product" : "GTM"} records yet`}
            hint={kind === "product" ? "Start with AI: your materials + a short interview draft both records — you refine every field before they're created." : "GTM records are the go-to-market branches beneath a product."}
            action={kind === "product"
              ? <span className="row gap-2"><button className="btn" onClick={() => setAiSetup(true)}>✦ Set up with AI</button><button className="btn btn-secondary" onClick={start}>+ By hand</button></span>
              : <button className="btn" onClick={start} disabled={products.length === 0}>+ New GTM record</button>} />
        ) : (
          <div className="grid-cards">
            {kind === "product" && products.map((p) => (
              <a key={p.id} href={`/records/${p.id}`} className="card card-link card-pad">
                <Chip tone="accent">Product</Chip>
                <div style={{ fontSize: 15, fontWeight: 620, marginTop: 10, marginBottom: 4 }}>{p.name}</div>
                <div className="t-mono-xs">{new Date(p.created_at).toLocaleDateString()}</div>
              </a>
            ))}
            {kind === "gtm" && gtm.map((g) => (
              <a key={g.id} href={`/gtm/${g.id}`} className="card card-link card-pad">
                <Chip tone="violet">GTM</Chip>
                <div style={{ fontSize: 15, fontWeight: 620, marginTop: 10, marginBottom: 3 }}>{g.name}</div>
                <div className="t-sub t-muted">under {productName(g.product_id)}</div>
              </a>
            ))}
          </div>
        )}
    </div>
  );
}
