"use client";

// Monitoring health — the honest answer to "is it actually pulling?". Reads the
// REAL evidence: sources on a non-manual cadence (which EXPECT the hourly
// heartbeat) vs. connector_runs with trigger='scheduled' (PROOF the heartbeat
// fired). No trusting a checkmark — this shows whether auto-monitoring is live,
// pending its first tick, or not firing (heartbeat not configured).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type State = {
  scheduled: number;          // sources on daily/weekly cadence, connected
  oldestScheduledAgeMin: number | null;
  lastScheduledAt: string | null;  // most recent trigger='scheduled' run
  scheduledRuns: number;
};

export default function MonitoringStatus({ competitorId, compact = false }: { competitorId?: string; compact?: boolean }) {
  const supabase = createClient();
  const [st, setSt] = useState<State | null>(null);

  const load = useCallback(async () => {
    let sq = supabase.from("sources").select("created_at").neq("cadence", "manual").eq("status", "connected");
    if (competitorId) sq = sq.eq("competitor_id", competitorId);
    const { data: srcs } = await sq;
    const ages = (srcs ?? []).map((s) => Date.now() - new Date(s.created_at).getTime());
    const oldest = ages.length ? Math.max(...ages) / 60000 : null;
    // proof the heartbeat actually pulled: scheduled connector_runs
    const { data: runs, count } = await supabase.from("connector_runs")
      .select("created_at", { count: "exact" }).eq("trigger", "scheduled")
      .order("created_at", { ascending: false }).limit(1);
    setSt({ scheduled: srcs?.length ?? 0, oldestScheduledAgeMin: oldest, lastScheduledAt: runs?.[0]?.created_at ?? null, scheduledRuns: count ?? 0 });
  }, [supabase, competitorId]);
  useEffect(() => { load(); }, [load]);

  if (!st || st.scheduled === 0) return null;  // nothing scheduled → nothing to report

  const ageMs = st.lastScheduledAt ? Date.now() - new Date(st.lastScheduledAt).getTime() : null;
  const ago = (ms: number) => ms < 3600_000 ? `${Math.round(ms / 60000)}m ago` : ms < 86400_000 ? `${Math.round(ms / 3600_000)}h ago` : `${Math.round(ms / 86400_000)}d ago`;

  // LIVE = a scheduled pull happened within the last ~25h (covers daily cadence).
  // PENDING = scheduled sources exist but younger than one hourly tick.
  // STALLED = scheduled sources older than ~70min with no scheduled run ever.
  let tone: "live" | "pending" | "stalled";
  let msg: string;
  if (ageMs !== null && ageMs < 25 * 3600_000) {
    tone = "live"; msg = `Auto-monitoring is live — last scheduled pull ${ago(ageMs)} · ${st.scheduledRuns} scheduled run${st.scheduledRuns === 1 ? "" : "s"} total.`;
  } else if (st.scheduledRuns === 0 && (st.oldestScheduledAgeMin ?? 0) < 70) {
    tone = "pending"; msg = `${st.scheduled} monitor${st.scheduled === 1 ? "" : "s"} set — the hourly heartbeat runs at :12 past; first auto-pull within the hour. (Pull now to verify immediately.)`;
  } else {
    tone = "stalled"; msg = `${st.scheduled} monitor${st.scheduled === 1 ? "" : "s"} set, but no scheduled pull has run${st.lastScheduledAt ? ` since ${ago(ageMs!)}` : " yet"}. The hourly heartbeat isn't firing — the project's pg_cron + Vault secrets (project_url / service_role_key) likely aren't set. Manual "Pull now" still works.`;
  }
  const col = tone === "live" ? "var(--gn-text, #15803d)" : tone === "pending" ? "var(--ac-text, var(--ac))" : "var(--am-text, #D97706)";
  const icon = tone === "live" ? "●" : tone === "pending" ? "◔" : "⚠";

  return (
    <div className="card card-pad" style={{ background: "var(--panel-2)", borderLeft: `3px solid ${col}`, padding: compact ? "8px 12px" : undefined }}>
      <div className="row gap-2" style={{ alignItems: "baseline" }}>
        <span style={{ color: col, fontWeight: 700 }}>{icon}</span>
        <span className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{msg}</span>
      </div>
    </div>
  );
}
