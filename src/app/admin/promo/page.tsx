"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type PromoItem = {
  id: string;
  type: "balance" | "bonus";
  code: string;
  limit: boolean;
  amount: string;
  countUse: number;
  currentUses: number;
  active: boolean;
};

type PromoFormState = {
  code: string;
  type: "balance" | "bonus";
  limit: boolean;
  amount: string;
  countUse: string;
  active: boolean;
};

const bridge = getCasinoBridge();

const defaultForm: PromoFormState = {
  code: "",
  type: "balance",
  limit: false,
  amount: "",
  countUse: "",
  active: true,
};

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  return fallback;
};

const asBool = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
};

const asInt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const parsePromos = (payload: unknown): PromoItem[] => {
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
      const typeRaw = asString(item.type, "balance").toLowerCase();
      return {
        id: asString(item.id),
        type: typeRaw === "bonus" ? "bonus" : "balance",
        code: asString(item.code).toUpperCase(),
        limit: asBool(item.limit),
        amount: asString(item.amount, "0.00"),
        countUse: asInt(item.countUse),
        currentUses: asInt(item.currentUses),
        active: item.active === undefined ? true : asBool(item.active),
      } satisfies PromoItem;
    })
    .filter((item) => Boolean(item)) as PromoItem[];
};

const toForm = (item: PromoItem): PromoFormState => ({
  code: item.code,
  type: item.type,
  limit: item.limit,
  amount: item.amount,
  countUse: `${item.countUse}`,
  active: item.active,
});

function PromoModal(props: {
  title: string;
  submitLabel: string;
  form: PromoFormState;
  onChange: (next: PromoFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const { title, submitLabel, form, onChange, onClose, onSubmit, submitting } = props;
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
            <label>Code:</label>
            <input
              className="form-control"
              onChange={(event) => onChange({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="Code"
              type="text"
              value={form.code}
            />
          </div>
          <div className="form-group">
            <label>Type:</label>
            <select className="form-control" onChange={(event) => onChange({ ...form, type: event.target.value as "balance" | "bonus" })} value={form.type}>
              <option value="balance">Balance</option>
              <option value="bonus">Bonus</option>
            </select>
          </div>
          <div className="form-group">
            <label>Limit:</label>
            <select className="form-control" onChange={(event) => onChange({ ...form, limit: event.target.value === "1" })} value={form.limit ? "1" : "0"}>
              <option value="0">No limit</option>
              <option value="1">By count</option>
            </select>
          </div>
          <div className="form-group">
            <label>Sum:</label>
            <input
              className="form-control"
              onChange={(event) => onChange({ ...form, amount: event.target.value })}
              placeholder="Amount"
              type="number"
              value={form.amount}
            />
          </div>
          <div className="form-group">
            <label>Number of activations (If limit by count):</label>
            <input
              className="form-control"
              onChange={(event) => onChange({ ...form, countUse: event.target.value })}
              placeholder="Count"
              type="number"
              value={form.countUse}
            />
          </div>
          <div className="form-group">
            <label>Active:</label>
            <select className="form-control" onChange={(event) => onChange({ ...form, active: event.target.value === "1" })} value={form.active ? "1" : "0"}>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
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

export default function AdminPromoPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [items, setItems] = useState<PromoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<PromoItem | null>(null);
  const [form, setForm] = useState<PromoFormState>(defaultForm);

  const loadPromos = useCallback(async () => {
    setIsLoading(true);
    setStatus("");
    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setItems([]);
        setStatus("Login required for promocodes.");
        return;
      }
      const response = await bridge.getAdminPromos();
      setItems(parsePromos(response));
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPromos();
  }, [loadPromos]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadPromos();
  }, [bridgeState.isAuthenticated, loadPromos]);

  const closeModals = (): void => {
    setCreateOpen(false);
    setEditItem(null);
    setForm(defaultForm);
  };

  const parseSubmitForm = (): { amount: number; countUse: number } | null => {
    const amount = Number.parseFloat(form.amount);
    const countUse = Number.parseInt(form.countUse || "0", 10);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Amount must be a valid number.");
      return null;
    }
    if (!Number.isFinite(countUse) || countUse < 0) {
      setStatus("Count must be a valid number.");
      return null;
    }
    if (!form.code.trim()) {
      setStatus("Code cannot be empty.");
      return null;
    }
    return { amount, countUse };
  };

  const submitCreate = async (): Promise<void> => {
    const parsed = parseSubmitForm();
    if (!parsed) {
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.createAdminPromo({
        code: form.code.trim().toUpperCase(),
        type: form.type,
        limit: form.limit,
        amount: parsed.amount,
        countUse: parsed.countUse,
      });
      closeModals();
      setStatus("Promocode created.");
      await loadPromos();
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
    const parsed = parseSubmitForm();
    if (!parsed) {
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.updateAdminPromo({
        id: editItem.id,
        code: form.code.trim().toUpperCase(),
        type: form.type,
        limit: form.limit,
        amount: parsed.amount,
        countUse: parsed.countUse,
        active: form.active,
      });
      closeModals();
      setStatus("Promocode updated.");
      await loadPromos();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this promocode?")) {
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.deleteAdminPromo(id);
      setStatus("Promocode removed.");
      await loadPromos();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminShell subtitle="Promocode list" title="Promocodes">
      <div className="kt-portlet kt-portlet--mobile">
        <div className="kt-portlet__head kt-portlet__head--lg">
          <div className="kt-portlet__head-label">
            <span className="kt-portlet__head-icon">
              <i className="kt-font-brand flaticon2-menu-2" />
            </span>
            <h3 className="kt-portlet__head-title">Promocode list</h3>
          </div>
          <div className="kt-portlet__head-toolbar">
            <button
              className="btn btn-success btn-elevate btn-icon-sm"
              onClick={() => {
                setForm(defaultForm);
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
                  <th>Type</th>
                  <th>Code</th>
                  <th>Limit</th>
                  <th>Sum</th>
                  <th>Count</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.type === "balance" ? "Balance" : "Bonus"}</td>
                    <td>{item.code}</td>
                    <td>{item.limit ? "By count" : "No limit"}</td>
                    <td>{item.amount} coins</td>
                    <td>
                      {item.countUse}
                      {item.currentUses > 0 ? ` (${item.currentUses} used)` : ""}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-clean btn-icon btn-icon-md"
                        onClick={() => {
                          setEditItem(item);
                          setForm(toForm(item));
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
                    <td colSpan={7}>No promocodes found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {isLoading ? <div className="admin-message mt-3">Loading promocodes...</div> : null}
          {status ? <div className="admin-message mt-3">{status}</div> : null}
        </div>
      </div>

      {createOpen ? (
        <PromoModal
          form={form}
          onChange={setForm}
          onClose={closeModals}
          onSubmit={() => void submitCreate()}
          submitLabel="Add"
          submitting={isSubmitting}
          title="New promocode"
        />
      ) : null}

      {editItem ? (
        <PromoModal
          form={form}
          onChange={setForm}
          onClose={closeModals}
          onSubmit={() => void submitUpdate()}
          submitLabel="Save"
          submitting={isSubmitting}
          title="Edit promocode"
        />
      ) : null}
    </AdminShell>
  );
}
