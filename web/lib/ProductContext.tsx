"use client";

// ============================================================================
// Active-product context — the cross-module "which line of business am I in?"
// layer (multi-product-foundation.md Phase 1, + cross-sell-and-scope.md).
//
// One selection, read by every module, so a multi-product org stops seeing its
// product lines bleed together. The selection is scope-aware:
//   "all"      → every line + company-wide (the org roll-up)
//   "company"  → only company-wide rows (product_id NULL)
//   <id>       → that line — INCLUDING cross-sell rows whose co_product_ids
//                contain it (a cross-sell initiative shows in both its lines).
//
// Persisted to ?product= (shareable) + localStorage (sticky across the app's
// full-page navigations). The switcher only appears when the org actually runs
// >1 product, so single-product orgs see zero new chrome (the calm principle).
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

export type ProductScope = "all" | "company" | string; // string = a product_id
type Product = { id: string; name: string };
type ScopedRow = { product_id?: string | null; co_product_ids?: string[] | null };

type Ctx = {
  active: ProductScope;
  setActive: (s: ProductScope) => void;
  products: Product[];
  loading: boolean;
  activeLabel: string;
  // The canonical "does this row belong in the current view?" predicate —
  // mirrors the DB's spans_product(): a line shows its own rows + cross-sell rows.
  matches: (row: ScopedRow) => boolean;
};

const ProductCtx = createContext<Ctx | null>(null);
const LS_KEY = "ss.activeProduct";

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActiveState] = useState<ProductScope>("all");

  // Hydrate the selection: ?product= (shareable) → localStorage → "all".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URLSearchParams(window.location.search).get("product");
    const fromLs = (() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } })();
    setActiveState(fromUrl || fromLs || "all");
  }, []);

  // Load the org's product lines once (drives the switcher + name lookups).
  useEffect(() => {
    createClient().from("product_records").select("id, name").order("created_at")
      .then(({ data }) => { setProducts(data ?? []); setLoading(false); });
  }, []);

  const setActive = useCallback((s: ProductScope) => {
    setActiveState(s);
    try { localStorage.setItem(LS_KEY, s); } catch { /* private mode */ }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (s === "all") url.searchParams.delete("product"); else url.searchParams.set("product", s);
      window.history.replaceState(null, "", url.toString()); // shareable, no reload
    }
  }, []);

  // If the active line was deleted out from under us, fall back to the roll-up.
  useEffect(() => {
    if (!loading && active !== "all" && active !== "company" && products.length && !products.some((p) => p.id === active)) {
      setActive("all");
    }
  }, [active, products, loading, setActive]);

  const matches = useCallback((row: ScopedRow) => {
    if (active === "all") return true;
    if (active === "company") return !row.product_id;
    return row.product_id === active || (row.co_product_ids ?? []).includes(active);
  }, [active]);

  const activeLabel = active === "all" ? "All products"
    : active === "company" ? "Company-wide"
    : products.find((p) => p.id === active)?.name ?? "Product";

  return (
    <ProductCtx.Provider value={{ active, setActive, products, loading, activeLabel, matches }}>
      {children}
    </ProductCtx.Provider>
  );
}

export function useProductScope(): Ctx {
  const c = useContext(ProductCtx);
  if (!c) throw new Error("useProductScope must be used within a ProductProvider");
  return c;
}
