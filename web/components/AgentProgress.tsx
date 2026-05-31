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
import { useCallback, useRef, useState } from "react";
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

  const go = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setActive(true); setIndex(0);
    // Advance through the EARLY stages on a believable cadence, but stop one shy
    // of the end and hold — the real result decides when we finish.
    const hold = stages.length - 1;
    timer.current = setInterval(() => {
      setIndex((i) => (i < hold ? i + 1 : i));
    }, 700);
    try {
      const result = await work();
      return result;
    } finally {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      setActive(false); setIndex(0);
    }
  }, [stages.length]);

  return { active, stages, index, go };
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
