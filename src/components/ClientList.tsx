import { useState } from "react";
import type { Client } from "../domain/types";
import type { ClientInput } from "../hooks/useClients";
import { ClientForm } from "./ClientForm";

interface ClientListProps {
  clients: Client[];
  selectedClientId: number | null;
  onSelectClient: (id: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreate: (data: ClientInput) => Promise<void>;
  onOpenClient: (id: number) => void;
  loading?: boolean;
}

export function ClientList({
  clients,
  selectedClientId,
  onSelectClient,
  searchQuery,
  onSearchChange,
  onCreate,
  onOpenClient,
  loading,
}: ClientListProps) {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="client-list" id="client-list-panel">
      <div className="client-search">
        <input
          type="search"
          placeholder="Αναζήτηση πελάτη..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Αναζήτηση πελάτη"
        />
        <button
          className="btn-add-client"
          onClick={() => setIsAdding(true)}
        >
          + Νέος πελάτης
        </button>
      </div>

      {isAdding && (
        <div className="modal-backdrop" onClick={() => setIsAdding(false)}>
          <div
            className="modal client-create-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Νέος πελάτης"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Νέος πελάτης</h3>
            <ClientForm
              submitLabel="Προσθήκη"
              resetOnSuccess={false}
              onSubmit={async (data) => {
                // Rethrow on failure so the form can show it inline; only
                // close the dialog once the client really exists.
                await onCreate(data);
                setIsAdding(false);
              }}
              onCancel={() => setIsAdding(false)}
            />
          </div>
        </div>
      )}

      <div className="client-items">
        {loading ? (
          <p className="empty-message">Φόρτωση...</p>
        ) : clients.length === 0 ? (
          <p className="empty-message">
            {searchQuery ? "Δεν βρέθηκαν πελάτες" : "Δεν υπάρχουν πελάτες ακόμα"}
          </p>
        ) : (
          clients.map((client) => (
            // Double click opens the full tab; single click just previews.
            <div
              key={client.id}
              className={`client-item ${selectedClientId === client.id ? "selected" : ""}`}
              onClick={() => onSelectClient(client.id)}
              onDoubleClick={() => onOpenClient(client.id)}
              title="Άνοιγμα καρτέλας με διπλό κλικ"
            >
              <span className="client-name">{client.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
