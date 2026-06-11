"use client";

// Purchase-day record setup — materials in, interview to fill the gaps, then
// the agent's DRAFT sits in editable fields the human refines before anything
// is written. True HITL: the proposition is visible, touchable, and yours.
//
// Three steps:
//   1. Materials — paste text, add public URLs, drop PDFs. Each becomes a
//      removable card; everything is injection-screened server-side.
//   2. Drill-down — the side pop-out interview (same pattern the user approved
//      in competitive setup): one question at a time, readiness meter, ✎ Edit
//      on any answer to go back. It never asks what the materials answer.
//   3. Refine & create — the drafted product + GTM records, field by field, in
//      roomy editors pre-filled with the agent's proposition. Edit, clear, or
//      fill anything; only then does Create write the rows (as you, RLS).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner } from "@/components/ui";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";
import { PRODUCT_TEMPLATE, GTM_TEMPLATE } from "@/lib/templates";

type Material = { label: string; text: string; kind: "paste" | "url" | "pdf" };
type ChatMsg = { role: "q" | "a"; text: string };
type DraftField = { record: "product" | "gtm"; key: string; label: string; section: string; value: string };

// The drafting surface: every canonical field except Battlecard (derived later
// from ratified competitive facts, not entered on day one).
const TEMPLATE_FIELDS: DraftField[] = [
  ...PRODUCT_TEMPLATE.flatMap((s) => s.fields.map((f) => ({ record: "product" as const, key: f.key, label: f.label, section: s.section, value: "" }))),
  ...GTM_TEMPLATE.filter((s) => s.section !== "Battlecard").flatMap((s) => s.fields.map((f) => ({ record: "gtm" as const, key: f.key, label: f.label, section: s.section, value: "" }))),
];

export default function RecordSetup({ onDone, mode = "both" }: { onDone: (productId?: string) => void; mode?: "both" | "gtm" }) {
  const supabase = createClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const draftRun = useAgentRun("draftRecords");

  // step 1 — materials
  const [materials, setMaterials] = useState<Material[]>([]);
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState<string | null>(null);

  // step 2 — interview (side pop-out, same pattern as competitive)
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatWhy, setChatWhy] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatDone, setChatDone] = useState(false);
  const [ready, setReady] = useState<number | null>(null);
  const [readyDelta, setReadyDelta] = useState<number | null>(null);
  const [gaps, setGaps] = useState("");

  // step 3 — the draft, refined by hand
  const allFields = mode === "gtm" ? TEMPLATE_FIELDS.filter((f) => f.record === "gtm") : TEMPLATE_FIELDS;
  const [fields, setFields] = useState<DraftField[]>(allFields);
  // gtm mode: the new GTM record needs its parent product.
  const [parentProducts, setParentProducts] = useState<{ id: string; name: string }[]>([]);
  const [parentId, setParentId] = useState("");
  useEffect(() => {
    if (mode !== "gtm") return;
    supabase.from("product_records").select("id, name").order("created_at").then(({ data }) => {
      setParentProducts(data ?? []); setParentId((cur) => cur || data?.[0]?.id || "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const [prodName, setProdName] = useState("");
  const [gtmName, setGtmName] = useState("");
  const [creating, setCreating] = useState(false);

  const invoke = async (body: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("setup-records", {
      body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (error) {
      const resp = (error as { context?: Response }).context;
      if (resp && typeof resp.json === "function") {
        const body = await resp.clone().json().catch(() => null) as { error?: string } | null;
        if (body?.error) throw new Error(body.error);
        if (resp.status === 546 || resp.status === 504) throw new Error("That ran past the server time limit — try again; it usually completes on a retry.");
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };
  const templatePayload = allFields.map((f) => ({ record: f.record, key: f.key, label: f.label, section: f.section }));

  // ---- step 1: materials ------------------------------------------------------
  function addPaste() {
    if (!paste.trim()) return;
    setMaterials([...materials, { label: `Pasted notes ${materials.filter((m) => m.kind === "paste").length + 1}`, text: paste.trim(), kind: "paste" }]);
    setPaste("");
  }
  async function addUrl() {
    if (!url.trim()) return;
    setFetching("url"); setError(null);
    try {
      const data = await invoke({ step: "material", url: url.trim() });
      setMaterials((m) => [...m, { label: data.label, text: data.text, kind: "url" }]);
      setUrl("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not fetch that page."); }
    finally { setFetching(null); }
  }
  async function addPdf(file: File) {
    setFetching("pdf"); setError(null);
    try {
      if (file.size > 4_000_000) throw new Error("PDF too large — keep it under ~4 MB, or paste the relevant sections.");
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1] ?? "");
        r.onerror = () => rej(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const data = await invoke({ step: "material", pdf_base64: b64, label: file.name });
      setMaterials((m) => [...m, { label: data.label, text: data.text, kind: "pdf" }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read the PDF."); }
    finally { setFetching(null); }
  }

  // ---- step 2: interview ------------------------------------------------------
  async function nextQuestion(history: ChatMsg[]) {
    setChatBusy(true); setError(null);
    try {
      const data = await invoke({ step: "interview", materials, transcript: history, template: templatePayload });
      const r = Math.min(100, Math.max(0, Math.round(Number(data.readiness) || 0)));
      setReady((prev) => { setReadyDelta(prev !== null ? r - prev : null); return r; });
      setGaps((data.gaps as string) || "");
      if (data.done || !data.question) { setChatDone(true); setChatWhy(null); }
      else { setChat([...history, { role: "q", text: data.question }]); setChatWhy(data.why || null); }
    } catch (e) { setError(e instanceof Error ? e.message : "The interviewer stalled."); }
    finally { setChatBusy(false); }
  }
  function openChat() {
    setChatOpen(true); setStep(2);
    if (chat.length === 0 && !chatBusy) void nextQuestion([]);
  }
  async function sendAnswer(e: React.FormEvent) {
    e.preventDefault(); if (!answer.trim() || chatBusy) return;
    const history = [...chat, { role: "a" as const, text: answer.trim() }];
    setChat(history); setAnswer("");
    await nextQuestion(history);
  }
  function editAnswer(i: number) {
    if (chatBusy) return;
    const prev = chat[i];
    if (prev?.role !== "a") return;
    setAnswer(prev.text);
    setChat(chat.slice(0, i));
    setChatDone(false); setReadyDelta(null); setChatWhy(null);
  }

  // ---- step 3: draft → refine → create ----------------------------------------
  async function draft() {
    setError(null); setChatOpen(false);
    try {
      await draftRun.go(async () => {
        const data = await invoke({ step: "draft", materials, transcript: chat, template: templatePayload });
        const byKey: Record<string, string> = {};
        for (const f of (data.fields ?? []) as { record: string; key: string; value: string }[]) byKey[`${f.record}:${f.key}`] = f.value ?? "";
        setFields(allFields.map((f) => ({ ...f, value: byKey[`${f.record}:${f.key}`] ?? "" })));
        setProdName((data.product_name as string) || "");
        setGtmName((data.gtm_name as string) || "");
        setStep(3);
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft the records."); }
  }
  const setField = (i: number, v: string) => setFields(fields.map((f, j) => (j === i ? { ...f, value: v } : f)));

  async function create() {
    if (mode === "gtm") {
      if (!parentId) { setError("Pick the parent product."); return; }
      setCreating(true); setError(null);
      try {
        const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
        const { data: g, error: gErr } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: parentId, name: gtmName.trim() || "Core GTM" }).select("id").single();
        if (gErr || !g) throw gErr ?? new Error("Could not create the GTM record.");
        const gf = fields.filter((f) => f.record === "gtm" && f.value.trim());
        if (gf.length) {
          const { error } = await supabase.from("record_fields").insert(gf.map((f, i) => ({ org_id: orgId, gtm_record_id: g.id, field_key: f.key, label: f.label, value: f.value.trim(), section: f.section, position: i })));
          if (error) throw error;
        }
        onDone(parentId);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not create the record."); }
      finally { setCreating(false); }
      return;
    }
    if (!prodName.trim()) { setError("Name the product."); return; }
    setCreating(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { data: p, error: pErr } = await supabase.from("product_records").insert({ org_id: orgId, name: prodName.trim() }).select("id").single();
      if (pErr || !p) throw pErr ?? new Error("Could not create the product record.");
      const pf = fields.filter((f) => f.record === "product" && f.value.trim());
      if (pf.length) {
        const { error } = await supabase.from("record_fields").insert(pf.map((f, i) => ({ org_id: orgId, product_id: p.id, field_key: f.key, label: f.label, value: f.value.trim(), section: f.section, position: i })));
        if (error) throw error;
      }
      const { data: g, error: gErr } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: p.id, name: gtmName.trim() || `${prodName.trim()} — Core GTM` }).select("id").single();
      if (gErr || !g) throw gErr ?? new Error("Could not create the GTM record.");
      const gf = fields.filter((f) => f.record === "gtm" && f.value.trim());
      if (gf.length) {
        const { error } = await supabase.from("record_fields").insert(gf.map((f, i) => ({ org_id: orgId, gtm_record_id: g.id, field_key: f.key, label: f.label, value: f.value.trim(), section: f.section, position: i })));
        if (error) throw error;
      }
      onDone(p.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the records."); }
    finally { setCreating(false); }
  }

  const filled = fields.filter((f) => f.value.trim()).length;
  const sections = (record: "product" | "gtm") => [...new Set(fields.filter((f) => f.record === record).map((f) => f.section))];

  return (
    <div className="card card-pad" style={{ borderTop: "3px solid var(--ac)" }}>
      <div className="row-between" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 680 }}>Set up your records</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Your materials + a short interview → drafted product &amp; GTM records you refine before anything is written.</div>
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          {[1, 2, 3].map((n) => (
            <span key={n} className="t-mono-xs" style={{ width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: n === step ? "var(--ac)" : n < step ? "var(--gn-bg, #CDEBD6)" : "var(--fill)", color: n === step ? "#fff" : "var(--ts)", fontWeight: 700 }}>{n < step ? "✓" : n}</span>
          ))}
          <span className="t-label" style={{ color: "var(--tm)", marginLeft: 4 }}>{["", "Materials", "Drill-down", "Refine & create"][step]}</span>
        </div>
      </div>
      <Banner>{error}</Banner>

      {step === 1 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Bring what already exists — a deck&rsquo;s notes, the website, a positioning doc. The interview only asks what these don&rsquo;t answer.</div>
          {materials.length > 0 && (
            <div className="stack-2">
              {materials.map((m, i) => (
                <div key={i} className="card card-pad row-between" style={{ background: "var(--panel-2)", padding: "8px 12px" }}>
                  <span className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                    <Chip tone={m.kind === "url" ? "violet" : m.kind === "pdf" ? "amber" : "default"}>{m.kind}</Chip>
                    <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                    <span className="t-mono-xs t-muted">{(m.text.length / 1000).toFixed(1)}k chars</span>
                  </span>
                  <button className="t-muted" onClick={() => setMaterials(materials.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}
          <label className="field"><span className="t-label">Paste anything — notes, copy, a doc&rsquo;s contents</span>
            <textarea className="textarea" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste freely — the box grows with you, and you can add as many of these as you like." /></label>
          {paste.trim() && <button className="btn btn-secondary btn-sm" onClick={addPaste} style={{ alignSelf: "flex-start" }}>+ Add the pasted text</button>}
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yoursite.com — or a docs/pricing page" style={{ flex: 1, minWidth: 240 }} />
            <button className="btn btn-secondary btn-sm" disabled={!url.trim() || fetching === "url"} onClick={addUrl}>{fetching === "url" ? "Fetching…" : "Fetch page"}</button>
            <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
              {fetching === "pdf" ? "Reading PDF…" : "+ PDF"}
              <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={fetching === "pdf"}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPdf(f); e.target.value = ""; }} />
            </label>
          </div>
          <div className="row gap-2">
            <button className="btn btn-sm" onClick={openChat}>{materials.length ? "✦ Continue — drill down" : "✦ Start with the interview only"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => onDone()}>Cancel</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
            {chatDone ? "Interview complete — draft the records when ready." : "The drill-down is open in the side panel. It asks only what your materials don't answer."}
          </div>
          {draftRun.active ? (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}><AgentProgress run={draftRun} /></div>
          ) : (
            <div className="row gap-2">
              {!chatOpen && <button className="btn btn-secondary btn-sm" onClick={() => setChatOpen(true)}>✦ Re-open the drill-down</button>}
              <button className="btn btn-sm" disabled={chatBusy} onClick={draft}
                title={chatDone || (ready ?? 0) >= 60 ? "Draft both records from everything gathered" : "You can draft now, but more answers make a fuller draft"}>
                ✦ Draft the records{ready !== null ? ` (${chatDone ? 100 : ready}% ready)` : ""}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setStep(1)}>‹ Back to materials</button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="stack-3">
          <div className="card card-pad" style={{ background: "var(--panel-2)", fontSize: 12.5 }}>
            The agent&rsquo;s draft, in your hands — <b>{filled}</b> of {fields.length} fields grounded in what you gave it. Edit anything, clear what&rsquo;s wrong, fill what it left honestly empty. Nothing is written until you create.
          </div>
          {mode === "gtm" && (
            <label className="field" style={{ maxWidth: 360 }}><span className="t-label">Parent product</span>
              <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                {parentProducts.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
              </select></label>
          )}
          {([["product", "Product record", prodName, setProdName], ["gtm", "GTM record", gtmName, setGtmName]] as const).filter(([rec]) => mode !== "gtm" || rec === "gtm").map(([rec, title, nameVal, setName]) => (
            <div key={rec} className="card card-pad">
              <div className="row gap-2" style={{ alignItems: "center", marginBottom: 10 }}>
                <span className="t-label" style={{ color: "var(--tm)" }}>{title}</span>
                <input className="input" value={nameVal} onChange={(e) => setName(e.target.value)} placeholder={rec === "product" ? "Product name" : "GTM record name"} style={{ maxWidth: 320, fontWeight: 640 }} />
              </div>
              {sections(rec).map((sec) => (
                <div key={sec} style={{ marginBottom: 12 }}>
                  <div className="t-mono-xs t-muted" style={{ marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{sec}</div>
                  <div className="stack-2">
                    {fields.map((f, i) => f.record === rec && f.section === sec && (
                      <label key={f.key} className="field">
                        <span className="t-label">{f.label}{!f.value.trim() && <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> — the materials didn&rsquo;t speak to this</span>}</span>
                        <textarea className="textarea" rows={Math.max(2, Math.min(6, Math.ceil(f.value.length / 90)))} value={f.value} onChange={(e) => setField(i, e.target.value)} placeholder="Yours to fill — or leave empty for now." />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={creating} onClick={create}>{creating ? "Creating…" : mode === "gtm" ? "Create the GTM record" : "Create both records"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStep(2)}>‹ Back</button>
          </div>
        </div>
      )}

      {/* The drill-down side pop-out — readiness meter, ✎ Edit any answer. */}
      {chatOpen && (
        <>
          <div onClick={() => setChatOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
              <span className="t-h2" style={{ fontSize: 15 }}>Drill down — filling what the materials don&rsquo;t say</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setChatOpen(false)}>Close</button>
            </div>
            {ready !== null && (
              <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
                <div className="row-between" style={{ marginBottom: 5, alignItems: "baseline" }}>
                  <span className="t-label" style={{ color: "var(--tm)" }}>Draft readiness</span>
                  <span className="row gap-2" style={{ alignItems: "baseline" }}>
                    {readyDelta !== null && readyDelta > 0 && <span className="t-mono-xs" style={{ color: "var(--gn-text, #15803d)", fontWeight: 700 }}>+{readyDelta}</span>}
                    <span className="t-mono-xs" style={{ fontWeight: 700, color: (chatDone || ready >= 80) ? "var(--gn-text, #15803d)" : ready >= 55 ? "var(--am-text)" : "var(--tm)" }}>{chatDone ? 100 : ready}%</span>
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--fill)", overflow: "hidden" }}>
                  <div style={{ width: `${chatDone ? 100 : ready}%`, height: "100%", borderRadius: 3, background: (chatDone || ready >= 80) ? "var(--gn-text, #15803d)" : ready >= 55 ? "var(--am-text, #D97706)" : "var(--ac)", transition: "width 0.4s ease" }} />
                </div>
                <div className="t-mono-xs t-muted" style={{ marginTop: 5 }}>
                  {chatDone ? "Enough for a strong draft." : ready >= 80 ? "Good enough to draft — answer more only for a fuller record." : gaps ? `Still thin: ${gaps}` : "Each answer fills more of the records."}
                </div>
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
              {chat.map((m, i) => (
                <div key={i} className="card card-pad" style={{ background: m.role === "q" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: m.role === "a" ? 32 : 0, marginRight: m.role === "q" ? 32 : 0 }}>
                  <div className="row-between" style={{ marginBottom: 3, alignItems: "baseline" }}>
                    <span className="t-mono-xs t-muted">{m.role === "q" ? "✦ AI" : "You"}</span>
                    {m.role === "a" && !chatBusy && (
                      <button className="t-mono-xs" onClick={() => editAnswer(i)} title="Edit this answer — the questions and answers after it are discarded and the interview continues from here"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ac-text, var(--ac))", fontWeight: 600, padding: 0 }}>✎ Edit</button>
                    )}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.text}</div>
                </div>
              ))}
              {chatWhy && !chatDone && <div className="t-mono-xs t-muted">Why this question: {chatWhy}</div>}
              {chatBusy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Thinking…</div>}
              {chatDone && !chatBusy && (
                <div className="card card-pad" style={{ borderLeft: "3px solid var(--gn-text, #15803d)", fontSize: 12.5 }}>
                  Got what it needs. Close this panel and <b>✦ Draft the records</b> — every field stays yours to refine before anything is created.
                </div>
              )}
            </div>
            {!chatDone && (
              <form onSubmit={sendAnswer} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="stack-2">
                <textarea className="textarea" rows={3} autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer in your own words — you can see everything you type."
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendAnswer(e); }} />
                <div className="row gap-2">
                  <button className="btn btn-sm" type="submit" disabled={chatBusy || !answer.trim()}>{chatBusy ? "…" : "Send"}</button>
                  <button className={(ready ?? 0) >= 80 ? "btn btn-sm" : "btn btn-secondary btn-sm"} type="button" disabled={chatBusy || chat.length < 2} onClick={() => { setChatDone(true); setChatOpen(false); }}
                    style={(ready ?? 0) >= 80 ? { background: "var(--gn-text, #15803d)", color: "#fff" } : undefined}>
                    {(ready ?? 0) >= 80 ? "✓ Good level — go draft" : "Enough — go draft"}</button>
                </div>
              </form>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
