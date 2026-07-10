"use client";

// Signals — the SETUP page, and only that: the signals profile IS the page.
// The focus tabs define WHAT the brain hunts as a node hierarchy; the signals
// each node pulls (and manual entries) live INSIDE the node. The signals
// themselves surface on the intelligence pages they feed — Competitive,
// Market, Technology.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Banner } from "@/components/ui";
import PageBar from "@/components/PageBar";
import SignalProfile from "@/components/SignalProfile";
import AutomationHealth from "@/components/AutomationHealth";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";

export default function SignalsView() {
  const supabase = createClient();
  const [signalCount, setSignalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const synthRun = useAgentRun("synthesize");

  const load = useCallback(async () => {
    const { count } = await supabase.from("signals").select("id", { count: "exact", head: true });
    setSignalCount(count ?? 0);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  // Synthesize: fold pulled signals into themes + proposals. Results are
  // ratified inside the nodes; the themes land on the strategy boards.
  async function synthesize() {
    setError(null);
    try {
      await synthRun.go(async () => {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        const { data, error } = await supabase.functions.invoke("synthesize-signals", {
          body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        await load();
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Synthesis failed."); }
  }

  return (
    <div>
      <PageBar actions={
        synthRun.active
          ? <AgentProgress run={synthRun} compact />
          : <button className="btn btn-sm" disabled={signalCount === 0} onClick={synthesize}
              title="Fold pulled signals into themes and proposals">Synthesize</button>
      } />
      <div className="t-sub t-muted" style={{ margin: "-6px 0 var(--sp-4)", fontSize: 12.5 }}>
        Set up what the brain hunts. Signals land where they belong: <a href="/competitive" style={{ color: "var(--ac-text)" }}>Competitive</a>, <a href="/market" style={{ color: "var(--ac-text)" }}>Market</a>, <a href="/frontier" style={{ color: "var(--ac-text)" }}>Technology</a>.
      </div>
      <Banner>{error}</Banner>

      <AutomationHealth />
      <SignalProfile scope="landscape" />
    </div>
  );
}
