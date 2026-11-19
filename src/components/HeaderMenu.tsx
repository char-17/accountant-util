import { useEffect, useRef, useState, type ReactNode } from "react";

interface HeaderMenuProps {
  label: string;
  id: string;
  children: (run: (action: () => void) => void) => ReactNode;
}

export function HeaderMenu({ label, id, children }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const run = (action: () => void) => {
    trigger.current?.focus();
    setOpen(false);
    action();
  };

  return (
    <div className="file-menu" ref={root}>
      <button className={`file-menu-trigger ${open ? "active" : ""}`} ref={trigger}
        onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-controls={id}>
        {label}<span className="file-menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && <div className="file-menu-list" id={id} role="menu" aria-label={label}>{children(run)}</div>}
    </div>
  );
}
