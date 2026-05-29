"use client";

// Foundation overview (homepage). The big picture across the whole model:
// org-wide stats, product records (with structure counts), and GTM records.
// Both record types are shown here so the Foundation reads as the complete
// canonical truth, not just products.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Empty } from "@/components/ui";

type Product = { id: string; name: string };
type Gtm = { id: string; name: string; product_id: string };
type Counts = { modules: number; features: number; gtm: number; pending: number };

export default function FoundationView() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [totals, setTotals] = useState({ products: 0, gtm: 0, signals: 0, pending: 0 });
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<null | "product" | "gtm">(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: prods }, { data: mods }, { data: feats }, { data: gtms }, { data: props }, { count: sigCount }] = await Promise.all([
      supabase.from("product_records").select("id, name").order("created_at", { ascending: false }),
      supabase.from("modules").select("id, product_id"),
      supabase.from("features").select("id, module_id"),
      supabase.from("gtm_records").select("id, name, product_id").order("created_at", { ascending: false }),
      supabase.from("proposals").select("id, product_id, gtm_record_id").eq("status", "pending"),
      supabase.from("signals").select("id", { count: "exact", head: true }),
    ]);

    const products = prods ?? [];
    const moduleProduct: Record<string, string> = {};
    (mods ?? []).forEach((m) => { moduleProduct[m.id] = m.product_id; });
    const gtmProduct: Record<string, string> = {};
    (gtms ?? []).forEach((g) => { gtmProduct[g.id] = g.product_id; });

    const c: Record<string, Counts> = {};
    products.forEach((p) => { c[p.id] = { modules: 0, features: 0, gtm: 0, pending: 0 }; });
    (mods ?? []).forEach((m) => { if (c[m.product_id]) c[m.product_id].modules++; });
    (feats ?? []).forEach((f) => { const pid = moduleProduct[f.module_id]; if (pid && c[pid]) c[pid].features++; });
    (gtms ?? []).forEach((g) => { if (c[g.product_id]) c[g.product_id].gtm++; });
    (props ?? []).forEach((pr) => {
      const pid = pr.product_id ?? (pr.gtm_record_id ? gtmProduct[pr.gtm_record_id] : null);
      if (pid && c[pid]) c[pid].pending++;
    });

    setProducts(products);
    setGtm(gtms ?? []);
    setCounts(c);
    setTotals({ products: products.length, gtm: (gtms ?? []).length, signals: sigCount ?? 0, pending: (props ?? []).length });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function start(m: "product" | "gtm") { setMode(m); setName(""); setError(null); if (m === "gtm") setParentId(products[0]?.id ?? ""); }

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
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); setBusy(false); }
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader
        title="Foundation"
        meta="The canonical truth of your products — and every layer your agents reason over."
        actions={mode === null ? (
          <>
            <button className="btn" onClick={() => start("product")}>+ Product</button>
            <button className="btn btn-secondary" onClick={() => start("gtm")} disabled={products.length === 0} title={products.length === 0 ? "Create a product first" : undefined}>+ GTM</button>
          </>
        ) : undefined}
      />

      {!loading && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-6)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-4)" }}>
          <div className="stat"><span className="stat-num">{totals.products}</span><span className="stat-label">Products</span></div>
          <div className="stat"><span className="stat-num">{totals.gtm}</span><span className="stat-label">GTM records</span></div>
          <div className="stat"><span className="stat-num">{totals.signals}</span><span className="stat-label">Signals</span></div>
          <div className="stat"><span className="stat-num" style={{ color: totals.pending > 0 ? "var(--vl-text)" : undefined }}>{totals.pending}</span><span className="stat-label">Pending proposals</span></div>
        </div>
      )}

      {mode !== null && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <div className="row" style={{ marginBottom: "var(--sp-4)" }}><Chip tone={mode === "product" ? "accent" : "violet"}>{mode === "product" ? "Product record" : "GTM record"}</Chip></div>
          <label className="field"><span className="t-label">Name</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "product" ? "e.g. Acme Platform" : "e.g. Homepage hero · messaging"} /></label>
          {mode === "gtm" && (
            <label className="field"><span className="t-label">Parent product</span>
              <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          )}
          <Banner>{error}</Banner>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => { setMode(null); setError(null); }}>Cancel</button></div>
        </form>
      )}

      {loading && <div className="t-sub t-muted">Loading…</div>}

      {!loading && products.length === 0 && gtm.length === 0 && mode === null && (
        <Empty title="Your Foundation is empty" hint="Start with a product record — the hub. Modules, features, and GTM records build out beneath it, and agents propose changes against the whole structure."
          action={<button className="btn" onClick={() => start("product")}>+ Create your first product</button>} />
      )}

      {products.length > 0 && (
        <Section label="Product records">
          <div style={{ display: "grid", gap: "var(--sp-3)" }}>
            {products.map((p) => {
              const c = counts[p.id] ?? { modules: 0, features: 0, gtm: 0, pending: 0 };
              return (
                <a key={p.id} href={`/records/${p.id}`} className="card card-link card-pad">
                  <div className="row-between" style={{ alignItems: "flex-start" }}>
                    <div className="row gap-2"><Chip tone="accent">Product</Chip><span style={{ fontSize: 16, fontWeight: 640 }}>{p.name}</span></div>
                    {c.pending > 0 && <Chip tone="violet">{c.pending} pending</Chip>}
                  </div>
                  <div className="row" style={{ gap: "var(--sp-6)", marginTop: 14 }}>
                    <span className="t-sub"><strong style={{ color: "var(--tp)" }}>{c.modules}</strong> modules</span>
                    <span className="t-sub"><strong style={{ color: "var(--tp)" }}>{c.features}</strong> features</span>
                    <span className="t-sub"><strong style={{ color: "var(--tp)" }}>{c.gtm}</strong> GTM records</span>
                  </div>
                </a>
              );
            })}
          </div>
        </Section>
      )}

      {gtm.length > 0 && (
        <Section label="GTM records">
          <div className="grid-cards">
            {gtm.map((g) => (
              <a key={g.id} href={`/gtm/${g.id}`} className="card card-link card-pad">
                <Chip tone="violet">GTM</Chip>
                <div style={{ fontSize: 15, fontWeight: 620, marginTop: 10, marginBottom: 3 }}>{g.name}</div>
                <div className="t-sub t-muted">under {productName(g.product_id)}</div>
              </a>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
