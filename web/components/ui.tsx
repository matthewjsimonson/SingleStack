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
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
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
        className="card"
        style={{ width, maxWidth: "100%", boxShadow: "var(--shadow-md)", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 120px)" }}
      >
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <span className="t-h2" style={{ fontSize: 15 }}>{title}</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
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

