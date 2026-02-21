"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type BonusItem = {
  id: string;
  type: "group" | "refs";
  sum: string;
  status: boolean;
  bg: string;
  color: string;
};

type BonusFormState = {
  sum: string;
  type: "group" | "refs";
  status: boolean;
  bg: string;
  color: string;
};

const bridge = getCasinoBridge();

const defaultForm: BonusFormState = {
  sum: "",
  type: "group",
  status: true,
  bg: "#ffffff",
  color: "#000000",
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

const parseBonusItems = (payload: unknown): BonusItem[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const root = payload as { data?: unknown; items?: unknown };
  const body =
    root.data && typeof root.data === "object"
      ? (root.data as { items?: unknown })
      : root;
  const rows = Array.isArray(body.items) ? body.items : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      const typeRaw = asString(item.type, "group").toLowerCase();
      return {
        id: asString(item.id),
        type: typeRaw === "refs" ? "refs" : "group",
        sum: asString(item.sum, "0.00"),
        status: asBool(item.status),
        bg: asString(item.bg, "#ffffff"),
        color: asString(item.color, "#000000"),
      } satisfies BonusItem;
    })
    .filter((item) => Boolean(item)) as BonusItem[];
};

const toFormState = (item: BonusItem): BonusFormState => ({
  sum: item.sum,
  type: item.type,
  status: item.status,
  bg: item.bg,
  color: item.color,
});

function BonusModal(props: {
  title: string;
  submitLabel: string;
  form: BonusFormState;
  onChange: (next: BonusFormState) => void;
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
            <label>Sum:</label>
            <input
              className="form-control"
              onChange={(event) => onChange({ ...form, sum: event.target.value })}
              placeholder="Sum"
              type="number"
              value={form.sum}
            />
          </div>
          <div className="form-group">
            <label>Type:</label>
            <select className="form-control" onChange={(event) => onChange({ ...form, type: event.target.value as "group" | "refs" })} value={form.type}>
              <option value="group">Timed</option>
              <option value="refs">Referral`s</option>
            </select>
          </div>
          <div className="form-group">
            <label>Background color:</label>
            <input
              className="form-control"
              onChange={(event) => onChange({ ...form, bg: event.target.value })}
              placeholder="#000000"
              type="text"
              value={form.bg}
            />
          </div>
          <div className="form-group">
            <label>Text color:</label>
            <input
              className="form-control"
              onChange={(event) => onChange({ ...form, color: event.target.value })}
              placeholder="#ffffff"
              type="text"
              value={form.color}
            />
          </div>
          <div className="form-group">
            <label>Example:</label>
            <div style={{ background: form.bg, color: form.color, fontWeight: 600, textAlign: "center", padding: "4px 0" }}>Text</div>
          </div>
          <div className="form-group">
            <label>Drop?:</label>
            <select className="form-control" onChange={(event) => onChange({ ...form, status: event.target.value === "1" })} value={form.status ? "1" : "0"}>
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

export default function AdminBonusPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [items, setItems] = useState<BonusItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<BonusItem | null>(null);
  const [form, setForm] = useState<BonusFormState>(defaultForm);

  const loadBonuses = useCallback(async () => {
    setIsLoading(true);
    setStatus("");
    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setItems([]);
        setStatus("Login required for bonuses.");
        return;
      }
      const response = await bridge.getAdminBonuses();
      setItems(parseBonusItems(response));
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBonuses();
  }, [loadBonuses]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadBonuses();
  }, [bridgeState.isAuthenticated, loadBonuses]);

  const closeModals = (): void => {
    setCreateOpen(false);
    setEditItem(null);
    setForm(defaultForm);
  };

  const submitCreate = async (): Promise<void> => {
    const sum = Number.parseFloat(form.sum);
    if (!Number.isFinite(sum) || sum < 0) {
      setStatus("Sum must be a valid number.");
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.createAdminBonus({
        sum,
        type: form.type,
        status: form.status,
        bg: form.bg.trim() || "#ffffff",
        color: form.color.trim() || "#000000",
      });
      closeModals();
      setStatus("Bonus created.");
      await loadBonuses();
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
    const sum = Number.parseFloat(form.sum);
    if (!Number.isFinite(sum) || sum < 0) {
      setStatus("Sum must be a valid number.");
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.updateAdminBonus({
        id: editItem.id,
        sum,
        type: form.type,
        status: form.status,
        bg: form.bg.trim() || "#ffffff",
        color: form.color.trim() || "#000000",
      });
      closeModals();
      setStatus("Bonus updated.");
      await loadBonuses();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this bonus?")) {
      return;
    }
    setIsSubmitting(true);
    setStatus("");
    try {
      await bridge.deleteAdminBonus(id);
      setStatus("Bonus removed.");
      await loadBonuses();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminShell subtitle="Bonus list" title="Bonuses">
      <div className="kt-portlet kt-portlet--mobile">
        <div className="kt-portlet__head kt-portlet__head--lg">
          <div className="kt-portlet__head-label">
            <span className="kt-portlet__head-icon">
              <i className="kt-font-brand flaticon2-gift-1" />
            </span>
            <h3 className="kt-portlet__head-title">Bonus list</h3>
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
                  <th>Type</th>
                  <th>Sum</th>
                  <th>Drop?</th>
                  <th>Color</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.type === "group" ? "Timed" : "Referral`s"}</td>
                    <td>{item.sum}$</td>
                    <td>{item.status ? "Yes" : "No"}</td>
                    <td>
                      <div style={{ background: item.bg, color: item.color, fontWeight: 600, textAlign: "center", padding: "3px 0" }}>
                        Text
                      </div>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-clean btn-icon btn-icon-md"
                        onClick={() => {
                          setEditItem(item);
                          setForm(toFormState(item));
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
                    <td colSpan={5}>No bonuses found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {isLoading ? <div className="admin-message mt-3">Loading bonuses...</div> : null}
          {status ? <div className="admin-message mt-3">{status}</div> : null}
        </div>
      </div>

      {createOpen ? (
        <BonusModal
          form={form}
          onChange={setForm}
          onClose={closeModals}
          onSubmit={() => void submitCreate()}
          submitLabel="Add"
          submitting={isSubmitting}
          title="New bonus"
        />
      ) : null}

      {editItem ? (
        <BonusModal
          form={form}
          onChange={setForm}
          onClose={closeModals}
          onSubmit={() => void submitUpdate()}
          submitLabel="Save"
          submitting={isSubmitting}
          title="Edit bonus"
        />
      ) : null}
    </AdminShell>
  );
}
