"use client";

// AgentProgress — makes an AI action feel ALIVE without faking it or costing
// performance. It walks the agent's REAL named stages while the work runs, and
// PARKS on the last stage until the actual result returns (never claims "done"
// early). One light interval (no rAF), cleared the instant work resolves.
//
// Usage:
//   const run = useAgentRun("synthesize");
//   await run(() => supabase.functions.invoke("synthesize-signals", {...}));
// and render <AgentProgress run={run} /> where the spinner used to be.
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_STAGES } from "@/lib/agentStages";

export type AgentRun = {
  active: boolean;
  stages: string[];
  index: number;          // current stage being shown
  go: <T>(work: () => Promise<T>) => Promise<T>;
};

export function useAgentRun(kind: keyof typeof AGENT_STAGES | string): AgentRun {
  const stages = AGENT_STAGES[kind] ?? ["Working"];
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  // Guard against the component unmounting mid-run (e.g. the user drills into a
  // node while an agent is working): stop the interval and never setState after
  // unmount. No leak, no React warning.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, []);

  const go = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setActive(true); setIndex(0);
    // Advance through the EARLY stages on a believable cadence, but stop one shy
    // of the end and hold — the real result decides when we finish.
    const hold = stages.length - 1;
    timer.current = setInterval(() => {
      if (!mounted.current) return;
      setIndex((i) => (i < hold ? i + 1 : i));
    }, 700);
    try {
      return await work();
    } finally {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      if (mounted.current) { setActive(false); setIndex(0); }
    }
  }, [stages.length]);

  return { active, stages, index, go };
}

// The "living intel brain" renderer: the run's stages as a step LIST — green ✓
// for completed stages, spinner on the active one, dimmed ○ for what's ahead.
// Same honesty contract as AgentProgress: early stages walk on a believable
// cadence and the list PARKS one shy of done until the real result returns.
export function AgentStepList({ run, note }: { run: AgentRun; note?: string }) {
  if (!run.active) return null;
  return (
    <div>
      <div className="stack-2">
        {run.stages.map((label, i) => {
          const state = i < run.index ? "done" : i === run.index ? "active" : "pending";
          return (
            <div key={i} className="row gap-2" style={{ alignItems: "center", opacity: state === "pending" ? 0.45 : 1 }}>
              {state === "done" && <span style={{ width: 16, textAlign: "center", color: "var(--gn-text, var(--gn-text))", fontWeight: 700, fontSize: 12 }}>✓</span>}
              {state === "active" && <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}><span className="agent-progress-dot" aria-hidden /></span>}
              {state === "pending" && <span style={{ width: 16, textAlign: "center", color: "var(--tm)", fontSize: 11 }}>○</span>}
              <span style={{ fontSize: 12.5, fontWeight: state === "active" ? 650 : 500, color: state === "active" ? "var(--tp)" : "var(--ts)" }}>{label}{state === "active" ? "…" : ""}</span>
            </div>
          );
        })}
      </div>
      {note && <div className="t-mono-xs t-muted" style={{ marginTop: 8 }}>{note}</div>}
    </div>
  );
}

export function AgentProgress({ run, compact = false }: { run: AgentRun; compact?: boolean }) {
  if (!run.active) return null;
  const label = run.stages[Math.min(run.index, run.stages.length - 1)];
  return (
    <span className="agent-progress" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: compact ? 12 : 13 }}>
      <span className="agent-progress-dot" aria-hidden />
      <span className="agent-progress-label">{label}…</span>
    </span>
  );
}
