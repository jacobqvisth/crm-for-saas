"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { SourceInfo } from "./source-info-data";

export type { SourceInfo } from "./source-info-data";

export function InfoHint({
  info,
  className = "",
}: {
  info: SourceInfo | string;
  className?: string;
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 16,
    top: 16,
    width: 340,
  });
  const normalized =
    typeof info === "string"
      ? {
          title: "Source and logic",
          body: info,
      }
      : info;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 10;
    const width = Math.min(360, window.innerWidth - viewportPadding * 2);
    const measuredHeight = tooltipRef.current?.offsetHeight ?? 260;
    const hasRoomBelow = rect.bottom + gap + measuredHeight <= window.innerHeight - viewportPadding;
    const top = hasRoomBelow
      ? rect.bottom + gap
      : Math.max(viewportPadding, rect.top - measuredHeight - gap);
    const preferredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(
      Math.max(viewportPadding, preferredLeft),
      window.innerWidth - width - viewportPadding,
    );

    setPosition({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const show = () => {
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
  };

  return (
    <span
      className={`info-hint-shell ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          hide();
        }
      }}
      onFocus={show}
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      <button
        aria-describedby={open ? tooltipId : undefined}
        aria-label={`${normalized.title}: ${normalized.body}`}
        className="info-hint"
        ref={triggerRef}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="info-hint-icon"
          fill="none"
          height="18"
          viewBox="0 0 18 18"
          width="18"
        >
          <circle cx="9" cy="9" r="7.25" />
          <path d="M9 8.25v4.25" />
          <path d="M9 5.5h.01" />
        </svg>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              className="info-popover"
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                width: `${position.width}px`,
              }}
            >
              <strong className="info-popover-title">{normalized.title}</strong>
              <span className="info-popover-body">{normalized.body}</span>
              {normalized.sources?.length ? (
                <span className="info-popover-section">
                  <span className="info-popover-label">Sources</span>
                  <span className="info-token-list">
                    {normalized.sources.map((source) => (
                      <em key={source}>{source}</em>
                    ))}
                  </span>
                </span>
              ) : null}
              {normalized.fields?.length ? (
                <span className="info-popover-section">
                  <span className="info-popover-label">Warehouse fields</span>
                  <span className="info-token-list">
                    {normalized.fields.map((field) => (
                      <em key={field}>{field}</em>
                    ))}
                  </span>
                </span>
              ) : null}
              {normalized.logic ? (
                <span className="info-popover-section">
                  <span className="info-popover-label">Logic</span>
                  <span>{normalized.logic}</span>
                </span>
              ) : null}
              {normalized.refresh ? (
                <span className="info-popover-section">
                  <span className="info-popover-label">Updates</span>
                  <span>{normalized.refresh}</span>
                </span>
              ) : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

