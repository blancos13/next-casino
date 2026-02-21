"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type FilterItem = {
  id: string;
  word: string;
};

const bridge = getCasinoBridge();

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  return fallback;
};

const parseFilterItems = (payload: unknown): FilterItem[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const root = payload as { data?: unknown; items?: unknown };
  const body = root.data && typeof root.data === "object" ? (root.data as { items?: unknown }) : root;
  const rows = Array.isArray(body.items) ? body.items : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      return {
        id: asString(item.id),
        word: asString(item.word),
      } satisfies FilterItem;
    })
    .filter((item) => Boolean(item)) as FilterItem[];
};

function FilterModal(props: {
  title: string;
  submitLabel: string;
  word: string;
  onWordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const { title, submitLabel, word, onWordChange, onClose, onSubmit, submitting } = props;
  return (
    <>
      <div aria-hidden="false" className="modal fade show" role="dialog" style={{ display: "block" }}>
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button aria-label="Close" className="close" onClick={onClose} type="button">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="modal-body">
          <div className="form-group">
            <label>Filter:</label>
            <input className="form-control" onChange={(event) => onWordChange(event.target.value)} placeholder="Filter" type="text" value={word} />
          </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose} type="button">
                Close
              </button>
              <button className="btn btn-primary" disabled={submitting} onClick={onSubmit} type="button">
                {submitting ? "..." : submitLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" onClick={onClose} />
    </>
  );
}

export default function AdminFilterPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [items, setItems] = useState<FilterItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<FilterItem | null>(null);
  const [word, setWord] = useState("");

  const loadFilters = useCallback(async () => {
    setIsLoading(true);
    setStatus("");
    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setItems([]);
        setStatus("Login required for filters.");
        return;
      }
      const response = await bridge.getAdminFilters();
      setItems(parseFilterItems(response));
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadFilters();
  }, [bridgeState.isAuthenticated, loadFilters]);

  const closeModals = (): void => {
    setCreateOpen(false);
    setEditItem(null);
    setWord("");
  };

  const submitCreate = async (): Promise<void> => {
    const value = word.trim();
    if (!value) {
      setStatus("Filter cannot be empty.");
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.createAdminFilter(value);
      closeModals();
      setStatus("Filter created.");
      await loadFilters();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitUpdate = async (): Promise<void> => {
    if (!editItem) {
      return;
    }
    const value = word.trim();
    if (!value) {
      setStatus("Filter cannot be empty.");
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.updateAdminFilter({ id: editItem.id, word: value });
      closeModals();
      setStatus("Filter updated.");
      await loadFilters();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this filter?")) {
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.deleteAdminFilter(id);
      setStatus("Filter removed.");
      await loadFilters();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminShell subtitle="Filter list" title="Words filter">
      <div className="kt-portlet kt-portlet--mobile">
        <div className="kt-portlet__head kt-portlet__head--lg">
          <div className="kt-portlet__head-label">
            <span className="kt-portlet__head-icon">
              <i className="kt-font-brand flaticon2-protected" />
            </span>
            <h3 className="kt-portlet__head-title">Filter list</h3>
          </div>
          <div className="kt-portlet__head-toolbar">
            <button
              className="btn btn-success btn-elevate btn-icon-sm"
              onClick={() => {
                setWord("");
                setCreateOpen(true);
              }}
              type="button"
            >
              <i className="la la-plus" />
              Add
            </button>
          </div>
        </div>
        <div className="kt-portlet__body">
          <div className="table-responsive">
            <table className="table table-striped- table-bordered table-hover table-checkable" id="dtable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Filter</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.word}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-clean btn-icon btn-icon-md"
                        onClick={() => {
                          setEditItem(item);
                          setWord(item.word);
                        }}
                        title="Edit"
                        type="button"
                      >
                        <i className="la la-edit" />
                      </button>
                      <button className="btn btn-sm btn-clean btn-icon btn-icon-md" onClick={() => void handleDelete(item.id)} title="Delete" type="button">
                        <i className="la la-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!isLoading && items.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No filters found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {isLoading ? <div className="admin-message mt-3">Loading filters...</div> : null}
          {status ? <div className="admin-message mt-3">{status}</div> : null}
        </div>
      </div>

      {createOpen ? (
        <FilterModal
          onClose={closeModals}
          onSubmit={() => void submitCreate()}
          onWordChange={setWord}
          submitLabel="Add"
          submitting={isSubmitting}
          title="New filter"
          word={word}
        />
      ) : null}

      {editItem ? (
        <FilterModal
          onClose={closeModals}
          onSubmit={() => void submitUpdate()}
          onWordChange={setWord}
          submitLabel="Save"
          submitting={isSubmitting}
          title="Edit filter"
          word={word}
        />
      ) : null}
    </AdminShell>
  );
}
