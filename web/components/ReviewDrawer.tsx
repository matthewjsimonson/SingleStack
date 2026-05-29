"use client";

// Slide-out drawer listing everything awaiting the operator's review (pending
// proposals across all records) with inline actions — Accept, or open the
// record. Same drawer pattern as the agent drawer, for consistency.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Confidence } from "@/components/ui";

type Pending = {
  id: string; title: string; rationale: string | null;
  conf_label: string | null; conf_level: number | null;
  product_id: string | null; gtm_record_id: string | null; proposed_by: string; created_at: string;
};

export default function ReviewDrawer({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<Pending[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: props }, { data: prods }, { data: gtms }] = await Promise.all([
      supabase.from("proposals").select("id, title, rationale, conf_label, conf_level, product_id, gtm_record_id, proposed_by, created_at").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("product_records").select("id, name"),
      supabase.from("gtm_records").select("id, name"),
    ]);
    const n: Record<string, string> = {};
    (prods ?? []).forEach((p) => { n[p.id] = p.name; });
    (gtms ?? []).forEach((g) => { n[g.id] = g.name; });
    setNames(n);
    setItems(props ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (open) { setLoading(true); load(); } }, [open, load]);

  async function accept(id: string) {
    setAcceptingId(id); setError(null);
    try {
      const { error } = await supabase.rpc("accept_proposal", { p_proposal: id, p_ratifier: "web" });
      if (error) throw error;
      await load();
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Accept failed."); }
    finally { setAcceptingId(null); }
  }

  const hrefOf = (p: Pending) => p.product_id ? `/records/${p.product_id}` : p.gtm_record_id ? `/gtm/${p.gtm_record_id}` : "/";
  const targetName = (p: Pending) => names[(p.product_id ?? p.gtm_record_id) ?? ""] ?? "record";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.18s ease", zIndex: 40 }} />
      <aside style={{
        position: "fixed", top: 0, right: 0, height: "100vh", width: 460, maxWidth: "92vw",
        background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)",
        transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
        zIndex: 41, display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>Needs your review</div>
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{items.length} pending proposal{items.length === 1 ? "" : "s"}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}
          {loading ? <div className="t-sub t-muted">Loading…</div>
            : items.length === 0 ? <div className="t-sub t-muted" style={{ textAlign: "center", padding: "24px 0" }}>Nothing pending. You&apos;re all caught up.</div>
            : (
              <div className="stack-3">
                {items.map((p) => (
                  <div key={p.id} className="card card-pad" style={{ borderLeft: "2px solid var(--vl)" }}>
                    <div className="row-between" style={{ gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 620 }}>{p.title}</div>
                      <Confidence label={p.conf_label} level={p.conf_level} />
                    </div>
                    <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>{targetName(p)} · {p.proposed_by}</div>
                    {p.rationale && <p className="t-sub" style={{ lineHeight: 1.5, marginBottom: 12 }}>{p.rationale}</p>}
                    <div className="row gap-2">
                      <button className="btn btn-success btn-sm" disabled={acceptingId !== null} onClick={() => accept(p.id)}>{acceptingId === p.id ? "Accepting…" : "Accept"}</button>
                      <a className="btn btn-secondary btn-sm" href={hrefOf(p)}>Open record</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </aside>
    </>
  );
}
