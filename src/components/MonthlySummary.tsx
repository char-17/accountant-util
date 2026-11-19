import { useId, useState } from "react";
import type { MonthlySummary as MonthlySummaryType } from "../domain/types";

interface MonthlySummaryProps {
  /** Shows a toggle for the monthly totals. */
  collapsible?: boolean;
  /** Separates progress into its own collapsible panel. */
  collapsibleProgress?: boolean;
  summary: MonthlySummaryType | null;
  year: number;
  month: number;
  isFiltered?: boolean;
  totalTasks?: number;
  onSelectClient?: (clientId: number) => void;
  defaultExpanded?: boolean;
}

interface ClientProgressProps {
  summary: MonthlySummaryType;
  collapsible: boolean;
  defaultExpanded?: boolean;
  onSelectClient?: (clientId: number) => void;
}

export function MonthlySummary({
  collapsible = false,
  collapsibleProgress = false,
  summary,
  isFiltered,
  totalTasks,
  onSelectClient,
  defaultExpanded = false,
}: MonthlySummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();

  if (!summary) {
    return <div className="summary-empty">Επιλέξτε μήνα για σύνοψη</div>;
  }

  if (!collapsible && summary.clientProgress.length > 0) {
    return (
      <>
        <MonthlyTotals
          summary={summary}
          isFiltered={isFiltered}
          totalTasks={totalTasks}
        />
        <ClientProgress
          summary={summary}
          collapsible={collapsibleProgress}
          defaultExpanded={defaultExpanded}
          onSelectClient={onSelectClient}
        />
      </>
    );
  }

  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.completedTasks / summary.totalTasks) * 100)
    : 0;
  const hidden = isFiltered ? (totalTasks ?? summary.totalTasks) - summary.totalTasks : 0;

  const totals = (
    <div className="monthly-summary">
      <div className="summary-stats">
        <div className="stat"><span className="stat-value">{summary.totalClients}</span><span className="stat-label">Πελάτες</span></div>
        <div className="stat"><span className="stat-value pending">{summary.pendingTasks}</span><span className="stat-label">Εκκρεμείς</span></div>
        <div className="stat"><span className="stat-value">{summary.totalTasks}</span><span className="stat-label">{isFiltered ? "Εργασίες (φίλτρο)" : "Εργασίες"}</span></div>
        <div className="stat"><span className="stat-value completed">{summary.completedTasks}</span><span className="stat-label">Ολοκληρωμένες</span></div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${completionRate}%` }} />
        <span className="progress-text">{completionRate}%</span>
      </div>
      {hidden > 0 && <p className="summary-filtered-note">{hidden} εργασίες αποκρύπτονται από τα φίλτρα.</p>}
    </div>
  );

  if (collapsible) {
    return (
      <>
        <section className="monthly-summary-panel">
          <h3 className="overview-panel-heading">
            <button
              type="button"
              className="overview-panel-toggle summary-panel-toggle monthly-summary-toggle"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls={contentId}
            >
              <span className="section-heading">Σύνοψη μήνα</span>
              <span aria-hidden="true" className="report-caret">{expanded ? "▾" : "▸"}</span>
            </button>
          </h3>
          <div id={contentId} hidden={!expanded}>{totals}</div>
        </section>
        <ClientProgress
          summary={summary}
          collapsible={collapsibleProgress}
          defaultExpanded={defaultExpanded}
          onSelectClient={onSelectClient}
        />
      </>
    );
  }

  return totals;
}

function MonthlyTotals({
  summary,
  isFiltered,
  totalTasks,
}: Pick<MonthlySummaryProps, "summary" | "isFiltered" | "totalTasks">) {
  if (!summary) return null;
  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.completedTasks / summary.totalTasks) * 100)
    : 0;
  const hidden = isFiltered ? (totalTasks ?? summary.totalTasks) - summary.totalTasks : 0;

  return (
    <div className="monthly-summary">
      <div className="summary-stats">
        <div className="stat"><span className="stat-value">{summary.totalClients}</span><span className="stat-label">Πελάτες</span></div>
        <div className="stat"><span className="stat-value pending">{summary.pendingTasks}</span><span className="stat-label">Εκκρεμείς</span></div>
        <div className="stat"><span className="stat-value">{summary.totalTasks}</span><span className="stat-label">{isFiltered ? "Εργασίες (φίλτρο)" : "Εργασίες"}</span></div>
        <div className="stat"><span className="stat-value completed">{summary.completedTasks}</span><span className="stat-label">Ολοκληρωμένες</span></div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${completionRate}%` }} />
        <span className="progress-text">{completionRate}%</span>
      </div>
      {hidden > 0 && <p className="summary-filtered-note">{hidden} εργασίες αποκρύπτονται από τα φίλτρα.</p>}
    </div>
  );
}

function ClientProgress({ summary, collapsible, defaultExpanded, onSelectClient }: ClientProgressProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const items = (
    <div className="client-progress-items">
      {summary.clientProgress.map((client) => (
        <div key={client.clientId} className="client-progress-item">
          <button
            type="button"
            className="client-name client-progress-client-button"
            onClick={() => onSelectClient?.(client.clientId)}
          >
            {client.clientName}
          </button>
          <div className="mini-progress">
            <div
              className="mini-progress-fill"
              style={{ width: `${client.totalTasks > 0 ? client.completedTasks / client.totalTasks * 100 : 0}%` }}
            />
          </div>
          <span className="progress-label">{client.completedTasks}/{client.totalTasks}</span>
        </div>
      ))}
    </div>
  );

  if (collapsible) {
    return (
      <section className="client-progress-panel responsive-client-progress">
        <h3 className="overview-panel-heading">
          <button
            type="button"
            className="overview-panel-toggle summary-panel-toggle client-progress-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            <span className="section-heading">Πρόοδος ανά πελάτη</span>
            <span aria-hidden="true" className="report-caret">{expanded ? "▾" : "▸"}</span>
          </button>
        </h3>
        <div id={contentId} hidden={!expanded}>
          <div className="client-progress-list">{expanded ? items : null}</div>
        </div>
      </section>
    );
  }

  return (
    <div className="client-progress-panel">
      <div className="client-progress-list">
        <button
          className="summary-panel-toggle client-progress-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={contentId}
        >
          <span className="section-heading">Πρόοδος ανά πελάτη</span>
          <span aria-hidden="true" className="report-caret">{expanded ? "▾" : "▸"}</span>
        </button>
        <div id={contentId} hidden={!expanded}>{expanded ? items : null}</div>
      </div>
    </div>
  );
}
