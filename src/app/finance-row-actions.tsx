"use client";

import { useEffect, useRef, useState } from "react";

export interface FinanceAction {
  label: string;
  onSelect(): void;
  danger?: boolean;
}

export function FinanceRowActions({ actions }: { actions: FinanceAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstOptionRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (actions.length === 1) {
    const action = actions[0];
    return <button className="icon-button finance-row-icon" type="button" aria-label={action.label} title={action.label} onClick={action.onSelect}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 3.2 4 4M3.5 16.5l3.7-.8L16 6.9a1.8 1.8 0 0 0-2.9-2.1l-8.7 8.8-.9 2.9Z" /></svg>
    </button>;
  }

  return <div className="finance-action-menu" ref={rootRef}>
    <button ref={triggerRef} className="icon-button finance-row-icon" type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.25" /><circle cx="10" cy="10" r="1.25" /><circle cx="16" cy="10" r="1.25" /></svg>
    </button>
    {open && <div className="finance-action-menu-panel" role="menu">{actions.map((action, index) => <button ref={index === 0 ? firstOptionRef : undefined} className={action.danger ? "finance-action-option is-danger" : "finance-action-option"} type="button" role="menuitem" key={action.label} onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}</div>}
  </div>;
}
