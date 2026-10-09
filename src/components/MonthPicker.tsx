import { useState } from "react";

const MONTHS = [
  "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος",
  "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος",
];

interface MonthPickerProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

export function MonthPicker({ year, month, onChange }: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const goToPrevMonth = () => {
    if (month === 1) {
      onChange(year - 1, 12);
    } else {
      onChange(year, month - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 12) {
      onChange(year + 1, 1);
    } else {
      onChange(year, month + 1);
    }
  };

  const goToCurrentMonth = () => {
    const now = new Date();
    onChange(now.getFullYear(), now.getMonth() + 1);
  };

  return (
    <div className="month-picker">
      <button className="month-nav" onClick={goToPrevMonth} aria-label="Προηγούμενος μήνας" title="Προηγούμενος μήνας">
        ←
      </button>
      {/* The popover lives inside this wrapper rather than beside the button: CSS
          can only position an absolutely positioned element against an
          ancestor, so a dropdown that stays a sibling of the trigger can only be
          aimed at the whole stepper - centred between four controls, with the
          month name off to one side - or at a hardcoded offset that drifts the
          moment the arrow or the label changes width. The wrapper carries no
          styling of its own; it is a positioning context for the popover. */}
      <div className="month-display-wrap">
        <button
          className="month-display"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="true"
          aria-label={`Επιλογή μήνα: ${MONTHS[month - 1]} ${year}`}
        >
          {MONTHS[month - 1]} {year}
        </button>

        {isOpen && (
          <div className="month-dropdown">
            <div className="month-grid">
              {MONTHS.map((name, idx) => (
                <button
                  key={idx}
                  className={`month-option ${idx + 1 === month ? "active" : ""}`}
                  onClick={() => {
                    onChange(year, idx + 1);
                    setIsOpen(false);
                  }}
                  aria-pressed={idx + 1 === month}
                  title={`${name} ${year}`}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="year-nav">
              <button onClick={() => onChange(year - 1, month)} aria-label={`Έτος ${year - 1}`}>
                ← {year - 1}
              </button>
              <span aria-live="polite">Επιλεγμένο έτος: {year}</span>
              <button onClick={() => onChange(year + 1, month)} aria-label={`Έτος ${year + 1}`}>
                {year + 1} →
              </button>
            </div>
          </div>
        )}
      </div>
      <button className="month-nav" onClick={goToNextMonth} aria-label="Επόμενος μήνας" title="Επόμενος μήνας">
        →
      </button>
      <button className="month-current" onClick={goToCurrentMonth} title="Επιστροφή στον τρέχοντα μήνα">
        Τρέχων μήνας
      </button>
    </div>
  );
}
