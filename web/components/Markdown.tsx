"use client";

// One shared Markdown renderer for every AI output across SingleStack, so agent
// replies, run/play/workflow bodies, briefs, and takes all read cleanly — bolded
// section headers, real bullet/number lists, emphasis, inline code, links — instead
// of raw "#" / "**" symbols. Dependency-free and XSS-safe: it builds React nodes
// (no dangerouslySetInnerHTML), and it degrades gracefully on partial text, so it's
// safe to feed mid-stream (the typewriter answer re-renders as markup completes).
import { Fragment, type CSSProperties, type ReactNode } from "react";

const headingStyle = (level: number): CSSProperties => {
  if (level <= 1) return { fontSize: 15, fontWeight: 700, color: "var(--tx)", margin: "14px 0 6px", lineHeight: 1.3 };
  if (level === 2) return { fontSize: 13.5, fontWeight: 700, color: "var(--tx)", margin: "12px 0 5px", lineHeight: 1.3 };
  return { fontSize: 12.5, fontWeight: 600, color: "var(--ts)", margin: "10px 0 4px", letterSpacing: 0.1, lineHeight: 1.3 };
};
const codeStyle: CSSProperties = { background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", fontSize: "0.92em" };
const preStyle: CSSProperties = { background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", margin: "8px 0", overflowX: "auto", fontSize: 12, lineHeight: 1.5 };

// Inline: `code`, [text](url), **bold**/__bold__, *italic*/_italic_. Code is matched
// first so markers inside it stay literal. Anything unmatched renders as plain text.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={k++} className="mono" style={codeStyle}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("__")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(t)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer" style={{ color: "var(--ac)", textDecoration: "underline" }}>{mm[1]}</a>);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, style, className }: { text: string; style?: CSSProperties; className?: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, key = 0;
  const first = () => blocks.length === 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") { i++; continue; }

    // fenced code block
    if (/^```/.test(trimmed)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // skip closing fence (if present)
      blocks.push(<pre key={key++} className="mono" style={preStyle}>{buf.join("\n")}</pre>);
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={key++} style={{ ...headingStyle(h[1].length), ...(first() ? { marginTop: 0 } : {}) }}>{inline(h[2].trim())}</div>);
      i++; continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={key++} style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} />);
      i++; continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push(
        <div key={key++} style={{ borderLeft: "3px solid var(--border)", paddingLeft: 10, margin: "8px 0", color: "var(--ts)" }}>{inline(buf.join(" "))}</div>,
      );
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      blocks.push(
        <ul key={key++} style={{ margin: "4px 0 6px", paddingLeft: 20 }}>
          {items.map((it, n) => <li key={n} style={{ margin: "2px 0", lineHeight: 1.55 }}>{inline(it)}</li>)}
        </ul>,
      );
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
      blocks.push(
        <ol key={key++} style={{ margin: "4px 0 6px", paddingLeft: 22 }}>
          {items.map((it, n) => <li key={n} style={{ margin: "2px 0", lineHeight: 1.55 }}>{inline(it)}</li>)}
        </ol>,
      );
      continue;
    }

    // paragraph — gather consecutive plain lines, keep soft line breaks
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) && !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) && !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])
    ) { para.push(lines[i]); i++; }
    blocks.push(
      <p key={key++} style={{ margin: first() ? "0 0 6px" : "6px 0", lineHeight: 1.55 }}>
        {para.map((ln, n) => <Fragment key={n}>{n > 0 && <br />}{inline(ln)}</Fragment>)}
      </p>,
    );
  }

  return <div className={className} style={style}>{blocks}</div>;
}
