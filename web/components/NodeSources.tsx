"use client";

// NodeSources — the "Sources" strip the network owns. Aim a source at a vector
// (nodeKey = null) or a single node (nodeKey set); the node's search_focus seeds
// the web-search query. connector-runner pulls it and stamps the vector's domain
// (+ node) so the harvest lands in the right intel tab and feeds this node. Tools
// (MCP) are connected ONCE elsewhere and attached here — no per-node setup.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Src = { id: string; label: string; kind: string; status: string; cadence: string; signal_vector: string | null; signal_node_key: string | null; last_pull_at: string | null; last_pull_count: number | null; include_terms: string | null };

export default function NodeSources({ vector, nodeKey, seed }: { vector: string; nodeKey: string | null; seed?: string }) {
  const supabase = createClient();
  const [sources, setSources] = useState<Src[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("sources")
      .select("id, label, kind, status, cadence, signal_vector, signal_node_key, last_pull_at, last_pull_count, include_terms")
      .eq("signal_vector", vector).order("created_at");
    setSources((data ?? []) as Src[]);
  }, [supabase, vector]);
  useEffect(() => { load(); }, [load]);

  // This node's own sources + the vector-level ones every node inherits.
  const mine = sources.filter((s) => (nodeKey ? s.signal_node_key === nodeKey : !s.signal_node_key));
  const inherited = nodeKey ? sources.filter((s) => !s.signal_node_key) : [];

  async function addWebSearch() {
    setBusy("add"); setErr(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, icon: "search", label: `${vector} web search${nodeKey ? " · node" : ""}`,
        origin: "external", kind: "web_search", status: "connected", auth_mode: "none",
        include_terms: (seed || "").slice(0, 600) || null, max_per_pull: 10, cadence: "manual",
        signal_vector: vector, signal_node_key: nodeKey,
      });
      if (error) throw error;
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not add the source."); }
    finally { setBusy(null); }
  }
  async function pull(id: string) {
    setBusy(id); setErr(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("connector-runner", { body: { source_id: id }, headers: s.session?.access_token ? { Authorization: `Bearer ${s.session.access_token}` } : undefined });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Pull failed."); }
    finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(id); setErr(null);
    const { error } = await supabase.from("sources").delete().eq("id", id);
    if (error) setErr(error.message); else await load();
    setBusy(null);
  }

  const row = (s: Src, inheritedRow: boolean) => (
    <div key={s.id} className="card card-pad" style={{ padding: "8px 10px", background: inheritedRow ? "var(--panel-2)" : undefined }}>
      <div className="row-between" style={{ gap: 8, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 620 }}>{s.kind === "web_search" ? "🔎 " : "🔌 "}{s.label}</div>
          <div className="t-mono-xs t-muted">{s.last_pull_at ? `last pull: ${s.last_pull_count ?? 0} · ${new Date(s.last_pull_at).toLocaleDateString()}` : "not pulled yet"}{inheritedRow ? " · inherited from vector" : ""}</div>
        </div>
        {!inheritedRow && (
          <div className="row gap-2" style={{ flexShrink: 0 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => pull(s.id)} disabled={busy === s.id}>{busy === s.id ? "…" : "Pull"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => remove(s.id)} disabled={busy === s.id} style={{ color: "var(--rd-text)" }}>✕</button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="t-label">Sources <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— where this {nodeKey ? "node" : "vector"} pulls from</span></div>
      </div>
      {err && <div className="banner banner-err" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="stack-2">
        {mine.map((s) => row(s, false))}
        {inherited.map((s) => row(s, true))}
        {mine.length === 0 && inherited.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No sources yet. Add web search (seeded from this {nodeKey ? "node" : "vector"}&apos;s focus), or attach a connected tool.</div>}
      </div>
      <div className="row gap-2" style={{ marginTop: 10 }}>
        <button className="btn btn-sm" onClick={addWebSearch} disabled={busy === "add"}>{busy === "add" ? "Adding…" : "+ Web search"}</button>
        <button className="btn btn-secondary btn-sm" disabled title="Connect tools once in Settings, then attach them here (coming next)">+ Connect a tool</button>
      </div>
    </div>
  );
}
