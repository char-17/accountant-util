import { useRef, useState } from "react";
import type { WorklistFilters } from "../domain/worklist";
import { STATUS_FILTER_LABELS } from "../domain/worklist";
import { greekIncludes } from "../utils/greek";

interface WorklistFiltersBarProps {
  filters: WorklistFilters;
  onStatusChange: (value: WorklistFilters["status"]) => void;
  onReset: () => void;
  /** Hidden when nothing is filtered, so the row stays out of the way. */
  isFiltered: boolean;
  shownCount: number;
  totalCount: number;
  /** Clients offered by the per-client picker. */
  clientOptions: Array<{ id: number; name: string }>;
  /** Tasks offered by the per-task picker. */
  taskOptions: Array<{ id: number; name: string }>;
  /** Professions offered by the per-profession picker. */
  professionOptions?: Array<{ id: number; name: string }>;
  /**
   * A swatch per profession id, shown beside the name in the profession picker.
   * Optional: without it the list is still correct, just without the cue.
   */
  professionColors?: Record<number, string>;
  onClientSelect: (id: number | null) => void;
  onTaskSelect: (id: number | null) => void;
  onProfessionSelect: (id: number | null) => void;
}

/**
 * A search box above a list of options: typing narrows the list, and the list
 * floats over the page rather than pushing the worklist down.
 *
 * Implemented instead of a native dropdown element because a select with 44
 * clients cannot be searched at all, and the native dropdown on Windows renders
 * as a tall list that covers the rest of the window.
 */
interface ClientFilterSelectProps {
  value: number | null;
  /**
   * Defaults to empty rather than being required at every call site: a picker
   * with nothing to offer still has to render - it shows its "all" row and says
   * the list is empty, which is the truth - and should not throw because the
   * caller had nothing to hand it.
   */
  options?: Array<{ id: number; name: string }>;
  onChange: (id: number | null) => void;
  allLabel: string;
  searchLabel: string;
  listLabel: string;
  className: string;
  /**
   * Shown when a search matches nothing. It names what was searched for, and
   * this component is no longer only about clients - the same picker picks a
   * profession on the client form, where "Κανένας πελάτης" would be a lie.
   */
  emptyText?: string;
  /**
   * A swatch per option id, drawn beside its name. Purely a cue: the option is
   * named in text either way, so nothing here depends on seeing the colour.
   */
  colors?: Record<number, string>;
}

export function ClientFilterSelect({
  value,
  options = [],
  onChange,
  allLabel,
  searchLabel,
  listLabel,
  className,
  emptyText = "Κανένας πελάτης με αυτό το όνομα",
  colors = {},
}: ClientFilterSelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // greekIncludes, not a bare toLowerCase: a plain fold misses "ΜΙΣ" typed in
  // caps against "ΜΙΣΘΟΔΟΣΙΑ" stored, because the locale-aware lowercasing turns
  // the query's final sigma into ς while the name's stays σ. It also matches
  // "ο" against "ό". See utils/greek.ts.
  const visible = search.trim() === ""
    ? options
    : options.filter((o) => greekIncludes(o.name, search));
  const selected = options.find((o) => o.id === value);
  const selectedColor = selected ? colors[selected.id] : undefined;

  function choose(id: number | null) {
    onChange(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={`filter-select ${className}`}>
      <div className="filter-select-head">
        <input
          type="search"
          ref={searchRef}
          value={search}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              // Enter picks the first visible option rather than doing nothing,
              // which is what a keyboard user expects from a listbox.
              e.preventDefault();
              if (visible.length > 0) choose(visible[0].id);
            }
          }}
        />
        {/* type="button" because this picker is also used inside the client
            form, where an untyped button submits the form. Shown only with text
            in the box: there is nothing to clear before that, and an always-
            present button would take its width from the search field for the
            whole time. */}
        {search !== "" && (
          <button
            type="button"
            className="filter-select-clear"
            aria-label={`Καθαρισμός: ${searchLabel}`}
            title="Καθαρισμός αναζήτησης"
            onClick={() => {
              setSearch("");
              // Focus stays in the box so the next thing typed goes there, the
              // same as after a backspace.
              searchRef.current?.focus();
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
        <button
          type="button"
          className="filter-select-toggle"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`${listLabel}: ${selected ? selected.name : allLabel}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="filter-select-current" aria-hidden="true">
            {/* The swatch repeats the chosen option's colour, so the current
                value is recognisable without opening the list. */}
            {selectedColor && (
              <span
                className="filter-select-swatch"
                style={{ backgroundColor: selectedColor }}
                aria-hidden="true"
              />
            )}
            {selected ? selected.name : allLabel}
          </span>
          <span aria-hidden="true" className="filter-select-caret">
            ▾
          </span>
        </button>
      </div>

      {open && (
        <>
          {/* Clicking elsewhere closes the list, so it never stays floating. */}
          <div className="filter-select-backdrop" onClick={() => setOpen(false)} />
          <ul className="filter-select-list" role="listbox" aria-label={listLabel}>
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                className={value === null ? "selected" : ""}
                onClick={() => choose(null)}
              >
                {allLabel}
              </button>
            </li>
            {visible.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  className={o.id === value ? "selected" : ""}
                  onClick={() => choose(o.id)}
                >
                  {colors[o.id] && (
                    <span
                      className="filter-select-swatch"
                      style={{ backgroundColor: colors[o.id] }}
                      aria-hidden="true"
                    />
                  )}
                  {o.name}
                </button>
              </li>
            ))}
            {visible.length === 0 && search.trim() !== "" && (
              <li className="filter-select-empty">{emptyText}</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Per-client, per-task, per-profession pickers plus the status buttons. Colour is
 * never the only cue: the selected option is also underlined and labelled as
 * active.
 */
export function WorklistFiltersBar({
  filters,
  onStatusChange,
  onReset,
  isFiltered,
  shownCount,
  totalCount,
  clientOptions,
  taskOptions,
  professionOptions = [],
  professionColors = {},
  onClientSelect,
  onTaskSelect,
  onProfessionSelect,
}: WorklistFiltersBarProps) {
  return (
    <div className="worklist-filters">
      <div className="worklist-filter-inputs">
        <ClientFilterSelect
          value={filters.clientId}
          options={clientOptions}
          onChange={onClientSelect}
          allLabel="Όλοι οι πελάτες"
          searchLabel="Αναζήτηση πελάτη..."
          listLabel="Φίλτρο πελάτη"
          className="filter-client"
        />
        <ClientFilterSelect
          value={filters.taskTypeId}
          options={taskOptions}
          onChange={onTaskSelect}
          allLabel="Όλες οι εργασίες"
          searchLabel="Αναζήτηση εργασίας..."
          listLabel="Φίλτρο εργασίας"
          className="filter-task"
        />
        <ClientFilterSelect
          value={filters.professionId}
          options={professionOptions}
          onChange={onProfessionSelect}
          allLabel="Όλα τα επαγγέλματα"
          searchLabel="Αναζήτηση επαγγέλματος..."
          listLabel="Φίλτρο επαγγέλματος"
          className="filter-profession"
          emptyText="Κανένα επάγγελμα με αυτό το όνομα"
          colors={professionColors}
        />
      </div>

      {/* The status buttons and the "N από M" readout sit on one line: they are
          the same question - what is on screen, and how much of it is left -
          and stacking them put the count on a line of its own where it read as
          a caption. The count and its reset are pushed to the far right so the
          status buttons keep the left edge they share with the pickers above. */}
      <div className="worklist-filter-status-row">
        <div className="status-filter" role="group" aria-label="Φίλτρο κατάστασης">
          {(Object.keys(STATUS_FILTER_LABELS) as Array<WorklistFilters["status"]>).map(
            (status) => (
              <button
                key={status}
                className={`status-filter-option ${filters.status === status ? "active" : ""}`}
                onClick={() => onStatusChange(status)}
                aria-pressed={filters.status === status}
              >
                {STATUS_FILTER_LABELS[status]}
              </button>
            )
          )}
        </div>

        {isFiltered && (
          <div className="worklist-filter-status">
            <span aria-live="polite">
              {shownCount} από {totalCount} εργασίες
            </span>
            {/* Destructive, and dressed like it: clearing throws away the
                filters the user has built rather than changing them, which is
                the same kind of act as a delete - red label on white, filling
                red on hover. Same treatment as the catalogues' delete buttons,
                so the weight of the action is legible before it is taken. */}
            <button className="btn-small btn-danger" onClick={onReset}>
              Καθαρισμός Φίλτρων
            </button>
          </div>
        )}
      </div>
    </div>
  );
}