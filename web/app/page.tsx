// Home: list the org's product records. Server component — reads via the
// cookie-scoped Supabase client, so RLS returns only the caller's org's rows.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: records, error } = await supabase
    .from("product_records")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  return (
    <Shell email={user?.email}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 className="serif" style={{ fontSize: 24, fontWeight: 600 }}>
          Product records
        </h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {records?.length ?? 0} record{(records?.length ?? 0) === 1 ? "" : "s"}
        </span>
      </div>

      {error && (
        <div className="card" style={{ padding: 16, color: "var(--rdt)", background: "var(--rdl)" }}>
          {error.message}
        </div>
      )}

      {!error && (records?.length ?? 0) === 0 && (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <p className="secondary" style={{ fontSize: 14 }}>
            No records yet. Create one in the Supabase SQL editor, then refresh.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {records?.map((r) => (
          <a key={r.id} href={`/records/${r.id}`} className="card" style={{ padding: 18, display: "block" }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 6 }}>{r.name}</div>
            <div className="mono muted" style={{ fontSize: 11 }}>
              {new Date(r.created_at).toLocaleDateString()}
            </div>
          </a>
        ))}
      </div>
    </Shell>
  );
}
