// Small shared UI primitives so every screen composes the same vocabulary
// instead of bespoke inline styles. Keep these minimal and presentational.
import type { ReactNode } from "react";

// Centered modal dialog. Setup/forms live here so pages can be for SHOWING
// information, not housing forms. Click scrim or Close to dismiss.
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  tall = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
  // A stable vertical rectangle centered on screen — for reading and
  // ratifying long text without losing your place underneath.
  tall?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50, background: "rgba(11,12,14,0.42)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 20px", overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: "100%", background: "var(--panel)",
          border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-1)",
          display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 120px)",
          height: tall ? "calc(100vh - 120px)" : undefined,
        }}
      >
        <div className="row-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <span className="t-h2" style={{ fontSize: 15 }}>{title}</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// In-app confirm dialog (replaces the browser's confirm() popup) — built on the
// real Modal (open/onClose/title/children; no footer prop) so it matches the
// design system. Destructive by default styles the confirm action red.
export function ConfirmDialog({ open = true, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = true, onConfirm, onCancel }: {
  open?: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width={440}>
      <div className="t-body" style={{ lineHeight: 1.55, marginBottom: 18 }}>{message}</div>
      <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>{cancelLabel}</button>
        <button className="btn btn-sm" onClick={onConfirm}
          style={destructive ? { background: "var(--rd-text)", borderColor: "var(--rd-text)", color: "#fff" } : undefined}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}


export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="row-between" style={{ marginBottom: "var(--sp-6)", gap: "var(--sp-4)" }}>
      <div>
        <h1 className="t-page">{title}</h1>
        {meta && <div className="t-sub" style={{ marginTop: 2 }}>{meta}</div>}
      </div>
      {actions && <div className="row gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  label,
  action,
  children,
}: {
  label: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <span className="t-label">{label}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Chip({
  tone = "default",
  children,
}: {
  tone?: "default" | "accent" | "violet" | "green" | "amber";
  children: ReactNode;
}) {
  const cls = tone === "default" ? "chip" : `chip chip-${tone}`;
  return <span className={cls}>{children}</span>;
}

// Agent Badge — attributes work to a named agent. The identity color is a 2px
// left border (never the fill — that competes with state colors). singlestack-ui §8.
export function AgentBadge({ name, accent = "var(--ac)" }: { name: string; accent?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 620, padding: "2px 8px", borderRadius: 6, background: "var(--fill)", borderLeft: `2px solid ${accent}`, color: "var(--tp)" }}>{name}</span>
  );
}

// Source Chip — provenance for an AI-generated value: [icon] Source · when.
// Timestamps in tabular mono. singlestack-ui §8 (provenance is visible).
export function SourceChip({ icon, label, when }: { icon?: string | null; label: string; when?: string | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background: "var(--fill)", color: "var(--ts)", maxWidth: "100%" }}>
      {icon && <span aria-hidden>{icon}</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {when && <span className="t-mono-xs" style={{ color: "var(--tm)", flexShrink: 0 }}>· {when}</span>}
    </span>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="banner banner-error" style={{ marginBottom: "var(--sp-4)" }}>{children}</div>;
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="t-body" style={{ fontWeight: 600, marginBottom: hint ? 6 : action ? 14 : 0 }}>{title}</div>
      {hint && <div className="t-sub" style={{ marginBottom: action ? 16 : 0, maxWidth: 420, marginInline: "auto" }}>{hint}</div>}
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="t-sub t-muted">{label}</div>;
}

// Confidence pill: maps a 0..1 level to a tone + percent.
export function Confidence({ label, level }: { label?: string | null; level?: number | null }) {
  if (!label && level == null) return null;
  const pct = level != null ? Math.round(level * 100) : null;
  const tone = level == null ? "default" : level >= 0.75 ? "green" : level >= 0.5 ? "amber" : "default";
  return (
    <Chip tone={tone as "default" | "green" | "amber"}>
      {label}{pct != null ? ` · ${pct}%` : ""}
    </Chip>
  );
}

// Back link — consistent "get out of this page" affordance.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="t-sub" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600, marginBottom: "var(--sp-4)" }}>
      <span style={{ fontSize: 15, lineHeight: 1 }}>‹</span> {label}
    </a>
  );
}

// Placeholder for nav sections that are scaffolded but not built yet. Keeps the
// full IA navigable and communicates intent.
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div>
      <PageHeader title={title} meta="Planned" />
      <div className="empty">
        <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Coming soon</div>
        <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>{blurb}</div>
      </div>
    </div>
  );
}

// Horizontal sub-tabs within a module.
export function SubTabs<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="row gap-2" style={{ marginBottom: "var(--sp-5)", borderBottom: "1px solid var(--border)" }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{ background: "none", border: "none", borderBottom: active === t.key ? "2px solid var(--ac)" : "2px solid transparent", color: active === t.key ? "var(--tp)" : "var(--ts)", fontWeight: 640, fontSize: 13.5, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

