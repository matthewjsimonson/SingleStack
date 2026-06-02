"use client";

// RecordAdvisors — the agents that live ON a record, aligned to its area:
// a Product record is advised by the CPO + Chief Engineering agents; a GTM
// record by the CRO + CCO. Not a name in a box — each is an "alive" card:
// a breathing Ready dot, a hover-pop, real running stages when it works, and a
// "N waiting" badge when it has proposals pending. Two actions: Ask (a
// context-grounded chat) and Propose (generate a change on this record).
import { useState } from "react";
import { EXEC_BY_KEY, type Exec } from "@/lib/team";
import AgentDrawer, { type AgentContext } from "@/components/AgentDrawer";
import { AgentProgress, useAgentRun } from "@/components/AgentProgress";
import type { Target } from "@/components/RecordWorkspace";

type AgentRow = { id: string; key: string; name: string; role: string | null };

// Which officers advise each record type.
const AREA_TEAM: Record<Target["kind"], string[]> = { product: ["cpo", "ceng"], gtm: ["cro", "cco"] };

function initials(name: string) { return name.replace(/[^a-zA-Z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AI"; }

export default function RecordAdvisors({
  target, recordName, agents, pendingByName, onRun, onRan, onError,
}: {
  target: Target;
  recordName?: string;
  agents: AgentRow[];
  pendingByName: Record<string, number>;
  onRun: (key: string) => Promise<void>;
  onRan: () => void;
  onError: (msg: string | null) => void;
}) {
  const [openExec, setOpenExec] = useState<Exec | null>(null);

  // The area's officers that actually exist in this org; fall back to whatever
  // active agents exist so the surface is never empty.
  const existing = new Map(agents.map((a) => [a.key, a]));
  const contextual = AREA_TEAM[target.kind].map((k) => EXEC_BY_KEY[k]).filter((e) => e && existing.has(e.key));
  const advisors: Exec[] = contextual.length
    ? contextual
    : agents.map((a) => EXEC_BY_KEY[a.key] ?? { key: a.key, name: a.name, short: initials(a.name), role: a.role ?? "Agent", accent: "var(--ac)", system_prompt: "" });

  const context: AgentContext = { area: target.kind === "gtm" ? "gtm" : "products", record_type: target.kind, record_id: target.id, record_name: recordName };
  const intro = target.kind === "product"
    ? "Your product advisors — they read this record, watch your signals, and propose sharper positioning, modules & roadmap."
    : "Your go-to-market advisors — they read this record, watch your signals, and propose sharper messaging, personas & positioning.";

  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>Advisors</div>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{intro}</div>

      {advisors.length === 0 ? (
        <div className="t-sub t-muted">No active agents. <a href="/agents" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Set up your team →</a></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--sp-3)" }}>
          {advisors.map((e) => (
            <AdvisorCard key={e.key} exec={e} pending={pendingByName[e.name] ?? 0}
              onAsk={() => setOpenExec(e)} onRun={() => onRun(e.key)} onRan={onRan} onError={onError} />
          ))}
        </div>
      )}

      <AgentDrawer exec={openExec} open={!!openExec} onClose={() => setOpenExec(null)} context={context} />
    </div>
  );
}

function AdvisorCard({ exec, pending, onAsk, onRun, onRan, onError }: {
  exec: Exec; pending: number; onAsk: () => void; onRun: () => Promise<void>; onRan: () => void; onError: (m: string | null) => void;
}) {
  const run = useAgentRun("propose");

  async function propose() {
    onError(null);
    try { await run.go(() => onRun()); onRan(); }
    catch (e) { onError(e instanceof Error ? e.message : "Agent run failed."); }
  }

  return (
    <div className="card card-pad pop" style={{ borderLeft: `3px solid ${exec.accent}`, display: "flex", flexDirection: "column", gap: 10, minHeight: 132 }}>
      <div className="row gap-2" style={{ alignItems: "flex-start" }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: exec.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{exec.short}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 660, lineHeight: 1.2 }}>{exec.name}</div>
          <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.35, marginTop: 2 }}>{exec.role}</div>
        </div>
      </div>

      {/* alive status line */}
      <div style={{ minHeight: 18 }}>
        {run.active ? (
          <AgentProgress run={run} compact />
        ) : pending > 0 ? (
          <span className="row gap-2" style={{ fontSize: 12, color: "var(--vl-text)", fontWeight: 600 }}>
            <span className="agent-progress-dot" style={{ background: "var(--vl)" }} aria-hidden />{pending} proposal{pending === 1 ? "" : "s"} waiting
          </span>
        ) : (
          <span className="row gap-2 t-muted" style={{ fontSize: 12 }}>
            <span className="agent-progress-dot" style={{ background: "var(--gn)" }} aria-hidden />Ready
          </span>
        )}
      </div>

      <div className="row gap-2" style={{ marginTop: "auto" }}>
        <button className="btn btn-sm" onClick={onAsk} disabled={run.active} style={{ flex: 1 }}>Ask</button>
        <button className="btn btn-accent btn-sm" onClick={propose} disabled={run.active} style={{ flex: 1 }}>{run.active ? "Working…" : "Propose"}</button>
      </div>
    </div>
  );
}
