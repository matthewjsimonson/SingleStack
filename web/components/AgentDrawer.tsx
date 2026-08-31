"use client";

// Slide-out drawer for an executive agent: a live status panel (tiles) + a real
// chat that talks to the agent-chat Edge Function (grounded in the org's data),
// with a one-click "Daily briefing" action.
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Exec } from "@/lib/team";
import { Chip } from "@/components/ui";
import { LiveReply, useAliveReply, streamAgentChat, useRunAbort, isAbortError } from "@/components/alive";
import { Markdown } from "@/components/Markdown";
import WorkflowRunDrawer from "@/components/WorkflowRunDrawer";

type WF = { id: string; name: string; description: string | null; steps: unknown[] | null };

type Msg = { role: "user" | "assistant"; content: string };
export type AgentContext = {
  area?: "products" | "gtm" | "signals" | "records";
  record_id?: string;
  record_type?: "product" | "gtm";
  record_name?: string;
  module?: string;
  page?: string;   // generic page key for page-awareness, e.g. "strategy" | "market"
  label?: string;  // human label of the current page/entity
};

type Connector = { id: string; label: string };
type ChildSkill = { id: string; name: string; areas: string[] };

// Map the page context to skill `areas` keys, so the "/" menu can SUGGEST the
// child skills relevant to where the operator is (suggest, never auto-fire).
function pageAreasOf(ctx?: AgentContext | null): string[] {
  if (!ctx) return [];
  const out: string[] = [];
  const areaMap: Record<string, string> = { products: "product", gtm: "gtm", signals: "signals" };
  if (ctx.area && areaMap[ctx.area]) out.push(areaMap[ctx.area]);
  if (ctx.page) out.push(ctx.page);
  if (ctx.record_type === "product") out.push("product");
  if (ctx.record_type === "gtm") out.push("gtm");
  return [...new Set(out)];
}

export default function AgentDrawer({
  exec,
  open,
  onClose,
  context,
  runner,
}: {
  exec: Exec | null;
  open: boolean;
  onClose: () => void;
  context?: AgentContext | null;
  runner?: string; // edge function to drive chat (default "agent-chat"); e.g. "agent-run" for the agentic loop
}) {
  const supabase = createClient();
  const beginRun = useRunAbort();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [pending, setPending] = useState(0);
  const [mode, setMode] = useState<"chat" | "workflows">("chat");
  const [workflows, setWorkflows] = useState<WF[]>([]);
  const [runWf, setRunWf] = useState<{ id: string; name: string } | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [childSkills, setChildSkills] = useState<ChildSkill[]>([]);
  const [pageAware, setPageAware] = useState(false);   // opt-in: ground the agent in the current page
  const [steer, setSteer] = useState<string | null>(null); // "/" connector selected for this turn
  const [steerSkill, setSteerSkill] = useState<{ id: string; name: string } | null>(null); // "/" child skill summoned for this turn
  // "/" menu state: open when the input begins with "/" and no space yet.
  const slashQuery = input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : null;
  const slashMatches = slashQuery !== null ? connectors.filter((c) => c.label.toLowerCase().includes(slashQuery)) : [];
  // Child skills the operator can summon, suggested-first by page context.
  const pageAreas = pageAreasOf(context);
  const suggests = (s: ChildSkill) => (s.areas ?? []).some((a) => pageAreas.includes(a));
  const slashSkills = slashQuery !== null
    ? childSkills.filter((s) => s.name.toLowerCase().includes(slashQuery)).sort((a, b) => Number(suggests(b)) - Number(suggests(a)))
    : [];
  const hasPage = !!(context && (context.record_name || context.label || context.page || context.area));
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);   // the in-progress reply bubble, to bring into view
  const reply = useAliveReply();

  // When the reply has fully typed out, commit it as a message and clear the live bubble.
  useEffect(() => {
    if (!busy && !reply.typing && reply.display) {
      setMessages((prev) => [...prev, { role: "assistant", content: reply.display }]);
      reply.reset();
    }
  }, [busy, reply.typing, reply.display, reply.reset]);

  // reset + load light status whenever a different agent opens
  useEffect(() => {
    if (!open || !exec) return;
    setMessages([]); setInput(""); setError(null); setMode("chat"); setSteer(null); setSteerSkill(null); setConnectors([]); setChildSkills([]); setPageAware(false);
    (async () => {
      const [{ data: ag }, { data: wf }] = await Promise.all([
        supabase.from("agents").select("id").eq("key", exec.key).maybeSingle(),
        supabase.from("workflows").select("id, name, description, steps").eq("is_active", true).order("created_at"),
      ]);
      if (ag) {
        const { count: rc } = await supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", ag.id);
        setRuns(rc ?? 0);
        const { data: conns } = await supabase.from("connections").select("id, label").eq("agent_id", ag.id).eq("kind", "mcp").neq("status", "disconnected");
        setConnectors((conns ?? []) as Connector[]);
        // Child (non-cornerstone) skills — summonable with "/" for a single turn.
        const { data: sk } = await supabase.from("agent_skills").select("skills ( id, name, areas )").eq("agent_id", ag.id).eq("is_cornerstone", false);
        // deno-lint-ignore no-explicit-any
        setChildSkills(((sk ?? []).map((r: any) => r.skills).filter(Boolean) as ChildSkill[]));
      } else setRuns(0);
      const { count: pc } = await supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending");
      setPending(pc ?? 0);
      setWorkflows((wf ?? []) as WF[]);
    })();
  }, [open, exec, supabase]);

  // No scroll-to-bottom — on a new turn we bring the START of the reply into view
  // (below) so you read top-down instead of being yanked to the end.

  async function send(text: string) {
    if (!exec || !text.trim()) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    const runCtx = { ...(context ?? {}), page_aware: pageAware, ...(steer ? { steer_connector: steer } : {}), ...(steerSkill ? { steer_skill: steerSkill.id } : {}) };
    setMessages(next); setInput(""); setBusy(true); setError(null); setSteer(null); setSteerSkill(null);
    reply.begin();
    requestAnimationFrame(() => liveRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      await streamAgentChat({ signal: beginRun(), agentKey: exec.key, messages: next, context: runCtx, token, onChunk: reply.onChunk, onThinking: reply.onThinking, onActivity: reply.onActivity, fnName: runner, fallbackFnName: runner ? "agent-chat" : undefined });
      reply.finish();
    } catch (e) { if (isAbortError(e)) return;
      reply.reset();
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally { setBusy(false); }
  }

  if (!exec) return null;

  return (
    <>
      {/* scrim */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.18s ease", zIndex: 40 }} />
      {/* panel */}
      <aside style={{
        position: "fixed", top: 0, right: 0, height: "100vh", width: 440, maxWidth: "92vw",
        background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)",
        transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
        zIndex: 41, display: "flex", flexDirection: "column",
      }}>
        {/* header */}
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: exec.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{exec.short}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>{exec.name}</div>
            <div className="t-sub t-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exec.role}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        {/* context strip — what page you're on + opt-in "page-aware" toggle. When on,
            the agent reads this page's data and grounds its answer in it. */}
        {hasPage && (
          <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {context?.record_name
              ? <span className="chip chip-accent" style={{ fontSize: 11.5 }}>{context.record_type === "gtm" ? "GTM" : "Product"}: {context.record_name}{context.module ? ` · ${context.module}` : ""}</span>
              : <span className="t-label" style={{ color: "var(--tm)" }}>{context?.label || "This page"}</span>}
            <button onClick={() => setPageAware((v) => !v)} title="When on, the agent reads this page's data and grounds its answer in it"
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontWeight: 620,
                border: "1px solid " + (pageAware ? "var(--ac)" : "var(--border)"), background: pageAware ? "var(--ac-fill)" : "transparent", color: pageAware ? "var(--ac-text)" : "var(--ts)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: pageAware ? "var(--ac)" : "var(--tm)" }} />
              Page-aware{pageAware ? " · on" : ""}
            </button>
          </div>
        )}

        {/* status tiles */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="card card-pad" style={{ padding: 12 }}><div className="stat"><span className="stat-num" style={{ fontSize: 18 }}>{runs}</span><span className="stat-label">Runs</span></div></div>
          <div className="card card-pad" style={{ padding: 12 }}><div className="stat"><span className="stat-num" style={{ fontSize: 18, color: pending > 0 ? "var(--vl-text)" : undefined }}>{pending}</span><span className="stat-label">Pending</span></div></div>
        </div>

        {/* mode toggle — Chat vs your agentic Workflows */}
        <div style={{ padding: "10px 18px 0", display: "flex", gap: 6 }}>
          {(["chat", "workflows"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "6px 10px", fontSize: 12.5, fontWeight: 620, cursor: "pointer", borderRadius: 8,
              border: "1px solid " + (mode === m ? "var(--ac)" : "var(--border)"),
              background: mode === m ? "var(--ac-fill)" : "transparent", color: mode === m ? "var(--ac-text)" : "var(--ts)",
            }}>{m === "chat" ? "Chat" : `Workflows${workflows.length ? ` · ${workflows.length}` : ""}`}</button>
          ))}
        </div>

        {mode === "chat" ? (
          <>
            {/* chat */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
              {messages.length === 0 && (
                <div className="t-sub t-muted" style={{ textAlign: "center", padding: "24px 0" }}>
                  Chat with {exec.name.split(" ").slice(-1)}, or get a daily briefing.
                </div>
              )}
              <div className="stack-3">
                {messages.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "85%", padding: "9px 12px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.55,
                      ...(m.role === "user" ? { whiteSpace: "pre-wrap" as const } : {}),
                      background: m.role === "user" ? "var(--tp)" : "var(--fill)",
                      color: m.role === "user" ? "#fff" : "var(--tp)",
                      borderBottomRightRadius: m.role === "user" ? 4 : 12,
                      borderBottomLeftRadius: m.role === "user" ? 12 : 4,
                    }}>{m.role === "user" ? m.content : <Markdown text={m.content} />}</div>
                  </div>
                ))}
                {/* live reply — real reasoning trace while it works, then the answer types out */}
                {(busy || reply.typing) && (
                  <div ref={liveRef} style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ maxWidth: "92%", padding: "10px 12px", borderRadius: 12, borderBottomLeftRadius: 4, background: "var(--fill)", color: "var(--tp)", fontSize: 13.5 }}>
                      <LiveReply officer={exec.name.split(" ").slice(-1)[0]} thinking={reply.thinking} activity={reply.activity} display={reply.display} typing={reply.typing} busy={busy} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* error + actions + input */}
            <div style={{ padding: "12px 18px 16px", borderTop: "1px solid var(--border)" }}>
              {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}
              <div className="row gap-2" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send("Give me a daily briefing: what needs my attention and the 2–3 most important next steps.")}>Daily briefing</button>
              </div>
              <div style={{ position: "relative" }}>
                {/* "/" menu — summon a child skill or steer a connector for this turn. */}
                {slashQuery !== null && (childSkills.length > 0 || connectors.length > 0) && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-md)", overflow: "hidden", zIndex: 5, maxHeight: 300, overflowY: "auto" }}>
                    {childSkills.length > 0 && (
                      <>
                        <div className="t-label" style={{ color: "var(--tm)", padding: "8px 12px 4px" }}>Skills — summon for this turn</div>
                        {slashSkills.length === 0
                          ? <div className="t-sub t-muted" style={{ fontSize: 12, padding: "0 12px 8px" }}>No skill matches “{slashQuery}”.</div>
                          : slashSkills.map((s) => (
                            <button key={s.id} onClick={() => { setSteerSkill({ id: s.id, name: s.name }); setInput(""); }}
                              style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--fill)")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                              <span style={{ color: "var(--vl)", fontWeight: 700 }}>/</span><span style={{ flex: 1 }}>{s.name}</span>
                              {suggests(s) && <span className="chip chip-accent" style={{ fontSize: 10.5 }}>suggested here</span>}
                            </button>
                          ))}
                      </>
                    )}
                    {connectors.length > 0 && (
                      <>
                        <div className="t-label" style={{ color: "var(--tm)", padding: "8px 12px 4px", borderTop: childSkills.length ? "1px solid var(--border)" : undefined }}>Connectors — steer this turn</div>
                        {slashMatches.length === 0
                          ? <div className="t-sub t-muted" style={{ fontSize: 12, padding: "0 12px 10px" }}>No connector matches “{slashQuery}”.</div>
                          : slashMatches.map((c) => (
                            <button key={c.id} onClick={() => { setSteer(c.label); setInput(""); }}
                              style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13 }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--fill)")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                              <span style={{ color: "var(--ac)", fontWeight: 700 }}>/</span> {c.label}
                            </button>
                          ))}
                      </>
                    )}
                  </div>
                )}
                {(steerSkill || steer) && (
                  <div className="row gap-2" style={{ marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {steerSkill && <><span className="chip chip-violet" style={{ fontSize: 11.5 }}>✦ {steerSkill.name}</span><button className="btn btn-secondary btn-sm" onClick={() => setSteerSkill(null)} style={{ padding: "2px 8px" }} title="Remove summoned skill">✕</button></>}
                    {steer && <><span className="chip chip-accent" style={{ fontSize: 11.5 }}>↳ via {steer}</span><button className="btn btn-secondary btn-sm" onClick={() => setSteer(null)} style={{ padding: "2px 8px" }} title="Remove connector steer">✕</button></>}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); if (slashQuery !== null && slashSkills.length) { setSteerSkill({ id: slashSkills[0].id, name: slashSkills[0].name }); setInput(""); return; } if (slashQuery !== null && slashMatches.length) { setSteer(slashMatches[0].label); setInput(""); return; } send(input); }} className="row gap-2">
                  <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={(childSkills.length || connectors.length) ? `Ask ${exec.short}…  (type / for skills${connectors.length ? " & connectors" : ""})` : `Ask ${exec.short}…`} disabled={busy} style={{ flex: 1 }} />
                  <button className="btn btn-sm" type="submit" disabled={busy || !input.trim()}>Send</button>
                </form>
              </div>
            </div>
          </>
        ) : (
          /* workflows — launch a saved agentic task; it runs in a side panel */
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
            <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
              Launch an agentic workflow — a multi-step task that runs its officers in order. Author them in <a href="/agents?tab=workflows" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Agents → Workflows</a>.
            </div>
            {workflows.length === 0 ? (
              <div className="t-sub t-muted" style={{ fontSize: 13 }}>No workflows yet.</div>
            ) : (
              <div className="stack-3">
                {workflows.map((w) => {
                  const n = w.steps?.length ?? 0;
                  return (
                    <div key={w.id} className="card card-pad row-between" style={{ gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="row gap-2" style={{ alignItems: "center" }}><span style={{ fontSize: 14, fontWeight: 620 }}>{w.name}</span><Chip tone="violet">{n} step{n === 1 ? "" : "s"}</Chip></div>
                        {w.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{w.description}</div>}
                      </div>
                      <button className="btn btn-sm" disabled={n === 0} onClick={() => setRunWf({ id: w.id, name: w.name })} style={{ background: "var(--ac)", color: "#fff", flexShrink: 0 }}>▸ Run</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </aside>

      <WorkflowRunDrawer open={!!runWf} onClose={() => setRunWf(null)} workflow={runWf}
        target={context?.record_id && context?.record_type ? { type: context.record_type, id: context.record_id, name: context.record_name } : null} />
    </>
  );
}
