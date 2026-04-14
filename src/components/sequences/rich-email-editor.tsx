"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Underline from "@tiptap/extension-underline";
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  ChevronDown,
  Check,
} from "lucide-react";
import { VariableExtension, EDITOR_VARIABLES, humanizeVariable } from "./tiptap-variable-extension";

// ---------------------------------------------------------------------------
// Plain-text → HTML migration for legacy content
// ---------------------------------------------------------------------------
function plainToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs
    .map((para) => {
      const withBreaks = para
        .split(/\n/)
        .map((line) => escapeHtml(line))
        .join("<br>");
      return `<p>${withBreaks}</p>`;
    })
    .join("");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function looksLikePlainText(value: string): boolean {
  return !/<[a-z][\s\S]*>/i.test(value);
}

function normalizeHtml(value: string): string {
  if (!value) return "";
  if (looksLikePlainText(value)) return plainToHtml(value);
  return value;
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------
interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
  disabled,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-indigo-100 text-indigo-700"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Variable dropdown
// ---------------------------------------------------------------------------
interface VariableDropdownProps {
  onInsert: (name: string) => void;
  variables: string[];
}

function VariableDropdown({ onInsert, variables }: VariableDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const shown = variables.length
    ? EDITOR_VARIABLES.filter((v) => variables.includes(v.key))
    : EDITOR_VARIABLES;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors"
      >
        + Variable
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-30 py-1 max-h-64 overflow-y-auto">
          {shown.map((v) => (
            <button
              key={v.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onInsert(v.key);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <span>{v.label}</span>
              <code className="text-xs text-slate-400">{`{{${v.key}}}`}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link dialog
// ---------------------------------------------------------------------------
interface LinkDialogProps {
  initial: string;
  onConfirm: (url: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}

function LinkDialog({ initial, onConfirm, onRemove, onCancel }: LinkDialogProps) {
  const [url, setUrl] = useState(initial);

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
        <h4 className="text-sm font-semibold text-slate-900 mb-3">Insert link</h4>
        <input
          autoFocus
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(url);
            if (e.key === "Escape") onCancel();
          }}
          placeholder="https://example.com"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />
        <div className="flex gap-2 justify-end">
          {initial && (
            <button
              type="button"
              onClick={onRemove}
              className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(url)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            <Check className="w-3.5 h-3.5 inline mr-1" />
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RichEmailEditor
// ---------------------------------------------------------------------------
export interface RichEmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  variables?: string[];
  onBlur?: () => void;
}

export function RichEmailEditor({
  value,
  onChange,
  placeholder = "Start writing your email…",
  variables = [],
  onBlur,
}: RichEmailEditorProps) {
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [currentLink, setCurrentLink] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Use TipTap's hardBreak (Shift+Enter) via StarterKit defaults
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-indigo-600 underline",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      VariableExtension,
    ],
    content: normalizeHtml(value),
    onUpdate({ editor: e }) {
      onChange(e.getHTML());
    },
    onBlur() {
      onBlur?.();
    },
    editorProps: {
      attributes: {
        class:
          "outline-none min-h-[240px] max-h-[500px] overflow-y-auto px-3 py-2.5 text-sm text-slate-800 leading-relaxed prose prose-sm max-w-none",
      },
    },
  });

  // Sync external value changes (e.g. "Use Template" or "Generate with AI")
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (!editor) return;
    if (value === prevValueRef.current) return;
    prevValueRef.current = value;
    const normalized = normalizeHtml(value);
    // Only update if content actually differs to avoid cursor jumps
    if (editor.getHTML() !== normalized) {
      editor.commands.setContent(normalized, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return null;

  const handleLinkOpen = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    setCurrentLink(existing || "");
    setShowLinkDialog(true);
  };

  const handleLinkConfirm = (url: string) => {
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = url.startsWith("http") ? url : `https://${url}`;
      editor.chain().focus().setLink({ href }).run();
    }
    setShowLinkDialog(false);
  };

  const handleLinkRemove = () => {
    editor.chain().focus().unsetLink().run();
    setShowLinkDialog(false);
  };

  const charCount = editor.storage.characterCount?.characters?.() ?? 0;

  return (
    <div className="border border-slate-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <ToolbarButton
          onClick={handleLinkOpen}
          active={editor.isActive("link")}
          title="Insert link"
        >
          <Link2 className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <ToolbarButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .unsetBold()
              .unsetItalic()
              .unsetUnderline()
              .unsetLink()
              .run()
          }
          title="Clear formatting"
        >
          <RemoveFormatting className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <VariableDropdown
          variables={variables}
          onInsert={(name) =>
            editor.chain().focus().insertVariable(name).run()
          }
        />
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />

      {/* Footer: char count */}
      <div className="flex justify-end px-3 py-1 border-t border-slate-100 bg-slate-50">
        <span className="text-xs text-slate-400">{charCount} characters</span>
      </div>

      {showLinkDialog && (
        <LinkDialog
          initial={currentLink}
          onConfirm={handleLinkConfirm}
          onRemove={handleLinkRemove}
          onCancel={() => setShowLinkDialog(false)}
        />
      )}
    </div>
  );
}
