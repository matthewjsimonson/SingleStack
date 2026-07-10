"use client";

// NodeSources — where a node (or focus) pulls from. Web search is the default
// way a node hunts: it's ON unless you turn it off, and it aims at the open web
// using the node's statement as the steer. You can narrow it to specific sites,
// or turn it off to run the node on logged signals only. Tools (MCP) are
// connected ONCE elsewhere and attached here.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Src = { id: string; label: string; kind: string; status: string; cadence: string; signal_vector: string | null; signal_node_key: string | null; last_pull_at: string | null; last_pull_count: number | null; include_terms: string | null; targets: { ref?: string }[] | null };

const sitesOf = (s: Src | undefined) => (s?.targets ?? []).map((t) => t?.ref).filter(Boolean).join(", ");

export default function NodeSources({ vector, nodeKey, seed }: { vector: string; nodeKey: string | null; seed?: string }) {
  const supabase = createClient();
  const [sources, setSources] = useState<Src[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sites, setSites] = useState("");
  const [sitesDirty, setSitesDirty] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("sources")
      .select("id, label, kind, status, cadence, signal_vector, signal_node_key, last_pull_at, last_pull_count, include_terms, targets")
      .eq("signal_vector", vector).order("created_at");
    setSources((data ?? []) as Src[]);
  }, [supabase, vector]);
  useEffect(() => { load(); }, [load]);

  // This node's own sources + the vector-level ones every node inherits.
  const mine = sources.filter((s) => (nodeKey ? s.signal_node_key === nodeKey : !s.signal_node_key));
  const inherited = nodeKey ? sources.filter((s) => !s.signal_node_key) : [];
  const web = mine.find((s) => s.kind === "web_search");
  const webOn = !!web && web.status !== "disconnected";
  const tools = mine.filter((s) => s.kind !== "web_search");
  const inheritedWeb = inherited.find((s) => s.kind === "web_search" && s.status !== "disconnected");

  // Keep the sites box in sync with the stored source (until the user edits it).
  useEffect(() => { if (!sitesDirty) setSites(sitesOf(web)); }, [web, sitesDirty]);

  const withOrg = async (fn: (orgId: string) => Promise<void>) => {
    setErr(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      await fn(orgId);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
  };

  // Turn web search on/off. On creates the source if it's missing (daily
  // cadence so the heartbeat fires it); off flips it to disconnected — the
  // node then runs on logged signals only, keeping any site list for later.
  async function setWebOn(on: boolean) {
    setBusy("web");
    await withOrg(async (orgId) => {
      if (on && !web) {
        const refs = sites.split(",").map((x) => x.trim()).filter(Boolean).map((ref) => ({ ref }));
        const { error } = await supabase.from("sources").insert({
          org_id: orgId, icon: "search", label: `${vector} web search${nodeKey ? " · node" : ""}`,
          origin: "external", kind: "web_search", status: "connected", auth_mode: "none",
          include_terms: (seed || "").slice(0, 600) || null, targets: refs, max_per_pull: 10, cadence: "daily",
          signal_vector: vector, signal_node_key: nodeKey,
        });
        if (error) throw error;
      } else if (web) {
        const { error } = await supabase.from("sources").update({ status: on ? "connected" : "disconnected" }).eq("id", web.id);
        if (error) throw error;
      }
    });
    setSitesDirty(false); setBusy(null);
  }

  async function saveSites() {
    if (!web) return;
    setBusy("sites");
    const refs = sites.split(",").map((x) => x.trim()).filter(Boolean).map((ref) => ({ ref }));
    await withOrg(async () => {
      const { error } = await supabase.from("sources").update({ targets: refs }).eq("id", web.id);
      if (error) throw error;
    });
    setSitesDirty(false); setBusy(null);
  }

  async function pull(id: string) {
    setBusy(id);
    await withOrg(async () => {
      const { data: s } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("connector-runner", { body: { source_id: id }, headers: s.session?.access_token ? { Authorization: `Bearer ${s.session.access_token}` } : undefined });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    });
    setBusy(null);
  }
  async function removeSrc(id: string) {
    setBusy(id);
    await withOrg(async () => { const { error } = await supabase.from("sources").delete().eq("id", id); if (error) throw error; });
    setBusy(null);
  }

  const lastPull = (s: Src) => s.last_pull_at ? `last pull: ${s.last_pull_count ?? 0} · ${new Date(s.last_pull_at).toLocaleDateString()}` : "not pulled yet";

  return (
    <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
      <div className="t-label" style={{ marginBottom: 8 }}>Search <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— how this {nodeKey ? "node" : "focus"} hunts</span></div>
      {err && <div className="banner banner-err" style={{ marginBottom: 8 }}>{err}</div>}

      {/* Web search: the default. On = the open web, aimed by the steer. */}
      <div className="card card-pad" style={{ padding: "10px 12px" }}>
        <div className="row-between" style={{ alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 620 }}>Web search</div>
            <div className="t-sub t-muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
              {webOn ? "On — the open web, aimed by this node’s statement." : "Off — internal only; this node reads just the signals you log."}
              {web && ` · ${lastPull(web)}`}
            </div>
          </div>
          <button className={`btn btn-sm${webOn ? " btn-secondary" : ""}`} disabled={busy === "web"} onClick={() => setWebOn(!webOn)} style={{ flexShrink: 0 }}>
            {busy === "web" ? "…" : webOn ? "Turn off" : "Turn on"}
          </button>
        </div>
        {webOn && (
          <div style={{ marginTop: 10 }}>
            <span className="t-label" style={{ fontSize: 10.5 }}>Focus on specific sites <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— optional, comma-separated; empty = whole web</span></span>
            <div className="row gap-2" style={{ marginTop: 4, alignItems: "center" }}>
              <input className="input" style={{ flex: 1 }} value={sites} placeholder="e.g. techcrunch.com, news.ycombinator.com"
                onChange={(e) => { setSites(e.target.value); setSitesDirty(true); }} />
              <button className="btn btn-secondary btn-sm" disabled={!sitesDirty || busy === "sites"} onClick={saveSites}>{busy === "sites" ? "…" : "Save"}</button>
              {web && <button className="btn btn-secondary btn-sm" disabled={busy === web.id} onClick={() => pull(web.id)}>{busy === web.id ? "…" : "Pull now"}</button>}
            </div>
          </div>
        )}
      </div>

      {inheritedWeb && (
        <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
          Also inherits the focus-wide web search{sitesOf(inheritedWeb) ? ` (${sitesOf(inheritedWeb)})` : ""}.
        </div>
      )}

      {/* Attached tools (MCP) — connected once elsewhere. */}
      {tools.length > 0 && (
        <div className="stack-2" style={{ marginTop: 10 }}>
          {tools.map((s) => (
            <div key={s.id} className="card card-pad" style={{ padding: "8px 10px" }}>
              <div className="row-between" style={{ gap: 8, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 620 }}>Tool · {s.label}</div>
                  <div className="t-mono-xs t-muted">{lastPull(s)}</div>
                </div>
                <div className="row gap-2" style={{ flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => pull(s.id)} disabled={busy === s.id}>{busy === s.id ? "…" : "Pull"}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => removeSrc(s.id)} disabled={busy === s.id} style={{ color: "var(--rd-text)" }}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="row gap-2" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary btn-sm" disabled title="Connect tools once in Settings, then attach them here (coming next)">+ Connect a tool</button>
      </div>
    </div>
  );
}
