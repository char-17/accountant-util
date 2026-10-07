import { useState, useEffect } from "react";
import type { TaskType } from "./domain/types";
import { useDatabase } from "./hooks/useDatabase";
import { useClients } from "./hooks/useClients";
import { useTasks } from "./hooks/useTasks";
import { useMonthlyStatus } from "./hooks/useMonthlyStatus";
import { useAssignments } from "./hooks/useAssignments";
import { MonthPicker } from "./components/MonthPicker";
import { ClientList } from "./components/ClientList";
import { MonthlySummary } from "./components/MonthlySummary";
import { ClientTab } from "./components/ClientTab";
import { TaskCatalog } from "./components/TaskCatalog";
import { ExcelImport } from "./components/ExcelImport";
import { ExportPanel } from "./components/ExportPanel";
import { BackupPanel } from "./components/BackupPanel";
import { Reminders } from "./components/Reminders";
import { MonthlyWorklist } from "./components/MonthlyWorklist";
import { Toaster } from "./components/Toaster";
import { useToasts } from "./hooks/useToasts";
import { useWorklistFilters } from "./hooks/useWorklistFilters";
import { useExportReport } from "./hooks/useExportReport";
import { useBackup } from "./hooks/useBackup";
import { useDesktopNotifications } from "./hooks/useDesktopNotifications";
import { currentDeadline, reminderState, describeDeadline } from "./domain/recurrence";
import "./App.css";

type View = "dashboard" | "tasks" | "import";

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
  const { tasks, createTask, updateTask, deleteTask, suggestColor, refresh: refreshTasks } = useTasks(db);
  const {
    statuses,
    markCompleted,
    markPending,
    refresh: refreshStatus,
  } = useMonthlyStatus(db, year, month);
  const { assignments, refresh: refreshAssignments } = useAssignments(db);

  // Search and status filters for the worklist. Derived, not queried, so typing
  // in the filter boxes never touches the database.
  // Selecting a client in the left list narrows the worklist to that client,
  // which is what "επιλογή πελάτη ενημερώνει τη σύνοψη δεξιά" asks for.
  const filters = useWorklistFilters(statuses, year, month, selectedClientId);

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
  // includes the due date so a new period notifies again.
  useEffect(() => {
    const due = assignments.filter((a) => {
      if (!a.isActive) return false;
      const d = currentDeadline(a, new Date());
      if (!d) return false;
      const s = reminderState(d, new Date(), a.reminderDays);
      return s === "overdue" || s === "due_soon";
    });

    void desktop.notify(
      due,
      (a) => `${a.id}:${currentDeadline(a, new Date())?.dueOn ?? ""}`,
      (a) => {
        const d = currentDeadline(a, new Date());
        return `${a.clientName} — ${a.taskName} (${d ? describeDeadline(d) : ""})`;
      }
    );
  }, [assignments, desktop]);

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;

  // Selecting a client only previews them; opening the tab is a separate action.
  const handleSelectClient = (id: number) => {
    setSelectedClientId(id);
  };

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
    refreshStatus();
    refreshAssignments();
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
        <h1>Accountant Util</h1>
        <nav className="app-nav">
          <button
            className={activeView === "dashboard" ? "active" : ""}
            onClick={() => setActiveView("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={activeView === "tasks" ? "active" : ""}
            onClick={() => setActiveView("tasks")}
          >
            Εργασίες
          </button>
          <button
            className={activeView === "import" ? "active" : ""}
            onClick={() => setActiveView("import")}
          >
            Εισαγωγή Excel
          </button>
        </nav>
      </header>

      <main className="app-main">
        {activeView === "dashboard" && (
          <div className="dashboard">
            <div className="dashboard-header">
              <MonthPicker
                year={year}
                month={month}
                onChange={(y, m) => setCurrentDate(new Date(y, m - 1, 1))}
              />
            </div>

            <div className="dashboard-content">
              <div className="dashboard-left">
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
              </div>

              <div className="dashboard-right">
                <Reminders
                  assignments={assignments}
                  desktopEnabled={desktopNotifications}
                  onDesktopEnabledChange={setDesktopNotifications}
                  desktopPermission={desktop.permission}
                  onRequestDesktopPermission={desktop.askForPermission}
                />
                <MonthlySummary
                  summary={filters.summary}
                  year={year}
                  month={month}
                  isFiltered={filters.isFiltered}
                  totalTasks={filters.totalCount}
                />
                <MonthlyWorklist
                  statuses={filters.filtered}
                  totalCount={filters.totalCount}
                  filters={filters.filters}
                  isFiltered={filters.isFiltered}
                  onFilterClientQueryChange={filters.setClientQuery}
                  onFilterTaskQueryChange={filters.setTaskQuery}
                  onFilterStatusChange={filters.setStatus}
                  onFilterReset={filters.reset}
                  year={year}
                  month={month}
                  onToggle={handleToggleStatus}
                  onSelectClient={handleOpenClient}
                />
                <ExportPanel
                  summary={filters.summary}
                  filters={filters.filters}
                  onExportCsv={handleExportCsv}
                  exporting={exporter.exporting}
                />
                <BackupPanel
                  onBackup={handleBackup}
                  onRestore={handleRestore}
                  busy={backup.busy}
                />
              </div>
            </div>
          </div>
        )}

        {activeView === "tasks" && (
          <TaskCatalog
            tasks={tasks}
            onCreate={handleTaskCreated}
            onUpdate={handleTaskUpdated}
            onDelete={handleTaskDeleted}
            suggestColor={suggestColor}
          />
        )}

        {activeView === "import" && (
          <ExcelImport db={db} onImportComplete={handleRefresh} />
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
