"use client";

// "What you want to track", in plain language — the human-in-the-loop half of
// intelligence. You describe what to watch; the system also surfaces AI-
// suggested topics (blind spots) you can accept or dismiss. Scoped by category
// so each Intelligence tab (signals/competitive/market) shows its own topics.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner } from "@/components/ui";

type Topic = { id: string; category: string; prompt: string; focus: string | null; origin: string; status: string };

export default function TrackingTopics({ category, suggestions = [] }: {
  category: "signals" | "competitive" | "market";
  suggestions?: string[]; // example blind-spots offered as one-click adds (origin=ai_suggested)
}) {
  const supabase = createClient();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState<"" | "product" | "gtm">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("tracking_topics").select("id, category, prompt, focus, origin, status").eq("category", category).order("created_at", { ascending: false });
    setTopics(data ?? []);
    setLoading(false);
  }, [supabase, category]);

  useEffect(() => { load(); }, [load]);

  async function add(prompt: string, origin: "human" | "ai_suggested", status: "active" | "suggested") {
    setError(null);
    const p = prompt.trim();
    if (!p) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("tracking_topics").insert({ org_id: orgId, category, prompt: p, focus: focus || null, origin, status });
      if (error) throw error;
      setText("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add topic."); }
  }

  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); await add(text, "human", "active"); setBusy(false); }
  async function setStatus(id: string, status: string) { setError(null); await supabase.from("tracking_topics").update({ status }).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("tracking_topics").delete().eq("id", id); await load(); }

  const active = topics.filter((t) => t.status === "active");
  const tracked = new Set(topics.map((t) => t.prompt.toLowerCase()));
  // blind-spot suggestions not already added
  const openSuggestions = suggestions.filter((s) => !tracked.has(s.toLowerCase()));

  return (
    <Section label="What you're tracking">
      <Banner>{error}</Banner>

      <form onSubmit={submit} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Describe what you want to watch, in your own words. Your agents use this to focus what they surface.
        </div>
        <div className="row gap-2">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }}
            placeholder={category === "competitive" ? "e.g. Track GovDash pricing and packaging changes"
              : category === "market" ? "e.g. Watch AI-native procurement category narrative"
              : "e.g. Flag recurring onboarding friction from support + usage"} />
          <select className="select" value={focus} onChange={(e) => setFocus(e.target.value as "" | "product" | "gtm")} style={{ width: 130 }}>
            <option value="">Org-wide</option><option value="product">Product</option><option value="gtm">GTM</option>
          </select>
          <button className="btn" type="submit" disabled={busy || !text.trim()}>Track</button>
        </div>
      </form>

      {/* AI blind-spot suggestions */}
      {openSuggestions.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-3)", background: "var(--vl-fill)", borderColor: "var(--vl)" }}>
          <div className="row gap-2" style={{ marginBottom: 8 }}>
            <Chip tone="violet">AI suggested</Chip>
            <span className="t-sub" style={{ fontSize: 12.5, color: "var(--vl-text)" }}>You might be missing these. Add the ones that matter.</span>
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {openSuggestions.map((s) => (
              <button key={s} className="btn btn-secondary btn-sm" onClick={() => add(s, "ai_suggested", "active")}>+ {s}</button>
            ))}
          </div>
        </div>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : active.length === 0 ? <div className="t-sub t-muted">Nothing tracked yet. Describe what to watch above.</div>
        : (
          <div className="stack-3">
            {active.map((t) => (
              <div key={t.id} className="card card-pad row-between" style={{ gap: 12 }}>
                <div className="row gap-2" style={{ minWidth: 0 }}>
                  {t.origin === "ai_suggested" && <Chip tone="violet">AI</Chip>}
                  {t.focus && <Chip tone={t.focus === "product" ? "accent" : "violet"}>{t.focus}</Chip>}
                  <span style={{ fontSize: 13.5 }}>{t.prompt}</span>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => remove(t.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
    </Section>
  );
}
