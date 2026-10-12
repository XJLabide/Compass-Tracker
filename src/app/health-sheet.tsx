"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function HealthSheet({
  title,
  eyebrow,
  error,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  error: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog = dialog;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = activeDialog.querySelector<HTMLElement>("[autofocus]")
      ?? activeDialog.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')
      ?? getFocusableElements(activeDialog)[0]
      ?? activeDialog;
    initialFocus?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(activeDialog);
      if (!focusable.length) { event.preventDefault(); activeDialog.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="sheet-backdrop health-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
      ref={dialogRef}
      className="sheet-panel health-dialog"
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="sheet-heading">
        <div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={`Close ${eyebrow.toLowerCase()} form`}>×</button>
      </div>
      {error && <p className="form-message" role="alert">{error}</p>}
      {children}
      </section>
    </div>
  );
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
}
