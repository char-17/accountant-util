import { useState } from "react";
import type { MonthlySummary as MonthlySummaryType } from "../domain/types";

interface MonthlySummaryProps {
  summary: MonthlySummaryType | null;
  year: number;
  month: number;
  /** True when the summary covers a filtered subset, so the numbers are labelled. */
  isFiltered?: boolean;
  /** Unfiltered totals, kept for the "x hidden" note. */
  totalTasks?: number;
  /**
   * Whether the per-client progress list is open. Starts closed: with 44 clients
   * the list is long enough to push the worklist out of view, and the totals
   * above it already answer "how is the month going".
   */
  defaultExpanded?: boolean;
}

export function MonthlySummary({
  summary,
  isFiltered,
  totalTasks,
  defaultExpanded = false,
}: MonthlySummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!summary) {
    return <div className="summary-empty">Επιλέξτε μήνα για σύνοψη</div>;
  }

  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.completedTasks / summary.totalTasks) * 100)
    : 0;

  const hidden = isFiltered ? (totalTasks ?? summary.totalTasks) - summary.totalTasks : 0;

  return (
    <div className="monthly-summary">
      <div className="summary-stats">
        <div className="stat">
          <span className="stat-value">{summary.totalClients}</span>
          <span className="stat-label">Πελάτες</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.totalTasks}</span>
          <span className="stat-label">{isFiltered ? "Εργασίες (φίλτρο)" : "Εργασίες"}</span>
        </div>
        <div className="stat">
          <span className="stat-value completed">{summary.completedTasks}</span>
          <span className="stat-label">Ολοκληρωμένες</span>
        </div>
        <div className="stat">
          <span className="stat-value pending">{summary.pendingTasks}</span>
          <span className="stat-label">Εκκρεμείς</span>
        </div>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${completionRate}%` }} />
        <span className="progress-text">{completionRate}%</span>
      </div>

      {hidden > 0 && (
        <p className="summary-filtered-note">
          {hidden} εργασίες αποκρύπτονται από τα φίλτρα.
        </p>
      )}

      {summary.clientProgress.length > 0 && (
        <div className="client-progress-list">
          <button
            className="client-progress-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className="section-heading">Πρόοδος ανά πελάτη</span>
            <span aria-hidden="true" className="report-caret">
              {expanded ? "▾" : "▸"}
            </span>
          </button>

          {expanded && (
            <div className="client-progress-items">
              {summary.clientProgress.map((cp) => (
                <div key={cp.clientId} className="client-progress-item">
                  <span className="client-name">{cp.clientName}</span>
                  <div className="mini-progress">
                    <div
                      className="mini-progress-fill"
                      style={{
                        width: `${cp.totalTasks > 0 ? (cp.completedTasks / cp.totalTasks) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="progress-label">
                    {cp.completedTasks}/{cp.totalTasks}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}