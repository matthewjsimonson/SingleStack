"use client";

// Signals — the SETUP page, and only that: the signals profile IS the page.
// The focus tabs define WHAT the brain hunts as a node hierarchy; the signals
// each node pulls (and manual entries) live INSIDE the node. The signals
// themselves surface on the intelligence pages they feed — Competitive,
// Market, Technology.
import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Banner } from "@/components/ui";
import PageBar from "@/components/PageBar";
import SignalProfile from "@/components/SignalProfile";
import AutomationHealth from "@/components/AutomationHealth";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";

export default function SignalsView() {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const synthRun = useAgentRun("synthesize");
  const autoRan = useRef(false);

  // Synthesis is no longer a button — the brain runs it itself. Fold the pulled
  // signals into themes + recommendations in the background whenever there are
  // signals but no pending recommendations yet. Gated to once per browser
  // session so it can never loop when a run legitimately produces nothing.
  const maybeSynthesize = useCallback(async () => {
    if (autoRan.current || synthRun.active) return;
    autoRan.current = true;
    try {
      if (sessionStorage.getItem("ss-auto-synth")) return;
      const [{ count: sigs }, { count: recs }] = await Promise.all([
        supabase.from("signals").select("id", { count: "exact", head: true }),
        supabase.from("intel_updates").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      if ((sigs ?? 0) === 0 || (recs ?? 0) > 0) return;
      sessionStorage.setItem("ss-auto-synth", "1");
      await synthRun.go(async () => {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        const { data, error } = await supabase.functions.invoke("synthesize-signals", {
          body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Background synthesis failed."); }
  }, [supabase, synthRun]);
  useEffect(() => { maybeSynthesize(); }, [maybeSynthesize]);

  return (
    <div>
      <PageBar actions={synthRun.active ? <AgentProgress run={synthRun} compact /> : undefined} />
      <div className="t-sub t-muted" style={{ margin: "-6px 0 var(--sp-4)", fontSize: 12.5 }}>
        Set up what the brain hunts. Signals land where they belong: <a href="/competitive" style={{ color: "var(--ac-text)" }}>Competitive</a>, <a href="/market" style={{ color: "var(--ac-text)" }}>Market</a>, <a href="/frontier" style={{ color: "var(--ac-text)" }}>Technology</a>.
      </div>
      <Banner>{error}</Banner>

      <AutomationHealth />
      <SignalProfile scope="landscape" />
    </div>
  );
}
