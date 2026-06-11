"use client";

// Sell desk — the SELLER's surface. Not "let's build/decide" — the product is
// built; this is "here's what to say." A consumer view of finished assets:
// messaging (the one-pager) + battle cards per competitor + on-demand talk
// tracks. Read-optimized, copy-ready, no signals or synthesis in sight.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip, Banner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { fetchAgentKey, authHeader, errText } from "@/lib/strategy";

type Field = { field_key: string; label: string; value: string | null };
type Competitor = { id: string; name: string; relationship: string; notes: string | null };
type Card = { id: string; competitor_id: string | null; kind: string; title: string; detail: string | null };
type Gtm = { id: string; name: string };

// The seller-facing messaging fields, in the order a rep wants them.
const MSG_ORDER: { key: string; label: string }[] = [
  { key: "value_prop", label: "Value proposition" },
  { key: "pillars", label: "Message pillars" },
  { key: "positioning", label: "Positioning" },
  { key: "proof_points", label: "Proof points" },
  { key: "primary_persona", label: "Primary persona" },
  { key: "personas", label: "Personas" },
  { key: "objections", label: "Objection handling" },
  { key: "hero", label: "Hero line" },
];
const KIND_LABEL: Record<string, string> = { win: "Why we win", lose: "Why we lose", strength: "Their strengths", objection: "Objection handling", trap: "Landmines to set", pricing: "Pricing & packaging", proof: "Proof points", discovery: "Discovery questions" };
const KIND_TONE: Record<string, "green" | "amber" | "violet" | "default"> = { win: "green", proof: "green", lose: "amber", strength: "violet", trap: "violet", objection: "default", pricing: "default", discovery: "default" };
const KIND_SORT = ["win", "proof", "objection", "trap", "discovery", "lose", "strength", "pricing"];

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard may be blocked */ } }}>{done ? "Copied ✓" : "Copy"}</button>;
}

export default function SellDesk() {
  const supabase = createClient();
  const [view, setView] = useState<"battlecards" | "messaging">("battlecards");
  const [gtms, setGtms] = useState<Gtm[]>([]);
  const [gtmId, setGtmId] = useState<string>("");
  const [fields, setFields] = useState<Field[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [comp, setComp] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [talk, setTalk] = useState<Record<string, string>>({}); // competitor_id -> drafted talk track
  const [drafting, setDrafting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: g }, { data: cs }, { data: bc }] = await Promise.all([
      supabase.from("gtm_records").select("id, name").order("created_at"),
      supabase.from("competitors").select("id, name, relationship, notes").order("position").order("created_at"),
      supabase.from("battlecard_items").select("id, competitor_id, kind, title, detail").eq("audience", "field").order("position"),
    ]);
    setGtms((g ?? []) as Gtm[]); setCompetitors((cs ?? []) as Competitor[]); setCards((bc ?? []) as Card[]);
    if (!gtmId && g?.length) setGtmId(g[0].id);
    if (!comp && cs?.length) setComp(cs[0].id);
    setLoading(false);
  }, [supabase, gtmId, comp]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!gtmId) { setFields([]); return; }
    supabase.from("record_fields").select("field_key, label, value").eq("gtm_record_id", gtmId).then(({ data }) => setFields((data ?? []) as Field[]));
  }, [supabase, gtmId]);

  async function draftTalkTrack(c: Competitor) {
    setDrafting(c.id); setError(null);
    try {
      const agentKey = await fetchAgentKey(supabase);
      if (!agentKey) throw new Error("No officer available (seed agents first).");
      const ours = fields.find((f) => f.field_key === "value_prop")?.value ?? "";
      const cc = cards.filter((x) => x.competitor_id === c.id);
      const wins = cc.filter((x) => x.kind === "win").map((x) => x.title).join("; ");
      const objs = cc.filter((x) => x.kind === "objection").map((x) => x.title).join("; ");
      const prompt = `Write a tight TALK TRACK a sales rep can say out loud when a prospect is comparing us to "${c.name}". 3–4 sentences, confident, no fluff, specific. Ground it in:\nOur value: ${ours || "(see record)"}\nWhy we win: ${wins || "(n/a)"}\nObjections to preempt: ${objs || "(n/a)"}\nReturn only the talk track.`;
      const { data, error } = await supabase.functions.invoke("agent-chat", { body: { agent_key: agentKey, messages: [{ role: "user", content: prompt }] }, headers: await authHeader(supabase) });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTalk((t) => ({ ...t, [c.id]: String(data?.reply ?? "") }));
    } catch (e) { setError(errText(e, "Could not draft the talk track.")); }
    finally { setDrafting(null); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const selected = competitors.find((c) => c.id === comp) ?? null;
  const cardsFor = (id: string) => cards.filter((x) => x.competitor_id === id).sort((a, b) => KIND_SORT.indexOf(a.kind) - KIND_SORT.indexOf(b.kind));
  const msgFields = MSG_ORDER.map((m) => ({ ...m, value: fields.find((f) => f.field_key === m.key)?.value })).filter((m) => m.value);

  return (
    <div>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <h1 className="t-page">Sell desk</h1>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>What to say — ready to use. Battle cards and messaging, packaged for the field. (Who to sell to lives in <a href="/pql" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Qualified leads</a>.)</div>
      </div>
      <Banner>{error}</Banner>

      <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: "var(--sp-4)", width: "fit-content" }}>
        {(["battlecards", "messaging"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className="btn-sm" style={{ border: "none", background: view === v ? "var(--ac)" : "var(--panel)", color: view === v ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 14px", cursor: "pointer" }}>{v === "battlecards" ? "Battle cards" : "Messaging"}</button>
        ))}
      </div>

      {view === "battlecards" ? (
        competitors.length === 0 ? <div className="t-sub t-muted">No competitors yet — add them in Competitive, then battle cards appear here ready to use.</div> : (
          <div>
            <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
              {competitors.map((c) => (
                <button key={c.id} onClick={() => setComp(c.id)} className="btn btn-sm" style={{ background: comp === c.id ? "var(--ac)" : "var(--panel)", color: comp === c.id ? "#fff" : "var(--ts)", border: comp === c.id ? "none" : "1px solid var(--border)" }}>{c.name} <span className="t-mono-xs" style={{ opacity: 0.7 }}>· {cardsFor(c.id).length}</span></button>
              ))}
            </div>

            {selected && (<>
              <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--sp-3)", gap: 8, flexWrap: "wrap" }}>
                <div className="row gap-2" style={{ alignItems: "center" }}><span className="t-h2" style={{ fontSize: 15 }}>vs {selected.name}</span><Chip tone={selected.relationship === "direct" ? "accent" : "violet"}>{selected.relationship}</Chip></div>
                <button className="btn btn-sm" disabled={drafting === selected.id} onClick={() => draftTalkTrack(selected)} style={{ background: "var(--ac)", color: "#fff" }}>{drafting === selected.id ? "Drafting…" : "✦ Draft talk track"}</button>
              </div>
              {talk[selected.id] && (
                <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)", marginBottom: "var(--sp-4)" }}>
                  <div className="row-between" style={{ alignItems: "center", marginBottom: 4 }}><div className="t-label">Talk track</div><CopyBtn text={talk[selected.id]} /></div>
                  <Markdown className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }} text={talk[selected.id]} />
                </div>
              )}
              {cardsFor(selected.id).length === 0 ? (
                <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No battle card for {selected.name} yet</div><div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Add win/lose/objection points in Competitive → {selected.name}, or draft a talk track above to get started.</div></div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--sp-3)" }}>
                  {cardsFor(selected.id).map((c) => (
                    <div key={c.id} className="card card-pad" style={{ borderTop: `2px solid var(--${KIND_TONE[c.kind] === "green" ? "gn" : KIND_TONE[c.kind] === "amber" ? "am-text" : KIND_TONE[c.kind] === "violet" ? "vl" : "border-strong"})` }}>
                      <div className="row-between" style={{ alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                        <Chip tone={KIND_TONE[c.kind] ?? "default"}>{KIND_LABEL[c.kind] ?? c.kind}</Chip>
                        <CopyBtn text={`${c.title}${c.detail ? `\n${c.detail}` : ""}`} />
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 620, marginBottom: c.detail ? 4 : 0 }}>{c.title}</div>
                      {c.detail && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{c.detail}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>)}
          </div>
        )
      ) : (
        <div>
          {gtms.length > 1 && (
            <select className="select" value={gtmId} onChange={(e) => setGtmId(e.target.value)} style={{ marginBottom: "var(--sp-4)", maxWidth: 320 }}>
              {gtms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          {msgFields.length === 0 ? <div className="t-sub t-muted">No messaging yet — fill the GTM record (value prop, pillars, proof points) and it appears here as a one-pager.</div> : (
            <div className="stack-3">
              {msgFields.map((m) => (
                <div key={m.key} className="card card-pad">
                  <div className="row-between" style={{ alignItems: "center", marginBottom: 6 }}><div className="t-label">{m.label}</div><CopyBtn text={m.value as string} /></div>
                  <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
