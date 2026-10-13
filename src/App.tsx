import { useState, useEffect, useRef, useMemo } from "react";
import type { TaskType, Profession } from "./domain/types";
import { useDatabase } from "./hooks/useDatabase";
import { useClients } from "./hooks/useClients";
import { useTasks } from "./hooks/useTasks";
import { useProfessions } from "./hooks/useProfessions";
import { useMonthlyStatus } from "./hooks/useMonthlyStatus";
import { useAssignments } from "./hooks/useAssignments";
import { useCompletedKeys } from "./hooks/useCompletedKeys";
import { useReports } from "./hooks/useReports";
import { MonthPicker } from "./components/MonthPicker";
import { ClientList } from "./components/ClientList";
import { MonthlySummary } from "./components/MonthlySummary";
import { ClientTab } from "./components/ClientTab";
import { TaskCatalog } from "./components/TaskCatalog";
import { ProfessionCatalog } from "./components/ProfessionCatalog";
import { FileMenu } from "./components/FileMenu";
import { Reminders } from "./components/Reminders";
import { MonthlyWorklist } from "./components/MonthlyWorklist";
import { ReportsView } from "./components/ReportsView";
import { Toaster } from "./components/Toaster";
import { useToasts } from "./hooks/useToasts";
import { useWorklistFilters } from "./hooks/useWorklistFilters";
import { useExportReport } from "./hooks/useExportReport";
import { useBackup } from "./hooks/useBackup";
import { useDesktopNotifications } from "./hooks/useDesktopNotifications";
import { currentDeadline, reminderState, describeDeadline } from "./domain/recurrence";
import "./App.css";

type View = "dashboard" | "tasks" | "professions" | "reports";

function App() {
  const {
    db,
    loading: dbLoading,
    error: dbError,
    migrationWarning,
  } = useDatabase();
  const toasts = useToasts();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [showClientTab, setShowClientTab] = useState(false);
  // The client roster is collapsed by default: the accountant's actual work is
  // the month's worklist in the centre, and with 44 clients the roster is long
  // enough to push it out of view. The chosen client is remembered either way,
  // so collapsing never clears the filter.
  const [clientsCollapsed, setClientsCollapsed] = useState(true);
  // Which client's card in the worklist is pulsing, and the timer that ends it.
  const [highlightClientId, setHighlightClientId] = useState<number | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const {
    clients,
    loading: clientsLoading,
    searchQuery,
    setSearchQuery,
    createClient,
    updateClient,
    deleteClient,
    refresh: refreshClients,
  } = useClients(db);
  const { tasks, usage: taskUsage, createTask, updateTask, deleteTask, suggestColor, refresh: refreshTasks } = useTasks(db);
  const {
    professions,
    clientCounts: professionClientCounts,
    createProfession,
    updateProfession,
    deleteProfession,
    suggestColor: suggestProfessionColor,
    refresh: refreshProfessions,
  } = useProfessions(db);
  const {
    statuses,
    markCompleted,
    markPending,
    setAmount,
    setPaid,
    setInvoiced,
    refresh: refreshStatus,
  } = useMonthlyStatus(db, year, month);
  const { assignments, refresh: refreshAssignments } = useAssignments(db);

  // Selecting a client in the left list narrows the worklist to that client,
  // which is what "επιλογή πελάτη ενημερώνει τη σύνοψη δεξιά" asks for. The worklist's
  // own per-client filter drives the same value, so the two controls cannot drift.
  const handleSelectClient = (id: number | null) => {
    setSelectedClientId(id);
  };

  const filters = useWorklistFilters(statuses, year, month, selectedClientId, handleSelectClient);

  // The pickers need the full list, not the filtered rows, so the accountant can
  // switch to a client whose work is currently filtered out.
  const clientOptions = useMemo(
    () => clients.map((c) => ({ id: c.id, name: c.name })),
    [clients]
  );
  const taskOptions = useMemo(
    () => tasks.map((t) => ({ id: t.id, name: t.name })),
    [tasks]
  );
  // Only the professions that are in use are worth filtering by: a retired
  // profession classifies nobody, so it would only ever match an empty list.
  const professionOptions = useMemo(
    () => professions.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name })),
    [professions]
  );
  const professionColors = useMemo(
    () => Object.fromEntries(professions.map((p) => [p.id, p.color])),
    [professions]
  );

  // A reminder points at a client in the month's worklist: select them and pulse
  // their card so the eye lands on it. The pulse is cleared by a timer so it can
  // never sit on the wrong card afterwards.
  const focusClientInWorklist = (id: number) => {
    setSelectedClientId(id);
    setHighlightClientId(id);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightClientId(null), 2600);
  };

  useEffect(() => {
    return () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    };
  }, []);

  // Reminders can point at the current or an adjacent month, so the completed
  // lookup covers the deadline months of every active assignment rather than the
  // month on screen alone.
  const reminderMonths = useMemo(() => {
    const now = new Date();
    const months = new Set<number>([now.getMonth() + 1]);
    for (const a of assignments) {
      if (!a.isActive) continue;
      const d = currentDeadline(a, now);
      if (d) {
        const m = Number(/^\d{4}-(\d{2})/.exec(d.dueOn)?.[1] ?? 0);
        if (m >= 1 && m <= 12) months.add(m);
      }
    }
    return [...months];
  }, [assignments]);

  const { keys: completedKeys, refresh: refreshCompletedKeys } = useCompletedKeys(
    db,
    new Date().getFullYear(),
    reminderMonths
  );

  const reports = useReports(db, year, month);

  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const desktop = useDesktopNotifications(desktopNotifications);

  const exporter = useExportReport();

  // Exports the rows the user is actually looking at, with the active filters
  // noted in the file so the numbers are traceable later.
  const handleExportCsv = async () => {
    await toasts.run(
      async () => {
        const path = await exporter.exportCsv({
          year,
          month,
          statuses: filters.filtered,
          summary: filters.summary,
          filterDescription: filters.isFiltered
            ? `ναι (${filters.filtered.length} από ${filters.totalCount})`
            : undefined,
        });
        // A dismissed save dialog is a choice, not a failure.
        if (path === null) toasts.info("Η αποθήκευση ακυρώθηκε.");
      },
      { success: "Η αναφορά αποθηκεύτηκε.", failure: "Αποτυχία εξαγωγής αναφοράς" }
    );
  };

  // Mirror the in-app reminder list into Windows notifications. The key
  // includes the due date so a new period notifies again, and completed work is
  // left out so a finished task does not keep popping up a Windows toast.
  useEffect(() => {
    const due = assignments.filter((a) => {
      if (!a.isActive) return false;
      const d = currentDeadline(a, new Date());
      if (!d) return false;
      const s = reminderState(d, new Date(), a.reminderDays);
      if (s !== "overdue" && s !== "due_soon") return false;
      const m = Number(/^\d{4}-(\d{2})/.exec(d.dueOn)?.[1] ?? 0);
      return !completedKeys.has(`${a.clientId}:${a.taskTypeId}:${m}`);
    });

    void desktop.notify(
      due,
      (a) => `${a.id}:${currentDeadline(a, new Date())?.dueOn ?? ""}`,
      (a) => {
        const d = currentDeadline(a, new Date());
        return `${a.clientName} — ${a.taskName} (${d ? describeDeadline(d) : ""})`;
      }
    );
  }, [assignments, desktop, completedKeys]);

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;

  const handleOpenClient = (id: number) => {
    setSelectedClientId(id);
    setShowClientTab(true);
  };

  const handleCloseClientTab = () => {
    setShowClientTab(false);
  };

  // Rethrows so ClientForm can show the failure inline as well as via toast,
  // and only closes the create panel when the client actually exists.
  const handleClientCreated = async (data: Parameters<typeof createClient>[0]) => {
    try {
      const id = await createClient(data);
      handleRefresh();
      handleOpenClient(id);
      toasts.success("Ο πελάτης δημιουργήθηκε.");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      toasts.error(`Αποτυχία δημιουργίας πελάτη: ${raw}`);
      throw err;
    }
  };

  const handleClientSaved = async (id: number, data: Parameters<typeof updateClient>[1]) => {
    await toasts.run(
      async () => {
        await updateClient(id, data);
        handleRefresh();
      },
      { success: "Ο πελάτης αποθηκεύτηκε.", failure: "Αποτυχία αποθήκευσης πελάτη" }
    );
  };

  const handleClientDeleted = async (id: number) => {
    await toasts.run(
      async () => {
        await deleteClient(id);
        if (selectedClientId === id) {
          setSelectedClientId(null);
          setShowClientTab(false);
        }
        handleRefresh();
      },
      { success: "Ο πελάτης διαγράφηκε.", failure: "Αποτυχία διαγραφής πελάτη" }
    );
  };

  const handleRefresh = () => {
    refreshClients();
    refreshTasks();
    refreshProfessions();
    refreshStatus();
    refreshAssignments();
    refreshCompletedKeys();
    reports.refresh();
  };

  // A restore replaces every table, so everything on screen has to reload.
  const backup = useBackup(db, handleRefresh);

  const handleBackup = async () => {
    await toasts.run(
      async () => {
        const path = await backup.backup();
        if (path === null) {
          toasts.info("Η αποθήκευση ακυρώθηκε.");
          return;
        }
        toasts.success(`Αντίγραφο αποθηκεύτηκε:\n${path}`);
      },
      { success: "", failure: "Αποτυχία δημιουργίας αντιγράφου" }
    );
  };

  const handleRestore = async () => {
    await toasts.run(
      async () => {
        const counts = await backup.restore();
        // The dialog was dismissed or the user declined the confirmation.
        if (counts === null) return;
        toasts.success(`Επαναφορά ολοκληρώθηκε (${counts.clients} πελάτες).`);
      },
      { success: "", failure: "Αποτυχία επαναφοράς" }
    );
  };

  // Any change to a client can affect its assignments, the reminders derived
  // from them, and the monthly counts - so refresh everything rather than
  // guessing which views are stale.
  const handleClientUpdated = () => {
    handleRefresh();
  };

  const handleToggleStatus = async (
    clientId: number,
    taskTypeId: number,
    completed: boolean
  ) => {
    await toasts.run(
      async () => {
        if (completed) {
          await markCompleted(clientId, taskTypeId);
        } else {
          await markPending(clientId, taskTypeId);
        }
      },
      {
        success: completed ? "Η εργασία σημειώθηκε ως ολοκληρωμένη." : "Η εργασία επανήλθε σε εκκρεμή.",
        failure: "Αποτυχία ενημέρωσης κατάστασης",
      }
    );
    // Completing a task must also retire its reminder, so the reminder list is
    // refreshed from the same event rather than on the next launch.
    refreshCompletedKeys();
  };

  // Money writes are per-row and frequent; the toast is enough feedback, and a
  // failure is also shown inline by the row itself.
  const handleSetAmount = async (clientId: number, taskTypeId: number, amount: number | null) => {
    await toasts.run(
      async () => {
        await setAmount(clientId, taskTypeId, amount);
      },
      { success: "", failure: "Αποτυχία αποθήκευσης ποσού" }
    );
  };

  const handleSetPaid = async (
    clientId: number,
    taskTypeId: number,
    isPaid: boolean,
    paidAt: string | null
  ) => {
    await toasts.run(
      async () => {
        await setPaid(clientId, taskTypeId, isPaid, paidAt);
      },
      { success: "", failure: "Αποτυχία ενημέρωσης είσπραξης" }
    );
  };

  const handleSetInvoiced = async (
    clientId: number,
    taskTypeId: number,
    isInvoiced: boolean,
    invoicedAt: string | null
  ) => {
    await toasts.run(
      async () => {
        await setInvoiced(clientId, taskTypeId, isInvoiced, invoicedAt);
      },
      { success: "", failure: "Αποτυχία ενημέρωσης τιμολογίου" }
    );
  };

  const handleTaskCreated = async (data: Pick<TaskType, "name" | "color" | "description">) => {
    await toasts.run(
      async () => {
        await createTask(data);
        handleRefresh();
      },
      { success: "Η εργασία προστέθηκε.", failure: "Αποτυχία προσθήκης εργασίας" }
    );
  };

  const handleTaskUpdated = async (id: number, data: Partial<TaskType>) => {
    await toasts.run(
      async () => {
        await updateTask(id, data);
        handleRefresh();
      },
      { success: "Η εργασία ενημερώθηκε.", failure: "Αποτυχία ενημέρωσης εργασίας" }
    );
  };

  const handleTaskDeleted = async (id: number) => {
    await toasts.run(
      async () => {
        await deleteTask(id);
        handleRefresh();
      },
      { success: "Η εργασία διαγράφηκε.", failure: "Αποτυχία διαγραφής εργασίας" }
    );
  };

  const handleProfessionCreated = async (data: {
    name: string;
    description?: string | null;
    color: string;
  }) => {
    await toasts.run(
      async () => {
        await createProfession(data);
      },
      { success: "Το επάγγελμα προστέθηκε.", failure: "Αποτυχία προσθήκης επαγγέλματος" }
    );
  };

  // A rename reaches the worklist: the row carries the profession's name, read
  // through the join, so the month's rows have to be re-read or they would keep
  // showing the old one until the month was navigated away from and back.
  const handleProfessionUpdated = async (
    id: number,
    data: Partial<Profession>
  ) => {
    await toasts.run(
      async () => {
        await updateProfession(id, data);
        refreshStatus();
      },
      { success: "Το επάγγελμα ενημερώθηκε.", failure: "Αποτυχία ενημέρωσης επαγγέλματος" }
    );
  };

  // Deleting detaches the profession from its clients, so the client list is
  // stale too - and a client that lost its profession drops out of the
  // profession filter, which is a visible change to the worklist.
  const handleProfessionDeleted = async (id: number) => {
    await toasts.run(
      async () => {
        await deleteProfession(id);
        refreshClients();
        refreshStatus();
      },
      { success: "Το επάγγελμα διαγράφηκε.", failure: "Αποτυχία διαγραφής επαγγέλματος" }
    );
  };

  if (dbLoading) {
    return <div className="app-loading">Φόρτωση βάσης δεδομένων...</div>;
  }

  if (dbError) {
    return <div className="app-error">Σφάλμα: {dbError}</div>;
  }

  if (!db) {
    return <div className="app-error">Δεν ήταν δυνατή η σύνδεση στη βάση δεδομένων</div>;
  }

  return (
    <div className="app">
      {migrationWarning && (
        <div className="migration-warning" role="alert">
          <strong>Προσοχή:</strong> {migrationWarning}
        </div>
      )}

      <header className="app-header">
        {/* Left: the file menu. Everything that leaves the app or replaces the
            whole database lives here. */}
        <FileMenu
          summary={filters.summary}
          filters={filters.filters}
          clientOptions={clientOptions}
          taskOptions={taskOptions}
          onExportCsv={handleExportCsv}
          exporting={exporter.exporting}
          onBackup={handleBackup}
          onRestore={handleRestore}
          busy={backup.busy}
        />

        {/* Right: the screens and the month they apply to. Both change what the
            app shows; neither changes the data. */}
        <div className="app-header-bar">
          <nav className="app-nav" aria-label="Κύριες λειτουργίες">
            <button
              className={activeView === "dashboard" ? "active" : ""}
              onClick={() => setActiveView("dashboard")}
            >
              Κεντρική
            </button>
            <button
              className={activeView === "tasks" ? "active" : ""}
              onClick={() => setActiveView("tasks")}
            >
              Εργασίες
            </button>
            <button
              className={activeView === "professions" ? "active" : ""}
              onClick={() => setActiveView("professions")}
            >
              Επαγγέλματα
            </button>
            <button
              className={activeView === "reports" ? "active" : ""}
              onClick={() => setActiveView("reports")}
            >
              Αναφορές
            </button>
          </nav>

          {/* Month navigation sits on the same line as the tabs but keeps its
              own bordered block, so the two read as different kinds of control:
              one changes the screen, the other changes the month inside it. */}
          <div className="month-nav-group">
            <MonthPicker
              year={year}
              month={month}
              onChange={(y, m) => setCurrentDate(new Date(y, m - 1, 1))}
            />
          </div>
        </div>
      </header>

      <main className="app-main">
        {activeView === "dashboard" && (
          <div className="dashboard">
            <div className="dashboard-content">
              <div className={`dashboard-left ${clientsCollapsed ? "collapsed" : ""}`}>
                <button
                  className="panel-collapse-toggle"
                  onClick={() => setClientsCollapsed((v) => !v)}
                  aria-expanded={!clientsCollapsed}
                  aria-controls="client-list-panel"
                  title={clientsCollapsed ? "Εμφάνιση πελατών" : "Απόκρυψη πελατών"}
                >
                  <span className="panel-collapse-caret" aria-hidden="true">
                    {clientsCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="panel-collapse-label">Πελάτες</span>
                </button>

                {!clientsCollapsed && (
                  <ClientList
                    clients={clients}
                    selectedClientId={selectedClientId}
                    onSelectClient={handleSelectClient}
                    onSearchChange={setSearchQuery}
                    searchQuery={searchQuery}
                    onCreate={handleClientCreated}
                    onOpenClient={handleOpenClient}
                    loading={clientsLoading}
                  />
                )}
              </div>

              {/* The month's worklist is the page the accountant works on,
                  so it takes the centre and the widest share of the grid;
                  export and backup sit with it because they act on this month. */}
              <div className="dashboard-center">
                <MonthlyWorklist
                  statuses={filters.filtered}
                  totalCount={filters.totalCount}
                  filters={filters.filters}
                  isFiltered={filters.isFiltered}
                  onFilterStatusChange={filters.setStatus}
                  onFilterClientSelect={filters.setClientId}
                  onFilterTaskSelect={filters.setTaskTypeId}
                  onFilterProfessionSelect={filters.setProfessionId}
                  clientOptions={clientOptions}
                  taskOptions={taskOptions}
                  professionOptions={professionOptions}
                  professionColors={professionColors}
                  onFilterReset={filters.reset}
                  year={year}
                  month={month}
                  onToggle={handleToggleStatus}
                  onSelectClient={handleSelectClient}
                  onOpenClient={handleOpenClient}
                  highlightClientId={highlightClientId}
                  onSetAmount={handleSetAmount}
                  onSetPaid={handleSetPaid}
                  onSetInvoiced={handleSetInvoiced}
                />
              </div>

              {/* Reminders and the month's summary are reference panels, not
                  the work itself, so they sit in the far-right column, out of
                  the way of the worklist. */}
              <div className="dashboard-aside">
                <Reminders
                  assignments={assignments}
                  desktopEnabled={desktopNotifications}
                  onDesktopEnabledChange={setDesktopNotifications}
                  desktopPermission={desktop.permission}
                  onRequestDesktopPermission={desktop.askForPermission}
                  completedKeys={completedKeys}
                  onFocusClient={focusClientInWorklist}
                />
                <MonthlySummary
                  summary={filters.summary}
                  year={year}
                  month={month}
                  isFiltered={filters.isFiltered}
                  totalTasks={filters.totalCount}
                />
              </div>
            </div>
          </div>
        )}

        {activeView === "tasks" && (
          <TaskCatalog
            tasks={tasks}
            usage={taskUsage}
            onCreate={handleTaskCreated}
            onUpdate={handleTaskUpdated}
            onDelete={handleTaskDeleted}
            suggestColor={suggestColor}
          />
        )}

        {activeView === "professions" && (
          <ProfessionCatalog
            professions={professions}
            clientCounts={professionClientCounts}
            onCreate={handleProfessionCreated}
            onUpdate={handleProfessionUpdated}
            onDelete={handleProfessionDeleted}
            suggestColor={suggestProfessionColor}
          />
        )}

        {activeView === "reports" && (
          <ReportsView
            groups={reports.groups}
            loading={reports.loading}
            year={year}
            month={month}
            period={reports.period}
            onPeriodChange={reports.setPeriod}
            customFrom={reports.customFrom}
            customTo={reports.customTo}
            onCustomRangeChange={reports.setCustomRange}
            isEmpty={reports.isEmpty}
          />
        )}
      </main>

      {/* Client detail lives in its own overlay so it never squeezes the
          dashboard columns. */}
      {showClientTab && selectedClient && (
        <div className="client-tab-overlay" onClick={handleCloseClientTab}>
          <div
            className="client-tab-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Καρτέλα πελάτη ${selectedClient.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <ClientTab
              db={db}
              client={selectedClient}
              tasks={tasks}
              professions={professions}
              onClose={handleCloseClientTab}
              onUpdate={handleClientUpdated}
              onDelete={handleClientDeleted}
              onSaveClient={handleClientSaved}
            />
          </div>
        </div>
      )}

      <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}

export default App;