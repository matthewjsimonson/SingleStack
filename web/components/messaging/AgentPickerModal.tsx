"use client";

// Agent picker popup — the active roster as a grid of cards. Choosing an agent
// closes the picker and (per the caller) opens the right context sidebar for a
// selection rewrite. Accent + name map via EXEC_BY_KEY; falls back to the raw
// agent row when the key isn't a known exec.
import { Modal } from "@/components/ui";
import { EXEC_BY_KEY } from "@/lib/team";

export type RosterAgent = { id: string; key: string | null; name: string | null; role: string | null };

export default function AgentPickerModal({
  open,
  onClose,
  roster,
  onPick,
  title = "Choose an agent",
  hint,
}: {
  open: boolean;
  onClose: () => void;
  roster: RosterAgent[];
  onPick: (agent: RosterAgent) => void;
  title?: string;
  hint?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} width={560} title={title}>
      {hint && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>{hint}</div>}
      {roster.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 13 }}>No active agents — seed the roster first.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {roster.map((a) => {
            const ex = a.key ? EXEC_BY_KEY[a.key] : undefined;
            const name = ex?.name ?? a.name ?? a.role ?? "Agent";
            const role = ex?.role ?? a.role ?? "";
            const accent = ex?.accent ?? "var(--ac)";
            const short = ex?.short ?? (name.slice(0, 2).toUpperCase());
            return (
              <button key={a.id} onClick={() => onPick(a)} className="card card-pad"
                style={{ textAlign: "left", cursor: "pointer", borderLeft: `2px solid ${accent}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{short}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 640 }}>{name}</span>
                  {role && <span className="t-sub t-muted" style={{ display: "block", fontSize: 11.5, lineHeight: 1.4, marginTop: 2 }}>{role}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
