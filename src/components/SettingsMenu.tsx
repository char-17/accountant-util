import { useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { HeaderMenu } from "./HeaderMenu";

interface SettingsMenuProps {
  enabled: boolean;
  onChange: (enabled: boolean) => Promise<void>;
}

export function SettingsMenu({ enabled, onChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const close = () => { if (!saving) setOpen(false); };
  const dialog = useDialogA11y<HTMLDivElement>(open, close);

  async function choose(value: boolean) {
    setSaving(true);
    try {
      await onChange(value);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <HeaderMenu label="Ρυθμίσεις" id="settings-menu-list">
        {(run) => (
          <button className="file-menu-item" role="menuitemcheckbox" aria-checked={enabled}
            aria-haspopup="dialog" onClick={() => run(() => setOpen(true))}>
            Ειδοποιήσεις Windows{enabled && <span aria-hidden="true"> ✓</span>}
          </button>
        )}
      </HeaderMenu>
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && close()}>
          <div ref={dialog} className="modal" role="dialog" aria-modal="true" tabIndex={-1}
            aria-labelledby="windows-notifications-title" aria-describedby="windows-notifications-description">
            <h3 id="windows-notifications-title">Ειδοποιήσεις Windows</h3>
            <p id="windows-notifications-description">
              Όσο η εφαρμογή είναι ανοιχτή, τα Windows εμφανίζουν υπενθυμίσεις για εργασίες
              που πλησιάζουν στην προθεσμία τους ή έχουν λήξει.
            </p>
            <p>Οι ειδοποιήσεις είναι {enabled ? "ενεργές" : "ανενεργές"}. Θέλετε να είναι ενεργές;</p>
            <div className="form-actions">
              <button className="btn-secondary" disabled={saving} onClick={() => void choose(false)}>Όχι</button>
              <button className="btn-primary" disabled={saving} onClick={() => void choose(true)}>Ναι</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
