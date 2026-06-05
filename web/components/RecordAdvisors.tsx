"use client";

// RecordAdvisors — the agents that live ON a record, aligned to its area:
// a Product record is advised by the CPO + Chief Engineering agents; a GTM record
// by the CRO + CCO. You can ASK each officer (a context-grounded chat), and run a
// single JOINT PROPOSE where the pair draft one change to the record together.
import { useState } from "react";
import { EXEC_BY_KEY, type Exec } from "@/lib/team";
import AgentDrawer, { type AgentContext } from "@/components/AgentDrawer";
import ProposeDrawer from "@/components/ProposeDrawer";
import type { Target } from "@/components/RecordWorkspace";

type AgentRow = { id: string; key: string; name: string; role: string | null };

// Which officers advise each record type (the joint-propose pair).
const AREA_TEAM: Record<Target["kind"], string[]> = { product: ["cpo", "ceng"], gtm: ["cro", "cco"] };

function initials(name: string) { return name.replace(/[^a-zA-Z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AI"; }

export default function RecordAdvisors({
  target, recordName, agents, pendingByName, onRan,
}: {
  target: Target;
  recordName?: string;
  agents: AgentRow[];
  pendingByName: Record<string, number>;
  onRan: () => void;
}) {
  const [openExec, setOpenExec] = useState<Exec | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);

  // The area's officers that actually exist in this org; fall back to whatever
  // active agents exist so the surface is never empty.
  const existing = new Map(agents.map((a) => [a.key, a]));
  const contextual = AREA_TEAM[target.kind].map((k) => EXEC_BY_KEY[k]).filter((e) => e && existing.has(e.key));
  const advisors: Exec[] = contextual.length
    ? contextual
    : agents.map((a) => EXEC_BY_KEY[a.key] ?? { key: a.key, name: a.name, short: initials(a.name), role: a.role ?? "Agent", accent: "var(--ac)", system_prompt: "" });

  const context: AgentContext = { area: target.kind === "gtm" ? "gtm" : "products", record_type: target.kind, record_id: target.id, record_name: recordName };
  const intro = target.kind === "product"
    ? "Your product advisors — they read this record, watch your signals, and (together) propose sharper positioning, modules & roadmap."
    : "Your go-to-market advisors — they read this record, watch your signals, and (together) propose sharper messaging, personas & positioning.";
  const totalPending = Object.values(pendingByName).reduce((a, b) => a + b, 0);

  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>Advisors</div>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{intro}</div>

      {advisors.length === 0 ? (
        <div className="t-sub t-muted">No active agents. <a href="/agents" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Set up your team →</a></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
            {advisors.map((e) => (
              <AdvisorCard key={e.key} exec={e} onAsk={() => setOpenExec(e)} />
            ))}
          </div>
          <ProposeBar advisors={advisors} pending={totalPending} onOpen={() => setProposeOpen(true)} />
        </>
      )}

      <AgentDrawer exec={openExec} open={!!openExec} onClose={() => setOpenExec(null)} context={context} />
      <ProposeDrawer
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        target={{ kind: target.kind, id: target.id, name: recordName }}
        advisors={advisors.map((a) => ({ key: a.key, name: a.name, short: a.short, accent: a.accent }))}
        onDone={onRan}
      />
    </div>
  );
}

// One officer — Ask (chat). Proposals are a joint task, handled below.
function AdvisorCard({ exec, onAsk }: { exec: Exec; onAsk: () => void }) {
  return (
    <div className="card card-pad pop" style={{ borderLeft: `3px solid ${exec.accent}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row gap-2" style={{ alignItems: "flex-start" }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: exec.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{exec.short}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 660, lineHeight: 1.2 }}>{exec.name}</div>
          <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.35, marginTop: 2 }}>{exec.role}</div>
        </div>
      </div>
      <button className="btn btn-sm" onClick={onAsk} style={{ marginTop: "auto" }}>Ask {exec.name.split(" ").slice(-1)[0]}</button>
    </div>
  );
}

// The joint proposal entry point — opens the ProposeDrawer where it runs live.
function ProposeBar({ advisors, pending, onOpen }: { advisors: Exec[]; pending: number; onOpen: () => void }) {
  const names = advisors.map((a) => a.name.split(" ").slice(-1)[0]).join(" + ");
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          <div style={{ display: "flex" }}>
            {advisors.map((e, i) => (
              <span key={e.key} style={{ width: 30, height: 30, borderRadius: "50%", background: e.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, border: "2px solid var(--panel)", marginLeft: i ? -8 : 0 }}>{e.short}</span>
            ))}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 660 }}>Joint proposal</div>
            <div className="t-sub t-muted" style={{ fontSize: 12 }}>{names} draft one change together — runs in a side panel, with their reasoning.</div>
          </div>
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          {pending > 0 && (
            <span className="row gap-2" style={{ fontSize: 12, color: "var(--vl-text)", fontWeight: 600 }}>
              <span className="agent-progress-dot" style={{ background: "var(--vl)" }} aria-hidden />{pending} waiting
            </span>
          )}
          <button className="btn btn-accent btn-sm" onClick={onOpen}>✦ Propose</button>
        </div>
      </div>
    </div>
  );
}
