"use client";

// The Word-like editor for a single messaging element. TipTap + StarterKit gives
// the rich vocabulary (headings, bold/italic, lists); tiptap-markdown round-trips
// the field value as human-readable markdown so the stored text stays backward
// compatible with the plain-text field. The editor is the human review surface —
// AI drafts and selection rewrites flow INTO it; the human Saves.
import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";

export type SelectionInfo = { text: string; from: number; to: number };

// Serialize current editor content to HTML (the stored field value). Name kept
// as editorMarkdown so existing callers don't break.
export function editorMarkdown(editor: Editor | null): string {
  return editor ? editor.getHTML() : "";
}

const Toolbar = ({ editor }: { editor: Editor }) => {
  const btn = (active: boolean): React.CSSProperties => ({
    padding: "4px 9px", fontSize: 12.5, fontWeight: 620, cursor: "pointer", borderRadius: 6,
    border: "1px solid " + (active ? "var(--ac)" : "var(--border)"),
    background: active ? "var(--ac-fill, var(--fill))" : "transparent",
    color: active ? "var(--ac-text)" : "var(--ts)",
  });
  return (
    <div className="row gap-2" style={{ flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)", position: "sticky", top: 0, zIndex: 2 }}>
      <button type="button" style={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
      <button type="button" style={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
      <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 2px" }} />
      <button type="button" style={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button type="button" style={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 2px" }} />
      <button type="button" style={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
      <button type="button" style={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
    </div>
  );
};

export default function RichEditor({
  value,
  onReady,
  onSelection,
  onAgent,
}: {
  value: string;                                 // markdown / plain text seed
  onReady?: (editor: Editor) => void;            // hand the editor up so the parent can drive it
  onSelection?: (sel: SelectionInfo | null) => void;
  onAgent?: (sel: SelectionInfo) => void;        // BubbleMenu "Agent" → open picker for this selection
}) {
  const editor = useEditor({
    immediatelyRender: false, // SSR guard for Next 15
    extensions: [
      StarterKit,
    ],
    content: value || "",
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from === to) { onSelection?.(null); return; }
      const text = editor.state.doc.textBetween(from, to, " ");
      onSelection?.(text.trim() ? { text, from, to } : null);
    },
  }, []);

  // Seed via setContent so switching tasks reloads the editor from the new field value.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => { if (editor && onReady) onReady(editor); }, [editor, onReady]);

  if (!editor) return <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading editor…</div>;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <Toolbar editor={editor} />
      {/* Highlight → Agent: floating menu over a live selection */}
      <BubbleMenu editor={editor} options={{ placement: "top" }}>
        <div className="row gap-2" style={{ padding: 4, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-md)" }}>
          <button type="button" className="btn btn-accent btn-sm"
            onClick={() => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, " ").trim();
              if (text) onAgent?.({ text, from, to });
            }}>
            Agent
          </button>
        </div>
      </BubbleMenu>
      <div style={{ padding: "14px 18px", minHeight: 280, maxHeight: "60vh", overflowY: "auto" }} className="tiptap-host">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
