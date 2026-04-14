"use client";

import { useEffect, useRef } from "react";

const EMAIL_CSS = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #202124;
    max-width: 600px;
    margin: 16px;
    padding: 0;
  }
  p {
    margin: 0 0 1em 0;
  }
  p:last-child {
    margin-bottom: 0;
  }
  a {
    color: #1a73e8;
    text-decoration: underline;
  }
  ul, ol {
    margin: 0 0 1em 0;
    padding-left: 1.5em;
  }
  li {
    margin-bottom: 0.25em;
  }
  strong { font-weight: 600; }
  em { font-style: italic; }
  u { text-decoration: underline; }
`;

interface EmailPreviewFrameProps {
  /** Already-interpolated HTML (variables replaced with real values) */
  html: string;
  /** Optional min-height in px, defaults to 200 */
  minHeight?: number;
}

export function EmailPreviewFrame({ html, minHeight = 200 }: EmailPreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    const srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EMAIL_CSS}</style></head><body>${html}</body></html>`;
    doc.open();
    doc.write(srcdoc);
    doc.close();

    // Auto-resize to content height
    const resize = () => {
      const height = doc.body?.scrollHeight ?? minHeight;
      iframe.style.height = `${Math.max(minHeight, height + 32)}px`;
    };
    resize();
    // Re-check after images/fonts load
    const timer = setTimeout(resize, 100);
    return () => clearTimeout(timer);
  }, [html, minHeight]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      title="Email preview"
      className="w-full border-0 block"
      style={{ minHeight }}
    />
  );
}

// ---------------------------------------------------------------------------
// Preview variable substitution (editor-side preview with sample values)
// ---------------------------------------------------------------------------
const PREVIEW_VALUES: Record<string, string> = {
  first_name: "John",
  last_name: "Doe",
  email: "john@example.com",
  company_name: "Acme Auto",
  phone: "+1 555-0123",
  sender_first_name: "You",
  sender_company: "WrenchLane",
  unsubscribe_link: "#unsubscribe",
};

/**
 * Interpolates {{variable}} and <span data-variable="...">...</span> patterns
 * with sample preview values for the in-editor preview pane.
 */
export function previewInterpolate(html: string): string {
  // Replace span-wrapped variables: <span data-variable="x">{{x}}</span>
  let result = html.replace(
    /<span[^>]+data-variable="([a-z_]+)"[^>]*>(?:[^<]*)<\/span>/g,
    (_, key) => PREVIEW_VALUES[key] ?? `[${key}]`
  );
  // Replace bare {{variable}} patterns
  result = result.replace(/\{\{([a-z_]+(?:\.[a-z_]+)?)\}\}/g, (_, key) => {
    return PREVIEW_VALUES[key] ?? `[${key}]`;
  });
  return result;
}
