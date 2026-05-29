"use client";

// Product record detail: header + workspace + the GTM records under it.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import RecordWorkspace from "@/components/RecordWorkspace";
import { Section, Chip, Banner, Empty } from "@/components/ui";

type Gtm = { id: string; name: string; created_at: string };

export default function RecordView({ recordId, onName }: { recordId: string; onName?: (n: string) => void }) {
  const supabase = createClient();
  const router = useRouter();
  const [record, setRecord] = useState<{ id: string; name: string } | null>(null);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [creating, setCreating] = useState(false);
  const [gtmName, setGtmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rec } = await supabase.from("product_records").select("id, name").eq("id", recordId).maybeSingle();
    if (!rec) { setNotFound(true); setLoading(false); return; }
    const { data: g } = await supabase.from("gtm_records").select("id, name, created_at").eq("product_id", recordId).order("created_at");
    setRecord(rec); setGtm(g ?? []); setLoading(false);
    onName?.(rec.name);
  }, [supabase, recordId, onName]);

  useEffect(() => { load(); }, [load]);

  async function createGtm(e: React.FormEvent) {
    e.preventDefault();
    if (!gtmName.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: recordId, name: gtmName.trim() }).select("id").single();
      if (error) throw error;
      router.push(`/gtm/${data.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create GTM record."); setBusy(false); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (notFound || !record) return <Empty title="Record not found" />;

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}><Chip tone="accent">Product record</Chip></div>
      <h1 className="t-page" style={{ marginBottom: "var(--sp-6)" }}>{record.name}</h1>

      <RecordWorkspace target={{ kind: "product", id: recordId }} />

      <Section label="GTM records" action={!creating ? <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New GTM record</button> : undefined}>
        {creating && (
          <form onSubmit={createGtm} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <label className="field">
              <span className="t-label">GTM record name</span>
              <input className="input" autoFocus placeholder="e.g. Homepage hero · messaging" value={gtmName} onChange={(e) => setGtmName(e.target.value)} />
            </label>
            <Banner>{error}</Banner>
            <div className="row gap-2">
              <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setCreating(false); setGtmName(""); setError(null); }}>Cancel</button>
            </div>
          </form>
        )}
        {gtm.length === 0 && !creating ? (
          <div className="t-sub t-muted">No GTM records yet. These are the go-to-market / messaging branches under this product.</div>
        ) : (
          <div className="grid-cards">
            {gtm.map((g) => (
              <a key={g.id} href={`/gtm/${g.id}`} className="card card-link card-pad">
                <Chip tone="violet">GTM</Chip>
                <div style={{ fontSize: 14.5, fontWeight: 620, marginTop: 10 }}>{g.name}</div>
                <div className="t-mono-xs" style={{ marginTop: 4 }}>{new Date(g.created_at).toLocaleDateString()}</div>
              </a>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
