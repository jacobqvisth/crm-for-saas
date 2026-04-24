"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Underline from "@tiptap/extension-underline";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Image as ImageIcon,
  Loader2,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  ChevronDown,
  Check,
  UploadCloud,
} from "lucide-react";
import { VariableExtension, EDITOR_VARIABLES, humanizeVariable } from "./tiptap-variable-extension";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

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

function getGoogleDriveFileId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;

  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (fileMatch?.[1]) return fileMatch[1];

  return url.searchParams.get("id");
}

function normalizeImageSrc(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";

    const driveFileId = getGoogleDriveFileId(url);
    if (driveFileId) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(
        driveFileId
      )}&sz=w1200`;
    }

    return url.toString();
  } catch {
    return withProtocol;
  }
}

function getImageFileFromList(files: FileList | null): File | null {
  if (!files) return null;
  return Array.from(files).find((file) => file.type.startsWith("image/")) ?? null;
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Use a JPG, PNG, GIF, or WebP image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Images can be up to 5 MB.";
  }
  return null;
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
// Image dialog
// ---------------------------------------------------------------------------
interface ImageDialogProps {
  initialUrl: string;
  initialAlt: string;
  onConfirm: (url: string, alt: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  onRemove: () => void;
  onCancel: () => void;
  uploading: boolean;
  uploadError: string;
  uploadDisabled?: boolean;
}

function ImageDialog({
  initialUrl,
  initialAlt,
  onConfirm,
  onUploadFile,
  onRemove,
  onCancel,
  uploading,
  uploadError,
  uploadDisabled,
}: ImageDialogProps) {
  const [url, setUrl] = useState(initialUrl);
  const [alt, setAlt] = useState(initialAlt);
  const [dragging, setDragging] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loaded" | "error">(
    "idle"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const normalizedUrl = normalizeImageSrc(url);
  const hasUrl = Boolean(url.trim());

  useEffect(() => {
    setPreviewStatus("idle");
  }, [normalizedUrl]);

  const handleFile = (file: File | null) => {
    if (!file || uploadDisabled || uploading) return;
    void onUploadFile(file);
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5">
        <h4 className="text-sm font-semibold text-slate-900 mb-3">Insert image</h4>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(getImageFileFromList(e.dataTransfer.files));
          }}
          disabled={uploadDisabled || uploading}
          className={`mb-4 flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${
            dragging
              ? "border-indigo-400 bg-indigo-50"
              : "border-slate-300 bg-slate-50 hover:bg-slate-100"
          } ${uploadDisabled || uploading ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {uploading ? (
            <Loader2 className="mb-2 h-5 w-5 animate-spin text-indigo-600" />
          ) : (
            <UploadCloud className="mb-2 h-5 w-5 text-slate-400" />
          )}
          <span className="text-sm font-medium text-slate-700">
            {uploading ? "Uploading image..." : "Drop image here or choose file"}
          </span>
          <span className="mt-1 text-xs text-slate-500">
            JPG, PNG, GIF, or WebP up to 5 MB
          </span>
        </button>
        {uploadError && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {uploadError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Image link
            </label>
            <input
              autoFocus
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && normalizedUrl) {
                  onConfirm(normalizedUrl, alt);
                }
                if (e.key === "Escape") onCancel();
              }}
              placeholder="Paste image URL or Drive share link"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Alt text
            </label>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && normalizedUrl) {
                  onConfirm(normalizedUrl, alt);
                }
                if (e.key === "Escape") onCancel();
              }}
              placeholder="Brief description"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Preview
            </label>
            <div className="h-32 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
              {normalizedUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={normalizedUrl}
                    src={normalizedUrl}
                    alt={alt || ""}
                    onLoad={() => setPreviewStatus("loaded")}
                    onError={() => setPreviewStatus("error")}
                    className={`max-h-full max-w-full object-contain ${
                      previewStatus === "error" ? "hidden" : ""
                    }`}
                  />
                  {previewStatus === "error" && (
                    <span className="px-3 text-center text-xs text-red-600">
                      Image is not loading
                    </span>
                  )}
                </>
              ) : (
                <ImageIcon className="w-6 h-6 text-slate-300" />
              )}
            </div>
            {hasUrl && previewStatus === "error" && (
              <p className="mt-2 text-xs text-slate-500">
                Check that the file is public.
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          {initialUrl && (
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
            onClick={() => onConfirm(normalizedUrl, alt)}
            disabled={!normalizedUrl}
            className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
  workspaceId?: string;
  placeholder?: string;
  variables?: string[];
  onBlur?: () => void;
}

export function RichEmailEditor({
  value,
  onChange,
  workspaceId,
  placeholder = "Start writing your email…",
  variables = [],
  onBlur,
}: RichEmailEditorProps) {
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [currentLink, setCurrentLink] = useState("");
  const [currentImageUrl, setCurrentImageUrl] = useState("");
  const [currentImageAlt, setCurrentImageAlt] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const [draggingImage, setDraggingImage] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const workspaceIdRef = useRef(workspaceId);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  const insertImageBlock = useCallback(
    (src: string, alt: string, position?: number) => {
      const instance = editorRef.current;
      if (!instance) return false;

      const chain = instance.chain().focus();
      if (typeof position === "number") {
        chain.setTextSelection(position);
      }

      chain
        .insertContent([
          { type: "image", attrs: { src, alt: alt || null } },
          { type: "paragraph" },
        ])
        .run();
      return true;
    },
    []
  );

  const uploadAndInsertImage = useCallback(
    async (file: File, position?: number) => {
      const validationError = validateImageFile(file);
      if (validationError) {
        setImageUploadError(validationError);
        return false;
      }

      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId) {
        setImageUploadError("No workspace found for image upload.");
        return false;
      }

      setUploadingImage(true);
      setImageUploadError("");

      try {
        const formData = new FormData();
        formData.append("workspaceId", currentWorkspaceId);
        formData.append("file", file);

        const response = await fetch("/api/email-images/upload", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !payload.url) {
          throw new Error(payload.error || "Image upload failed.");
        }

        insertImageBlock(payload.url, file.name, position);
        return true;
      } catch (error) {
        setImageUploadError(
          error instanceof Error ? error.message : "Image upload failed."
        );
        return false;
      } finally {
        setUploadingImage(false);
      }
    },
    [insertImageBlock]
  );

  const editor = useEditor({
    immediatelyRender: false,
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
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          style: "display:block;max-width:100%;height:auto;border:0;margin:12px 0;",
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
      handleDrop(view, event) {
        const file = getImageFileFromList(event.dataTransfer?.files ?? null);
        if (!file) return false;

        event.preventDefault();
        setDraggingImage(false);
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void uploadAndInsertImage(file, position);
        return true;
      },
      handlePaste(_view, event) {
        const file = getImageFileFromList(event.clipboardData?.files ?? null);
        if (!file) return false;

        event.preventDefault();
        void uploadAndInsertImage(file);
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

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

  const handleImageOpen = () => {
    const attrs = editor.getAttributes("image") as {
      src?: string;
      alt?: string;
    };
    setCurrentImageUrl(attrs.src || "");
    setCurrentImageAlt(attrs.alt || "");
    setShowImageDialog(true);
  };

  const handleImageConfirm = (url: string, alt: string) => {
    const src = normalizeImageSrc(url);
    if (!src) {
      setShowImageDialog(false);
      return;
    }

    const imageAttrs = {
      src,
      alt: alt.trim() || null,
    };

    if (editor.isActive("image")) {
      editor.chain().focus().updateAttributes("image", imageAttrs).run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "image", attrs: imageAttrs },
          { type: "paragraph" },
        ])
        .run();
    }
    setShowImageDialog(false);
  };

  const handleImageRemove = () => {
    editor.chain().focus().deleteSelection().run();
    setShowImageDialog(false);
  };

  const handleImageUpload = async (file: File) => {
    const inserted = await uploadAndInsertImage(file);
    if (inserted) {
      setShowImageDialog(false);
    }
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

        <ToolbarButton
          onClick={handleImageOpen}
          active={editor.isActive("image")}
          title="Insert image"
        >
          <ImageIcon className="w-4 h-4" />
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
      <div
        className="relative"
        onDragEnter={(e) => {
          if (hasDraggedFiles(e.dataTransfer)) {
            setDraggingImage(true);
          }
        }}
        onDragOver={(e) => {
          if (hasDraggedFiles(e.dataTransfer)) {
            e.preventDefault();
            setDraggingImage(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDraggingImage(false);
          }
        }}
        onDrop={() => setDraggingImage(false)}
      >
        <EditorContent editor={editor} />
        {draggingImage && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border border-dashed border-indigo-400 bg-indigo-50/90 text-sm font-medium text-indigo-700">
            Drop image to upload
          </div>
        )}
      </div>

      {/* Footer: char count */}
      <div className="flex items-center justify-between gap-3 px-3 py-1 border-t border-slate-100 bg-slate-50">
        <div className="min-h-4">
          {uploadingImage && (
            <span className="inline-flex items-center gap-1 text-xs text-indigo-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading image...
            </span>
          )}
          {!uploadingImage && imageUploadError && (
            <span className="text-xs text-red-600">{imageUploadError}</span>
          )}
        </div>
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

      {showImageDialog && (
        <ImageDialog
          initialUrl={currentImageUrl}
          initialAlt={currentImageAlt}
          onConfirm={handleImageConfirm}
          onUploadFile={handleImageUpload}
          onRemove={handleImageRemove}
          onCancel={() => setShowImageDialog(false)}
          uploading={uploadingImage}
          uploadError={imageUploadError}
          uploadDisabled={!workspaceId}
        />
      )}
    </div>
  );
}
