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
import AgentActivity from "@/components/AgentActivity";
import { streamStructured, useRunAbort, isAbortError } from "@/components/alive";
import { emptyActivity, type Activity } from "@/lib/agentStream";

export default function SignalsView() {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const beginRun = useRunAbort();
  const [synthesizing, setSynthesizing] = useState(false);
  const [activity, setActivity] = useState<Activity>(emptyActivity());
  const autoRan = useRef(false);

  // Synthesis is no longer a button — the brain runs it itself. Fold the pulled
  // signals into themes + recommendations in the background whenever there are
  // signals but no pending recommendations yet. Gated to once per browser
  // session so it can never loop when a run legitimately produces nothing.
  const maybeSynthesize = useCallback(async () => {
    if (autoRan.current || synthesizing) return;
    autoRan.current = true;
    try {
      if (sessionStorage.getItem("ss-auto-synth")) return;
      const [{ count: sigs }, { count: recs }] = await Promise.all([
        supabase.from("signals").select("id", { count: "exact", head: true }),
        supabase.from("intel_updates").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      if ((sigs ?? 0) === 0 || (recs ?? 0) > 0) return;
      sessionStorage.setItem("ss-auto-synth", "1");
      setSynthesizing(true); setActivity(emptyActivity());
      const { data: s } = await supabase.auth.getSession();
      await streamStructured({
        signal: beginRun(),
        fnName: "synthesize-signals",
        body: {},
        token: s.session?.access_token,
        onActivity: setActivity,
      });
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : "Background synthesis failed.");
    } finally { setSynthesizing(false); }
  }, [supabase, synthesizing, beginRun]);
  useEffect(() => { maybeSynthesize(); }, [maybeSynthesize]);

  return (
    <div>
      <PageBar actions={synthesizing ? <AgentActivity activity={activity} busy who="The analyst" /> : undefined} />
      <div className="t-sub t-muted" style={{ margin: "-6px 0 var(--sp-4)", fontSize: 12.5 }}>
        Set up what the brain hunts. Signals land where they belong: <a href="/competitive" style={{ color: "var(--ac-text)" }}>Competitive</a>, <a href="/market" style={{ color: "var(--ac-text)" }}>Market</a>, <a href="/frontier" style={{ color: "var(--ac-text)" }}>Technology</a>.
      </div>
      <Banner>{error}</Banner>

      <AutomationHealth />
      <SignalProfile scope="landscape" />
    </div>
  );
}
