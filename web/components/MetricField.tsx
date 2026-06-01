"use client";

// Metric field — the dynamic, month-over-month half of a living record (NPS,
// usage, churn). Unlike a narrative field (prose, filled at the gate), a metric
// is a numeric time-series where EVERY value must trace to a source. The UI
// enforces the same integrity the DB does: you cannot add a reading without a
// source label and a backup reference (or a manual override that still cites its
// origin). No naked numbers. See docs/architecture/living-records.md.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Reading = { id: string; period: string; value_num: number; origin: string; source_label: string; source_ref: string | null; note: string | null };
type Latest = { period: string; value_num: number; prev_value: number | null; mom_delta: number | null; source_label: string };

const monthLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
const firstOfMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export default function MetricField({ fieldId, unit }: { fieldId: string; unit?: string | null }) {
  const supabase = createClient();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // entry draft — provenance is REQUIRED (mirrors the DB CHECK)
  const [d, setD] = useState({ period: firstOfMonth(new Date()), value: "", origin: "source", source_label: "", source_ref: "", note: "" });

  const load = useCallback(async () => {
    const [{ data: rs }, { data: lt }] = await Promise.all([
      supabase.from("record_metrics").select("id, period, value_num, origin, source_label, source_ref, note").eq("record_field_id", fieldId).order("period", { ascending: false }),
      supabase.rpc("metric_latest", { p_field_id: fieldId }),
    ]);
    setReadings(rs ?? []);
    setLatest((lt && (lt as Latest[])[0]) || null);
  }, [supabase, fieldId]);
  useEffect(() => { load(); }, [load]);

  // Mirror the DB integrity rule so we fail fast with a clear message, not a 400.
  const provenanceOk = d.source_label.trim().length > 0 && d.source_ref.trim().length > 0;
  const valueOk = d.value.trim() !== "" && !Number.isNaN(Number(d.value));

  async function addReading() {
    setError(null);
    if (!valueOk) { setError("Enter a number for this period."); return; }
    if (!provenanceOk) { setError("A metric needs a source and a backup reference — no unsourced numbers."); return; }
    setBusy(true);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("record_metrics").insert({
        org_id: orgId, record_field_id: fieldId, period: d.period, value_num: Number(d.value),
        origin: d.origin, source_label: d.source_label.trim(), source_ref: d.source_ref.trim(), note: d.note.trim() || null,
      });
      if (error) throw error;
      setAdding(false);
      setD({ period: firstOfMonth(new Date()), value: "", origin: "source", source_label: "", source_ref: "", note: "" });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save reading.";
      setError(/record_metrics_field_period_uniq|duplicate/i.test(msg) ? "A reading for that period already exists — edit or pick another month." : msg);
    } finally { setBusy(false); }
  }

  const deltaTone = latest?.mom_delta == null ? "var(--tm)" : latest.mom_delta > 0 ? "#15803d" : latest.mom_delta < 0 ? "var(--rd-text, #b91c1c)" : "var(--tm)";
  const deltaStr = latest?.mom_delta == null ? "" : `${latest.mom_delta > 0 ? "↑" : latest.mom_delta < 0 ? "↓" : ""}${Math.abs(latest.mom_delta)} MoM`;

  return (
    <div style={{ marginLeft: 26 }}>
      {error && <div className="t-sub" style={{ color: "var(--rd-text, #b91c1c)", marginBottom: 8 }}>{error}</div>}

      {latest ? (
        <div className="row gap-2" style={{ alignItems: "baseline", marginBottom: readings.length ? 8 : 0 }}>
          <span className="t-mono" style={{ fontSize: 22, fontWeight: 700 }}>{latest.value_num}{unit && unit !== "NPS" ? unit : ""}</span>
          {deltaStr && <span className="t-mono-xs" style={{ color: deltaTone, fontWeight: 600 }}>{deltaStr}</span>}
          <span className="t-mono-xs t-muted">· {monthLabel(latest.period)} · {latest.source_label}</span>
        </div>
      ) : (
        <div className="t-sub t-muted" style={{ marginBottom: 8 }}>No readings yet — every value needs a source.</div>
      )}

      {/* sparkline-ish history: period · value · source, newest first (bounded) */}
      {readings.length > 1 && (
        <div className="t-mono-xs t-muted" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          {readings.slice(0, 12).map((r) => (
            <span key={r.id} title={`${r.source_label}${r.source_ref ? " · " + r.source_ref : ""}${r.origin === "manual" ? " (manual)" : ""}`}>
              {monthLabel(r.period)}: <b style={{ color: "var(--tp)" }}>{r.value_num}</b>
            </span>
          ))}
        </div>
      )}

      {!adding ? (
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add reading</button>
      ) : (
        <div className="card card-pad" style={{ marginTop: 4 }}>
          <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 120px" }}><span className="t-label">Period</span>
              <input className="input" type="month" value={d.period.slice(0, 7)} onChange={(e) => setD({ ...d, period: e.target.value + "-01" })} /></label>
            <label className="field" style={{ flex: "1 1 100px" }}><span className="t-label">Value {unit ? `(${unit})` : ""}</span>
              <input className="input" inputMode="decimal" placeholder="e.g. 42" value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} /></label>
            <label className="field" style={{ flex: "0 0 130px" }}><span className="t-label">Origin</span>
              <select className="select" value={d.origin} onChange={(e) => setD({ ...d, origin: e.target.value })}>
                <option value="source">From a source</option>
                <option value="manual">Manual override</option>
              </select></label>
          </div>
          {/* Provenance is required — this is the no-naked-numbers gate. */}
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Source <span style={{ color: "var(--rd-text, #b91c1c)" }}>*</span> {d.origin === "manual" ? "(where you got this number)" : "(the tool/report it came from)"}</span>
            <input className="input" placeholder={d.origin === "manual" ? "e.g. Q2 board deck" : "e.g. Delighted NPS, Amplitude"} value={d.source_label} onChange={(e) => setD({ ...d, source_label: e.target.value })} /></label>
          <label className="field" style={{ marginBottom: 10 }}><span className="t-label">Backup / evidence <span style={{ color: "var(--rd-text, #b91c1c)" }}>*</span> (link, doc, or query — so it's traceable)</span>
            <input className="input" placeholder="https://… or doc reference" value={d.source_ref} onChange={(e) => setD({ ...d, source_ref: e.target.value })} /></label>
          {!provenanceOk && <div className="t-mono-xs t-muted" style={{ marginBottom: 8 }}>A source and a backup reference are required — metrics are never unsourced.</div>}
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy || !valueOk || !provenanceOk} onClick={addReading}>{busy ? "Saving…" : "Add reading"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
