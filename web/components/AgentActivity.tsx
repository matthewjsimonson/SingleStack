"use client";

// AgentActivity — what an agent is actually doing, while it does it.
//
// Every line here is an event the edge function emitted at the moment the work
// happened. Nothing is on a timer and nothing is inferred: if a step is shown
// as running, it is running. This replaces AgentProgress, which walked invented
// stage labels on a 700ms interval whether or not they matched reality.
//
// Reasoning sits under the active step rather than in its own box, so the
// answer to "what is it doing?" is the step and "why?" is one glance below —
// singlestack-ui 1.5 (status always answerable) and 1.4 (reasoning one gesture
// away), without the monologue being the whole interface.
import { useEffect, useRef } from "react";
import type { Activity, ActivityStep } from "@/lib/agentStream";

// ---- source marks ---------------------------------------------------------
// One mark per sources.kind. The app ships no icon library (singlestack-ui §4:
// functional icons only, inline SVG), so these are drawn here. An unknown kind
// — any MCP connector label — falls back to its initial rather than a generic
// blob, so two connectors never look like the same thing.
const MARKS: Record<string, React.ReactNode> = {
  web_search: <><circle cx="6" cy="6" r="4.6" /><path d="M1.4 6h9.2M6 1.4a9 9 0 0 1 0 9.2 9 9 0 0 1 0-9.2" /></>,
  reviews: <><path d="M2 9.6V4.2M4.8 9.6V2.4M7.6 9.6V5.8M10.4 9.6V3.4" /></>,
  manual: <><path d="M2.4 2.4h7.2v7.2H2.4z" /><path d="M4.4 5h3.2M4.4 7h2" /></>,
  github: <><path d="M6 1.6a4.4 4.4 0 0 0-1.4 8.6c.2 0 .3-.1.3-.3v-1c-1.2.3-1.5-.5-1.5-.5-.2-.5-.5-.7-.5-.7-.4-.3 0-.3 0-.3.5 0 .7.5.7.5.4.7 1.1.5 1.4.4 0-.3.2-.5.3-.7-1-.1-2-.5-2-2.2 0-.5.2-.9.4-1.2 0-.1-.2-.6.1-1.2 0 0 .4-.1 1.2.5a4 4 0 0 1 2 0c.8-.6 1.2-.5 1.2-.5.3.6.1 1.1.1 1.2.3.3.4.7.4 1.2 0 1.7-1 2.1-2 2.2.2.1.3.4.3.9v1.3c0 .2.1.3.3.3A4.4 4.4 0 0 0 6 1.6z" /></>,
  analytics: <><path d="M1.6 8.4l2.6-3 2.2 2 3.9-4.2" /><path d="M1.6 10.4h8.8" /></>,
  crm: <><circle cx="4.4" cy="4" r="1.8" /><path d="M1.4 10.2a3 3 0 0 1 6 0" /><path d="M8.2 3.2a1.6 1.6 0 0 1 0 3.2M9 10.2a2.6 2.6 0 0 0-1.2-2.2" /></>,
};

function SourceChip({ kind, label, count }: { kind: string; label: string; count?: number }) {
  const mark = MARKS[kind];
  return (
    <span className="agent-src" title={kind === label ? kind : `${label} (${kind})`}>
      {mark
        ? <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{mark}</svg>
        : <span className="agent-src-initial" aria-hidden>{(label || kind).trim().charAt(0).toUpperCase()}</span>}
      <span>{label}</span>
      {typeof count === "number" && <span className="agent-src-n">{count}</span>}
    </span>
  );
}

// ---- one step -------------------------------------------------------------
function Step({ step, reasoning }: { step: ActivityStep; reasoning?: string }) {
  const running = step.state === "start";
  return (
    <div className={`agent-step${running ? " is-running" : ""}${step.state === "fail" ? " is-fail" : ""}`}>
      <span className="agent-step-glyph" aria-hidden>
        {step.state === "done" && <span className="agent-tick">✓</span>}
        {step.state === "fail" && <span className="agent-cross">✕</span>}
        {running && <span className="agent-spin" />}
      </span>
      <span className="agent-step-body">
        <span className="agent-step-label">
          {step.label}
          {step.detail && <span className="agent-step-detail"> — {step.detail}</span>}
        </span>
        {step.sources.length > 0 && (
          <span className="agent-srcs">
            {step.sources.map((s, i) => <SourceChip key={`${s.kind}-${s.label}-${i}`} {...s} />)}
          </span>
        )}
        {running && reasoning && <span className="agent-reason">{reasoning}</span>}
      </span>
    </div>
  );
}

/**
 * `busy` keeps the last step spinning while the request is still open — a step
 * whose `done` has not arrived yet is genuinely still running. When the run
 * ends, any step left open is shown as finished rather than spinning forever.
 */
export default function AgentActivity({
  activity,
  busy,
  who,
  className,
}: {
  activity: Activity;
  busy: boolean;
  who?: string;
  className?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = activity.steps.length;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [count, activity.thinking]);

  const { steps, thinking, error } = activity;
  if (steps.length === 0 && !thinking && !error) {
    return busy
      ? <div className={`agent-activity ${className ?? ""}`}><div className="agent-step is-running">
          <span className="agent-step-glyph" aria-hidden><span className="agent-spin" /></span>
          <span className="agent-step-label">{who ? `${who} is starting` : "Starting"}</span>
        </div></div>
      : null;
  }

  // The tail of the reasoning is the useful part while working — the earlier
  // text has already been superseded by the step that followed it.
  const tail = thinking.length > 400 ? thinking.slice(-400) : thinking;

  return (
    <div className={`agent-activity ${className ?? ""}`} aria-live="polite" aria-busy={busy}>
      {steps.map((s, i) => (
        <Step
          key={s.id}
          step={busy || s.state !== "start" ? s : { ...s, state: "done" }}
          reasoning={i === steps.length - 1 ? tail : undefined}
        />
      ))}
      {/* Reasoning with no step yet — the function streams thinking but has not
          reported a step. Better than showing nothing. */}
      {steps.length === 0 && thinking && (
        <div className="agent-step is-running">
          <span className="agent-step-glyph" aria-hidden><span className="agent-spin" /></span>
          <span className="agent-step-body">
            <span className="agent-step-label">{who ? `${who} is working` : "Working"}</span>
            <span className="agent-reason">{tail}</span>
          </span>
        </div>
      )}
      {error && (
        <div className="agent-step is-fail">
          <span className="agent-step-glyph" aria-hidden><span className="agent-cross">✕</span></span>
          <span className="agent-step-label">{error}</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
