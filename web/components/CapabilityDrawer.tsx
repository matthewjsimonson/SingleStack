"use client";

// Agentic capability drawer — drill into a frontier-model release and turn it
// into ACTION. The "so what" here is "how do we leverage this to execute?": the
// relevant officer reads how it applies to our product delivery and GTM motion,
// and you turn it into an initiative or a capability-triggered workflow. This is
// the leverage-to-execute step — SingleStack isn't an intel tool, it acts.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { spawnInitiative } from "@/lib/routing";
import { Chip } from "@/components/ui";

export type DrawerCapability = {
  id: string; title: string; why: string | null; observed_at: string | null;
  metadata: { provider?: string; area?: string; url?: string; context?: string } | null;
};
type Initiative = { id: string; title: string; scope: string };

// Officers who can interpret a capability. area = which side the work lands on
// (build = product/Ship, gtm = Enablement). The initiative is cross-functional;
// the officer just seeds the starter task on their side.
const OFFICERS: { key: string; name: string; area: "build" | "gtm" }[] = [
  { key: "ceng", name: "Chief Engineering", area: "build" },
  { key: "cpo", name: "CPO", area: "build" },
  { key: "cro", name: "CRO", area: "gtm" },
  { key: "cco", name: "CCO", area: "gtm" },
];
const AREA_LABEL: Record<string, string> = { build: "Build", gtm: "GTM" };
const scopeLabel = (s: string) => (s === "gtm" ? "GTM" : s === "both" ? "Both" : "Build");

export default function CapabilityDrawer({ capability, onClose, onChanged }: { capability: DrawerCapability | null; onClose: () => void; onChanged: () => void }) {
  const supabase = createClient();
  const open = !!capability;
  const [officerKey, setOfficerKey] = useState("ceng");
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [context, setContext] = useState("");
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [linked, setLinked] = useState<Initiative[]>([]);
  const [allInit, setAllInit] = useState<Initiative[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!capability) return;
    setError(null); setTake(null); setDone(null);
    setMeta(capability.metadata ?? {});
    setContext(typeof capability.metadata?.context === "string" ? capability.metadata.context : "");
    const [{ data: ls }, { data: inits }] = await Promise.all([
      supabase.from("initiative_signals").select("initiatives ( id, title, scope )").eq("signal_id", capability.id),
      supabase.from("initiatives").select("id, title, scope").order("created_at", { ascending: false }).limit(100),
    ]);
    // deno-lint-ignore no-explicit-any
    setLinked(((ls ?? []) as any[]).map((r) => r.initiatives).filter(Boolean));
    setAllInit(inits ?? []);
  }, [supabase, capability]);
  useEffect(() => { load(); }, [load]);

  if (!capability) return null;
  const officer = OFFICERS.find((o) => o.key === officerKey) ?? OFFICERS[0];

  async function ask() {
    setThinking(true); setError(null); setTake(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const m = capability!.metadata ?? {};
      const prompt = `A new frontier-model capability is available:\n\n${capability!.title}${m.provider ? ` (${m.provider}${m.area ? ` · ${m.area}` : ""})` : ""}\n${capability!.why || ""}\n\nIn your domain, how does this apply to our product DELIVERY and our GTM motion — and what is the single most important, concrete way we should LEVERAGE it to execute (in our own operations)? Be specific; end with one recommended next step we could turn into an initiative.`;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: officer.key, messages: [{ role: "user", content: prompt }], context: { area: "capabilities" } },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTake(data.reply);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the officer."); }
    finally { setThinking(false); }
  }

  async function saveContext() {
    setBusy("context"); setError(null);
    const { error } = await supabase.from("signals").update({ metadata: { ...meta, context: context.trim() || undefined } }).eq("id", capability!.id);
    if (error) setError(error.message); else setMeta({ ...meta, context: context.trim() });
    setBusy(null);
  }

  async function createInitiative() {
    setBusy("init"); setError(null); setDone(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const title = `Leverage: ${capability!.title}`;
      await spawnInitiative(supabase, orgId, {
        title, description: take ?? capability!.why ?? null,
        scope: officer.area === "gtm" ? "gtm" : "product", priority: "medium",
        signalIds: [capability!.id], tasks: [{ area: officer.area, title }],
      });
      setDone(`Created a ${AREA_LABEL[officer.area]} initiative and linked it.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create initiative."); }
    setBusy(null);
  }

  async function createWorkflow() {
    setBusy("wf"); setError(null); setDone(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { data: ag } = await supabase.from("agents").select("id").eq("key", officer.key).maybeSingle();
      if (!ag) throw new Error(`${officer.name} agent not found.`);
      const { error } = await supabase.from("workflows").insert({
        org_id: orgId, agent_id: ag.id, name: `Leverage: ${capability!.title}`,
        trigger: "on_capability_update", function_key: "frontier", target_type: "none", skill_ids: [],
      });
      if (error) throw error;
      setDone(`Created a workflow for ${officer.name} (see Frontier → Automated responses).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workflow."); }
    setBusy(null);
  }

  async function linkInitiative(id: string) {
    if (!id) return;
    setBusy("link"); const orgId = await getOrgId();
    const { error } = await supabase.from("initiative_signals").insert({ org_id: orgId, initiative_id: id, signal_id: capability!.id });
    if (error && (error as { code?: string }).code !== "23505") setError(error.message);
    await load(); setBusy(null);
  }
  async function unlink(id: string) { setBusy("link"); await supabase.from("initiative_signals").delete().eq("initiative_id", id).eq("signal_id", capability!.id); await load(); setBusy(null); }

  const m = capability.metadata ?? {};
  const linkedIds = new Set(linked.map((i) => i.id));
  const linkable = allInit.filter((i) => !linkedIds.has(i.id));

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, transition: "opacity 0.18s ease", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap" }}>
              {m.provider && <Chip tone="accent">{m.provider}</Chip>}
              {m.area && <Chip>{m.area}</Chip>}
            </div>
            <div style={{ fontSize: 16, fontWeight: 680, lineHeight: 1.3 }}>{capability.title}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}
          {done && <div className="banner">{done}</div>}

          {(capability.why || m.url) && (
            <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }}>
              {capability.why}
              {m.url && <> · <a href={m.url} target="_blank" rel="noreferrer" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Details →</a></>}
            </div>
          )}

          {/* Leverage to execute — officer read */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>How do we leverage this?</div>
            <div className="row gap-2" style={{ marginBottom: 10, flexWrap: "wrap" }}>
              <select className="select" value={officerKey} onChange={(e) => setOfficerKey(e.target.value)} style={{ maxWidth: 200 }}>
                {OFFICERS.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </select>
              <button className="btn btn-sm" onClick={ask} disabled={thinking} style={{ background: "var(--ac)", color: "#fff" }}>{thinking ? `${officer.name} is reading…` : `Ask ${officer.name}`}</button>
            </div>
            {take && <div className="card card-pad" style={{ background: "var(--panel)" }}><div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{take}</div></div>}
          </div>

          {/* Execute */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Turn it into action</div>
            {linked.length > 0 && (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {linked.map((i) => (
                  <div key={i.id} className="row-between" style={{ gap: 8 }}>
                    <span className="row gap-2"><Chip>{scopeLabel(i.scope)}</Chip><span style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</span></span>
                    <button className="btn btn-secondary btn-sm" onClick={() => unlink(i.id)} disabled={busy === "link"}>Unlink</button>
                  </div>
                ))}
              </div>
            )}
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={createInitiative} disabled={busy === "init"}>{busy === "init" ? "Creating…" : `+ Create initiative (${AREA_LABEL[officer.area] ?? officer.area})`}</button>
              <button className="btn btn-secondary btn-sm" onClick={createWorkflow} disabled={busy === "wf"}>{busy === "wf" ? "Creating…" : `+ Workflow for ${officer.name}`}</button>
              {linkable.length > 0 && (
                <select className="select" defaultValue="" onChange={(e) => { linkInitiative(e.target.value); e.target.value = ""; }} disabled={busy === "link"} style={{ maxWidth: 240 }}>
                  <option value="">Link existing initiative…</option>
                  {linkable.map((i) => <option key={i.id} value={i.id}>{scopeLabel(i.scope)} · {i.title}</option>)}
                </select>
              )}
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Initiatives appear in Build → Ship or GTM → Enablement; workflows in Frontier → Automated responses.</div>
          </div>

          {/* Human context */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Your context</div>
            <textarea className="textarea" rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="How this fits our stack / roadmap / GTM, constraints, what to watch. The agents read this." />
            <button className="btn btn-secondary btn-sm" onClick={saveContext} disabled={busy === "context"} style={{ marginTop: 8 }}>{busy === "context" ? "Saving…" : "Save context"}</button>
          </div>
        </div>
      </aside>
    </>
  );
}
