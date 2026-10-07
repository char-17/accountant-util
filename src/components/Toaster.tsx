import type { Toast } from "../hooks/useToasts";

interface ToasterProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

const ICONS: Record<Toast["kind"], string> = {
  success: "✓",
  error: "✕",
  info: "i",
};

/** Transient confirmation for every action, success or failure. */
export function Toaster({ toasts, onDismiss }: ToasterProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span className="toast-icon" aria-hidden="true">
            {ICONS[t.kind]}
          </span>
          <span className="toast-message">{t.message}</span>
          <button
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Κλείσιμο"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
