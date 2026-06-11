"use client";

// Refine with AI — the HITL chat on an existing record. The agent has read the
// whole record plus what's moving in the marketplace (themes, external signals)
// and inside the company (internal signals), and proposes field-level
// refinements in conversation. Each suggestion is an EDITABLE proposition: the
// human refines the text, then
//   • Apply now  — writes through the proposals trail and ratifies in one move
//     (your edit IS the ratification; the audit survives), or
//   • Queue      — lands it as a pending proposal for the review drawer.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

type Target = { kind: "product" | "gtm"; id: string };
type Suggestion = { field_key: string; label: string; section: string; proposed_value: string; rationale: string; state?: "applied" | "queued" };
type Turn = { role: "q" | "a"; text: string; suggestions?: Suggestion[] };

export default function RecordRefine({ target, recordName, onApplied, onClose }: { target: Target; recordName?: string; onApplied?: () => void; onClose: () => void }) {
  const supabase = createClient();
  const [chat, setChat] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<{ id: string; field_key: string; value: string | null }[]>([]);

  useEffect(() => {
    supabase.from("record_fields").select("id, field_key, value").eq(target.kind === "product" ? "product_id" : "gtm_record_id", target.id)
      .then(({ data }) => setFields(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  const invoke = async (transcript: { role: string; text: string }[]) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("refine-record", {
      body: { target, transcript }, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (error) {
      const resp = (error as { context?: Response }).context;
      if (resp && typeof resp.json === "function") {
        const body = await resp.clone().json().catch(() => null) as { error?: string } | null;
        if (body?.error) throw new Error(body.error);
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data as { reply: string; suggestions: Suggestion[] };
  };

  async function turn(history: Turn[]) {
    setBusy(true); setError(null);
    try {
      const data = await invoke(history.map((t) => ({ role: t.role, text: t.text })));
      setChat([...history, { role: "q", text: data.reply, suggestions: (data.suggestions ?? []).map((s) => ({ ...s })) }]);
    } catch (e) { setError(e instanceof Error ? e.message : "The refiner stalled."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (chat.length === 0) void turn([]); /* opening read */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!answer.trim() || busy) return;
    const history = [...chat, { role: "a" as const, text: answer.trim() }];
    setChat(history); setAnswer("");
    await turn(history);
  }

  const editSuggestion = (ti: number, si: number, v: string) =>
    setChat(chat.map((t, i) => i !== ti ? t : { ...t, suggestions: t.suggestions?.map((s, j) => j === si ? { ...s, proposed_value: v } : s) }));

  // The gate: a proposal + its change rows ride the existing trail. "Apply now"
  // ratifies immediately (the human just edited and confirmed it); "Queue"
  // leaves it pending for the review drawer.
  async function persist(ti: number, si: number, mode: "apply" | "queue") {
    const sug = chat[ti]?.suggestions?.[si];
    if (!sug || applying) return;
    setApplying(`${ti}:${si}`); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const existing = fields.find((f) => f.field_key === sug.field_key);
      const { data: prop, error: pErr } = await supabase.from("proposals").insert({
        org_id: orgId,
        [target.kind === "product" ? "product_id" : "gtm_record_id"]: target.id,
        title: `Refine: ${sug.label}`,
        rationale: sug.rationale,
        proposed_by: "Refine chat",
        status: "pending",
      }).select("id").single();
      if (pErr || !prop) throw pErr ?? new Error("Could not create the proposal.");
      const { error: cErr } = await supabase.from("proposal_changes").insert({
        org_id: orgId, proposal_id: prop.id,
        change_kind: existing ? "update_field" : "add_field",
        record_field_id: existing?.id ?? null,
        old_value: existing?.value ?? null,
        field_key: existing ? null : sug.field_key,
        label: existing ? null : sug.label,
        proposed_value: sug.proposed_value,
      });
      if (cErr) { await supabase.from("proposals").delete().eq("id", prop.id); throw cErr; }
      if (mode === "apply") {
        const { error: aErr } = await supabase.rpc("accept_proposal", { p_proposal: prop.id, p_ratifier: "refine-chat" });
        if (aErr) throw aErr;
        onApplied?.();
      }
      setChat(chat.map((t, i) => i !== ti ? t : { ...t, suggestions: t.suggestions?.map((s, j) => j === si ? { ...s, state: mode === "apply" ? "applied" : "queued" } : s) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the refinement."); }
    finally { setApplying(null); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 560, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
          <div>
            <span className="t-h2" style={{ fontSize: 15 }}>✦ Refine {recordName ?? "this record"}</span>
            <div className="t-mono-xs t-muted" style={{ marginTop: 2 }}>Grounded in your marketplace + company signals · every change rides the proposals trail</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          <Banner>{error}</Banner>
          {chat.map((m, ti) => (
            <div key={ti}>
              <div className="card card-pad" style={{ background: m.role === "q" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: m.role === "a" ? 32 : 0, marginRight: m.role === "q" ? 32 : 0 }}>
                <div className="t-mono-xs t-muted" style={{ marginBottom: 3 }}>{m.role === "q" ? "✦ AI" : "You"}</div>
                {m.role === "q" ? <Markdown className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }} text={m.text} /> : <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.text}</div>}
              </div>
              {/* The propositions — editable before anything persists. */}
              {m.suggestions?.map((s, si) => (
                <div key={si} className="card card-pad" style={{ marginTop: 8, marginRight: 32, borderLeft: `3px solid ${s.state === "applied" ? "var(--gn-text, #15803d)" : s.state === "queued" ? "var(--am-text)" : "var(--ac)"}` }}>
                  <div className="row-between" style={{ marginBottom: 4, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 640 }}>{s.section} · {s.label}</span>
                    {s.state && <span className="t-mono-xs" style={{ color: s.state === "applied" ? "var(--gn-text, #15803d)" : "var(--am-text)", fontWeight: 700 }}>{s.state === "applied" ? "✓ applied" : "→ queued for review"}</span>}
                  </div>
                  <div className="t-mono-xs t-muted" style={{ marginBottom: 6 }}>{s.rationale}</div>
                  {s.state ? (
                    <div className="t-sub" style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{s.proposed_value}</div>
                  ) : (
                    <>
                      <textarea className="textarea" rows={Math.max(2, Math.min(8, Math.ceil(s.proposed_value.length / 80)))} value={s.proposed_value}
                        onChange={(e) => editSuggestion(ti, si, e.target.value)} />
                      <div className="row gap-2" style={{ marginTop: 6 }}>
                        <button className="btn btn-sm" disabled={!!applying || !s.proposed_value.trim()} onClick={() => persist(ti, si, "apply")}
                          title="Your edit is the ratification — writes the field and keeps the full proposal trail">{applying === `${ti}:${si}` ? "Applying…" : "Apply now"}</button>
                        <button className="btn btn-secondary btn-sm" disabled={!!applying} onClick={() => persist(ti, si, "queue")}
                          title="Land it as a pending proposal in the review drawer">Queue for review</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          {busy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{chat.length === 0 ? "Reading the record + your signals…" : "Thinking…"}</div>}
        </div>
        <form onSubmit={send} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="stack-2">
          <textarea className="textarea" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)}
            placeholder="Steer it — ask about a field, push back, or say what changed in your world."
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e); }} />
          <div className="row gap-2">
            <button className="btn btn-sm" type="submit" disabled={busy || !answer.trim()}>{busy ? "…" : "Send"}</button>
          </div>
        </form>
      </aside>
    </>
  );
}
