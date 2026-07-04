"use client";

// AutomationHealth — the network's pulse, answerable at a glance. Reads
// heartbeat_ticks (one row per cron tick: invoked / skipped / failed) plus the
// scheduled side of connector_runs and sources, and states plainly whether the
// brain is pulling on its own. Dormant is LOUD: a silent scheduler must never
// look like a quiet market. (singlestack-ui non-negotiable #5: status is
// always answerable.)

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tick = { fired_at: string; fn_name: string; status: string; reason: string | null };

// Mirror of scheduled-pulls' cadence windows (daily 20h, weekly 6.5d).
const WINDOW_MS: Record<string, number> = { daily: 20 * 3600_000, weekly: 6.5 * 86400_000 };
const STALL_MS = 2 * 3600_000; // hourly cron; >2h without a tick = stalled

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export default function AutomationHealth() {
  const supabase = createClient();
  const [tick, setTick] = useState<Tick | null>(null);
  const [tickTableMissing, setTickTableMissing] = useState(false);
  const [lastScheduled, setLastScheduled] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<{ n: number; due: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data: t, error: te } = await supabase.from("heartbeat_ticks")
      .select("fired_at, fn_name, status, reason").eq("fn_name", "scheduled-pulls")
      .order("fired_at", { ascending: false }).limit(1).maybeSingle();
    if (te) setTickTableMissing(true); else setTick((t as Tick) ?? null);
    const { data: r } = await supabase.from("connector_runs")
      .select("created_at").eq("trigger", "scheduled").order("created_at", { ascending: false }).limit(1).maybeSingle();
    setLastScheduled((r as { created_at: string } | null)?.created_at ?? null);
    const { data: srcs } = await supabase.from("sources").select("cadence, last_pull_at, status").neq("cadence", "manual");
    const live = (srcs ?? []).filter((s) => s.status !== "disconnected");
    const due = live.filter((s) => {
      const win = WINDOW_MS[s.cadence as string]; if (!win) return false;
      return !s.last_pull_at || Date.now() - new Date(s.last_pull_at).getTime() > win;
    }).length;
    setScheduled({ n: live.length, due });
    setLoaded(true);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  if (!loaded) return null;

  const stalled = tick && tick.status === "invoked" && Date.now() - new Date(tick.fired_at).getTime() > STALL_MS;
  const state: "armed" | "dormant" | "stalled" =
    tickTableMissing || !tick ? "dormant"
    : tick.status !== "invoked" ? "dormant"
    : stalled ? "stalled"
    : "armed";

  const dot = state === "armed" ? "var(--gn)" : state === "stalled" ? "var(--rd-text)" : "var(--am-text)";
  const headline =
    state === "armed" ? "Automated pulls armed"
    : state === "stalled" ? "Heartbeat stalled"
    : "Automated pulls dormant";
  const detail =
    state === "armed"
      ? [
          `last tick ${ago(tick!.fired_at)}`,
          scheduled?.n ? `${scheduled.n} source${scheduled.n === 1 ? "" : "s"} on a schedule${scheduled.due ? ` · ${scheduled.due} due` : ""}` : "no sources on a schedule yet — set a source's cadence to daily and it pulls on its own",
          lastScheduled ? `last scheduled pull ${ago(lastScheduled)}` : "no scheduled pull yet — the next due source pulls on an upcoming tick",
        ].filter(Boolean).join(" · ")
      : state === "stalled"
        ? `The scheduler hasn't ticked since ${ago(tick!.fired_at)} (it runs hourly). Sources are not pulling on their own — check the database's cron jobs.`
        : tickTableMissing || !tick
          ? "No pulse recorded yet — the network has never pulled on its own here. Sources run only when you press Pull."
          : `${tick.reason ?? "The heartbeat is skipping its ticks."} Sources run only when you press Pull.`;

  return (
    <div className="card" style={{ padding: "10px 14px", marginBottom: "var(--sp-4)", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, alignSelf: "center" }} />
      <span style={{ fontSize: 13, fontWeight: 640 }}>{headline}</span>
      <span className="t-sub t-muted" style={{ fontSize: 12, minWidth: 0 }}>{detail}</span>
    </div>
  );
}
