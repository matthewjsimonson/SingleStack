"use client";

// PlayRunDrawer — the right pop-out a play runs in. Three phases in one surface:
//   1. WORK    — the officer runs the play (run-play); we show a live working state.
//   2. OUTPUT  — the structured artifact (headline / sections / recommendations),
//                reviewable HITL (ratify / dismiss / rate).
//   3. ACT     — a follow-up CHAT to refine the output with the officer, and a
//                PUSH to send the output into the product (Initiative / Release /
//                Theme / Campaign / Content). (Digest comes later, with Content.)
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { AgentBadge, Chip, SourceChip } from "@/components/ui";
import { edgeErrorMessage } from "@/lib/edgeError";

type Sec = { title: string; body: string; evidence: string[] };
type Payload = { headline: string; sections: Sec[]; recommendations: string[]; confidence: string };
type Artifact = { id: string; function_key: string; status: string; payload: Payload; run_id: string | null };
type Msg = { role: "user" | "assistant"; content: string };

export type DrawerPlay = { key: string; label: string; officer: string; agentKey: string | null; targetType: string | null };
export type DrawerTarget = { id: string; name: string };

// Where a play's output can be pushed. Each mints a record seeded from the output
// and returns a link. Minimal column sets mirror each module's own create paths.
type Pusher = (sb: ReturnType<typeof createClient>, orgId: string, title: string, body: string) => Promise<string>;
const PUSH_TARGETS: { key: string; label: string; run: Pusher }[] = [
  { key: "initiative", label: "Initiative", run: async (sb, orgId, title, body) => {
    const { data, error } = await sb.from("initiatives").insert({ org_id: orgId, lane: "ship", scope: "product", lifecycle: "plan", stage: "active", priority: "high", title, description: body }).select("id").single();
    if (error) throw error; return `/initiatives/${data!.id}`;
  } },
  { key: "release", label: "Release", run: async (sb, orgId, title, body) => {
    const { error } = await sb.from("releases").insert({ org_id: orgId, name: title, summary: body, stage: "planned" });
    if (error) throw error; return `/roadmap`;
  } },
  { key: "theme", label: "Theme", run: async (sb, orgId, title, body) => {
    const { error } = await sb.from("signal_themes").insert({ org_id: orgId, title, summary: body, category: "product", state: "active", merged_by: "human" });
    if (error) throw error; return `/strategy`;
  } },
  { key: "campaign", label: "Campaign", run: async (sb, orgId, title, body) => {
    const { data, error } = await sb.from("campaigns").insert({ org_id: orgId, name: title, objective: body, status: "planning" }).select("id").single();
    if (error) throw error; return `/campaigns/${data!.id}`;
  } },
  { key: "content", label: "Content", run: async (sb, orgId, title, body) => {
    const { error } = await sb.from("initiative_workstreams").insert({ org_id: orgId, area: "gtm", title, content_type: "blog", lifecycle_stage: "launch", body, details: null });
    if (error) throw error; return `/content`;
  } },
];

// Phases shown while a play runs, so the wait reads as progress, not a dead spinner.
const RUN_PHASES = ["Reading the context", "Weighing the evidence", "Forming the take", "Structuring the output"];
const PulseDots = () => <span style={{ marginLeft: 1 }}><span className="pulse-dot">.</span><span className="pulse-dot">.</span><span className="pulse-dot">.</span></span>;

// The artifact as plain text — used to seed the follow-up chat and the push body.
function artifactText(p: Payload): string {
  const secs = (p.sections ?? []).map((s) => `${s.title}\n${s.body}`).join("\n\n");
  const recs = (p.recommendations ?? []).length ? `\n\nRecommendations:\n${p.recommendations.map((r) => `• ${r}`).join("\n")}` : "";
  return `${p.headline}\n\n${secs}${recs}`.trim();
}

export default function PlayRunDrawer({ open, onClose, play, target }: {
  open: boolean; onClose: () => void; play: DrawerPlay | null; target: DrawerTarget | null;
}) {
  const supabase = createClient();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [running, setRunning] = useState(false);
  const [rated, setRated] = useState<"helpful" | "not_helpful" | null>(null);
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushed, setPushed] = useState<{ label: string; href: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(0); // cycling progress step while running
  const scrollRef = useRef<HTMLDivElement>(null);

  // While a play runs, cycle through the real phases so the wait shows progress.
  useEffect(() => {
    if (!running) { setPhase(0); return; }
    const id = setInterval(() => setPhase((p) => (p + 1) % RUN_PHASES.length), 1500);
    return () => clearInterval(id);
  }, [running]);

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token; }

  const run = useCallback(async () => {
    if (!play || !target) return;
    setRunning(true); setError(null);
    try {
      const t = await token();
      const { data, error } = await supabase.functions.invoke("run-play", {
        body: { function_key: play.key, target_type: play.targetType ?? undefined, target_id: target.id, target_name: target.name },
        headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      });
      if (error) { setError(await edgeErrorMessage(error, "run-play")); return; }
      if (data?.error) throw new Error(data.error);
      setArtifact(data.artifact); setRated(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Run failed."); }
    finally { setRunning(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, target]);

  // On open: load the latest artifact for this play+target; auto-run if none.
  useEffect(() => {
    if (!open || !play || !target) return;
    setArtifact(null); setChat([]); setInput(""); setPushOpen(false); setPushed(null); setError(null); setRated(null);
    (async () => {
      const { data } = await supabase.from("agent_artifacts").select("id, function_key, status, payload, run_id").eq("target_id", target.id).eq("function_key", play.key).order("created_at", { ascending: false }).limit(1);
      if (data && data.length) setArtifact(data[0] as Artifact);
      else run();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, play?.key, target?.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [chat, chatBusy]);

  async function setStatus(status: "ratified" | "dismissed") {
    if (!artifact) return;
    setArtifact({ ...artifact, status });
    await supabase.from("agent_artifacts").update({ status, ratified_at: status === "ratified" ? new Date().toISOString() : null }).eq("id", artifact.id);
  }
  async function rate(r: "helpful" | "not_helpful") {
    if (!artifact?.run_id) return;
    setRated(r);
    await supabase.from("agent_runs").update({ rating: r, rated_at: new Date().toISOString() }).eq("id", artifact.run_id);
  }

  async function send() {
    if (!input.trim() || !play?.agentKey || !artifact || !target) return;
    const userText = input.trim();
    const thread: Msg[] = [...chat, { role: "user", content: userText }];
    // Add an empty assistant bubble to stream tokens into.
    setChat([...thread, { role: "assistant", content: "" }]); setInput(""); setChatBusy(true); setError(null);
    try {
      const t = await token();
      // Ground the conversation in the play's output by folding it into the first
      // user turn (keeps a valid user-first message order).
      const payload = thread.map((m, i) => i === 0 && m.role === "user"
        ? { ...m, content: `You earlier produced this analysis of "${target.name}":\n\n${artifactText(artifact.payload)}\n\nUse it as the basis for this conversation.\n\nMy follow-up: ${m.content}` }
        : m);
      // Stream the reply (text/plain deltas) so it types out live. functions.invoke
      // buffers the whole body, so call the function URL directly and read the stream.
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: JSON.stringify({ agent_key: play.agentKey, messages: payload, stream: true }),
      });
      if (!resp.ok || !resp.body) throw new Error((await resp.text().catch(() => "")) || `Chat failed (${resp.status}).`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setChat((prev) => { const next = [...prev]; next[next.length - 1] = { role: "assistant", content: acc }; return next; });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
      setChat((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.role === "assistant" && m.content === ""))); // drop empty bubble
    } finally { setChatBusy(false); }
  }

  async function pushTo(t: { key: string; label: string; run: Pusher }) {
    if (!artifact) return;
    setPushing(t.key); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Couldn't resolve your organization.");
      const href = await t.run(supabase, orgId, artifact.payload.headline, artifactText(artifact.payload));
      setPushed({ label: t.label, href }); setPushOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : `Couldn't push to ${t.label}.`); }
    finally { setPushing(null); }
  }

  if (!open || !play || !target) return null;
  const a = artifact;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 560, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 8 }}>
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
            <AgentBadge name={play.officer} accent="var(--ac)" />
            <span style={{ fontSize: 15, fontWeight: 660 }}>{play.label}</span>
            {a && <Chip tone={a.status === "ratified" ? "green" : a.status === "dismissed" ? "default" : "amber"}>{a.status}</Chip>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="t-sub t-muted" style={{ fontSize: 12, padding: "8px 20px 0" }}>Running against <strong>{target.name}</strong></div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

          {/* 1 — WORK: stepped progress so the wait reads as work in motion */}
          {running && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <div className="t-sub" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{play.officer} is working on {target.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {RUN_PHASES.map((label, i) => {
                  const state = i < phase ? "done" : i === phase ? "active" : "todo";
                  return (
                    <div key={label} className="row gap-2" style={{ alignItems: "center", opacity: state === "todo" ? 0.4 : 1, transition: "opacity .3s" }}>
                      <span style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700,
                        background: state === "done" ? "var(--gn)" : state === "active" ? "var(--ac)" : "var(--fill-2)", color: state === "todo" ? "var(--tm)" : "#fff", border: state === "todo" ? "1px solid var(--border)" : "none" }}>
                        {state === "done" ? "✓" : ""}
                      </span>
                      <span className="t-sub" style={{ fontSize: 12.5, fontWeight: state === "active" ? 600 : 400 }}>{label}{state === "active" ? <PulseDots /> : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2 — OUTPUT */}
          {a && (
            <div style={{ marginBottom: 16 }}>
              {/* headline */}
              <div className="t-body reveal-up" style={{ fontSize: 15, fontWeight: 680, lineHeight: 1.35, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>{a.payload.headline}</div>

              {/* sections — each clearly separated, revealed in sequence */}
              {(a.payload.sections ?? []).map((s, i) => (
                <div key={i} className="reveal-up" style={{ marginBottom: 16, animationDelay: `${(i + 1) * 90}ms` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ac)", marginBottom: 5 }}>{s.title}</div>
                  <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{s.body}</div>
                  {(s.evidence ?? []).length > 0 && (
                    <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 7, alignItems: "center" }}>
                      <span className="t-label" style={{ color: "var(--tm)", fontSize: 9.5 }}>Evidence</span>
                      {s.evidence.map((ev, j) => <SourceChip key={j} icon="◦" label={ev} />)}
                    </div>
                  )}
                </div>
              ))}

              {/* recommendations — set apart */}
              {(a.payload.recommendations ?? []).length > 0 && (
                <div className="reveal-up" style={{ marginBottom: 12, padding: "12px 14px", background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, animationDelay: `${((a.payload.sections ?? []).length + 1) * 90}ms` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--tm)", marginBottom: 6 }}>Recommendations</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{a.payload.recommendations.map((r, i) => <li key={i} className="t-body" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 3 }}>{r}</li>)}</ul>
                </div>
              )}
              {a.payload.confidence && <div className="t-mono-xs" style={{ color: "var(--tm)" }}>Confidence: {a.payload.confidence}</div>}

              {/* review */}
              <div className="row-between" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                <div className="row gap-2">
                  <button className="btn btn-sm" disabled={running} onClick={run} style={{ background: "var(--ac)", color: "#fff" }}>Re-run</button>
                  {a.status !== "ratified" && <button className="btn btn-success btn-sm" onClick={() => setStatus("ratified")}>Ratify</button>}
                  {a.status !== "dismissed" && <button className="btn btn-secondary btn-sm" onClick={() => setStatus("dismissed")} style={{ color: "var(--rd-text)" }}>Dismiss</button>}
                </div>
                {a.run_id && (rated
                  ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{rated === "helpful" ? "Rated helpful" : "Rated not helpful"}</span>
                  : <div className="row gap-2"><button className="btn btn-secondary btn-sm" onClick={() => rate("helpful")}>Helpful</button><button className="btn btn-secondary btn-sm" onClick={() => rate("not_helpful")}>Not helpful</button></div>)}
              </div>

              {/* 3 — ACT: push */}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12 }}>
                {pushed ? (
                  <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Chip tone="green">Pushed to {pushed.label}</Chip>
                    <a className="btn btn-secondary btn-sm" href={pushed.href}>Open →</a>
                    <button className="btn btn-secondary btn-sm" onClick={() => setPushed(null)}>Push elsewhere</button>
                  </div>
                ) : pushOpen ? (
                  <div>
                    <div className="t-label" style={{ marginBottom: 6 }}>Push this output to…</div>
                    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                      {PUSH_TARGETS.map((t) => (
                        <button key={t.key} className="btn btn-sm" disabled={!!pushing} onClick={() => pushTo(t)}>{pushing === t.key ? "Pushing…" : t.label}</button>
                      ))}
                      <button className="btn btn-secondary btn-sm" onClick={() => setPushOpen(false)}>Cancel</button>
                    </div>
                    <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 6 }}>Send as digest — coming with the Content module.</div>
                  </div>
                ) : (
                  <button className="btn btn-sm" onClick={() => setPushOpen(true)}>Push to…</button>
                )}
              </div>
            </div>
          )}

          {/* 3 — ACT: follow-up chat */}
          {a && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div className="t-label" style={{ marginBottom: 8 }}>Follow up with {play.officer}</div>
              {!play.agentKey && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No officer attached to this play — attach one in Agents → Plays to chat.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {chat.map((m, i) => {
                  const streamingHere = m.role === "assistant" && i === chat.length - 1 && chatBusy;
                  return (
                    <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%", background: m.role === "user" ? "var(--ac-fill)" : "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 11px" }}>
                      {streamingHere && m.content === "" ? (
                        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{play.officer} is thinking<PulseDots /></div>
                      ) : (
                        <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}{streamingHere && <span className="pulse-dot" style={{ fontWeight: 700 }}>▍</span>}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* composer */}
        {a && play.agentKey && (
          <div className="row gap-2" style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
            <input className="input" value={input} placeholder={`Ask ${play.officer} to refine, expand, or reconsider…`} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !chatBusy) send(); }} style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={chatBusy || !input.trim()} onClick={send} style={{ background: "var(--ac)", color: "#fff" }}>Send</button>
          </div>
        )}
      </aside>
    </>
  );
}
