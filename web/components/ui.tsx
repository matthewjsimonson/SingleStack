// Small shared UI primitives so every screen composes the same vocabulary
// instead of bespoke inline styles. Keep these minimal and presentational.
import type { ReactNode } from "react";

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
