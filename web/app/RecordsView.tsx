"use client";

// Records list + in-app creation. Fetches client-side with the browser client
// (which reliably carries the user's session, so RLS returns the org's rows) —
// this is also why the list is robust against server-side session edge cases.
// "New record" inserts (stamping the caller's org_id; RLS enforces it) and
// navigates to the new record so the user can start adding fields.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Record = { id: string; name: string; created_at: string };

export default function RecordsView({ initial }: { initial: Record[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [records, setRecords] = useState<Record[]>(initial);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("product_records")
      .select("id, name, created_at")
      .order("created_at", { ascending: false });
    setRecords(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization. Try signing out and back in.");
      const { data, error } = await supabase
        .from("product_records")
        .insert({ org_id: orgId, name: name.trim() })
        .select("id")
        .single();
      if (error) throw error;
      router.push(`/records/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create record.");
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 className="serif" style={{ fontSize: 24, fontWeight: 600 }}>
          Product records
        </h1>
        {!creating && (
          <button className="btn" onClick={() => setCreating(true)}>
            + New record
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="card" style={{ padding: 18, marginBottom: 20 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ts)" }}>Record name</label>
          <input
            className="input"
            autoFocus
            placeholder="e.g. Acme Platform"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginTop: 6, marginBottom: 12 }}
          />
          {error && (
            <div style={{ background: "var(--rdl)", color: "var(--rdt)", borderRadius: 7, padding: "8px 11px", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setCreating(false); setName(""); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && records.length === 0 && (
        <div className="muted" style={{ fontSize: 13.5, padding: 8 }}>Loading…</div>
      )}

      {!loading && records.length === 0 && !creating && (
        <div className="card" style={{ padding: 36, textAlign: "center" }}>
          <p className="secondary" style={{ fontSize: 14.5, marginBottom: 14 }}>No records yet.</p>
          <button className="btn" onClick={() => setCreating(true)}>+ Create your first record</button>
        </div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {records.map((r) => (
          <a key={r.id} href={`/records/${r.id}`} className="card" style={{ padding: 18, display: "block" }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 6 }}>{r.name}</div>
            <div className="mono muted" style={{ fontSize: 11 }}>
              {new Date(r.created_at).toLocaleDateString()}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
