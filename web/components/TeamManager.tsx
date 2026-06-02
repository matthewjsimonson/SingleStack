"use client";

// Team — the org's people. Set up profiles (name / title / area) so decisions and
// initiatives can be owned by a real person and agents can suggest owners. A
// profile links to a real login automatically when that user joins; you can also
// add teammates who don't have accounts yet.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner } from "@/components/ui";

type Person = { id: string; name: string; title: string | null; area: string | null; email: string | null; is_active: boolean; user_id: string | null };
const AREAS: [string, string][] = [["product", "Product"], ["gtm", "GTM"], ["eng", "Engineering"], ["exec", "Exec"], ["other", "Other"]];
const areaTone = (a: string | null): "accent" | "violet" | "green" | "default" => a === "product" ? "accent" : a === "gtm" ? "violet" : a === "eng" ? "green" : "default";

export default function TeamManager() {
  const supabase = createClient();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", area: "product", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("people").select("id, name, title, area, email, is_active, user_id").order("created_at");
    setPeople(data ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("people").insert({ org_id: orgId, name: form.name.trim(), title: form.title.trim() || null, area: form.area, email: form.email.trim() || null });
      if (error) throw error;
      setAdding(false); setForm({ name: "", title: "", area: "product", email: "" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add person."); }
    finally { setBusy(false); }
  }
  async function toggle(p: Person) { setError(null); await supabase.from("people").update({ is_active: !p.is_active }).eq("id", p.id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("people").delete().eq("id", id); await load(); }

  return (
    <Section label="Team" action={!adding ? <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add person</button> : undefined}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Your people — so decisions &amp; initiatives can be owned, and agents can suggest the right owner. Profiles link to a real login automatically when that teammate joins.</div>
      <Banner>{error}</Banner>

      {adding && (
        <form onSubmit={add} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jordan Lee" /></label>
            <label className="field"><span className="t-label">Title</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Head of Product" /></label>
            <label className="field"><span className="t-label">Area</span>
              <select className="select" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>{AREAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <label className="field"><span className="t-label">Email (optional)</span><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jordan@company.com" /></label>
          <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : people.length === 0 && !adding ? (
        <div className="t-sub t-muted">No people yet. Add your team so work can be assigned.</div>
      ) : (
        <div className="stack-3">
          {people.map((p) => (
            <div key={p.id} className="card card-pad row-between" style={{ gap: 12, opacity: p.is_active ? 1 : 0.55 }}>
              <div className="row gap-2" style={{ minWidth: 0, alignItems: "center" }}>
                <span style={{ width: 32, height: 32, borderRadius: 999, background: "var(--fill-2)", color: "var(--ts)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="row gap-2"><span style={{ fontSize: 14, fontWeight: 620 }}>{p.name}</span>{p.area && <Chip tone={areaTone(p.area)}>{p.area}</Chip>}{p.user_id && <Chip tone="green">login</Chip>}{!p.is_active && <Chip tone="amber">inactive</Chip>}</div>
                  <div className="t-sub t-muted" style={{ fontSize: 12 }}>{[p.title, p.email].filter(Boolean).join(" · ") || "—"}</div>
                </div>
              </div>
              <div className="row gap-2" style={{ flexShrink: 0 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => toggle(p)}>{p.is_active ? "Deactivate" : "Activate"}</button>
                {!p.user_id && <button className="btn btn-secondary btn-sm" onClick={() => remove(p.id)} style={{ color: "var(--rd-text)" }}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
