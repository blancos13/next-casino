"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type AdminWithdrawItem = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  system: string;
  wallet: string;
  value: string;
  status: number;
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

const asInt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return 0;
};

const parseWithdrawItem = (value: unknown): AdminWithdrawItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    username: asString(row.username, "User"),
    avatar: asString(row.avatar, "/img/no_avatar.jpg"),
    system: asString(row.system, "-"),
    wallet: asString(row.wallet, "-"),
    value: asString(row.value, "0.00"),
    status: asInt(row.status),
  };
};

const parseWithdrawsPayload = (payload: unknown): { active: AdminWithdrawItem[]; done: AdminWithdrawItem[] } => {
  if (!payload || typeof payload !== "object") {
    return { active: [], done: [] };
  }
  const root = payload as { data?: unknown; active?: unknown; done?: unknown };
  const body = root.data && typeof root.data === "object" ? (root.data as { active?: unknown; done?: unknown }) : root;

  const mapList = (value: unknown): AdminWithdrawItem[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map(parseWithdrawItem).filter((item): item is AdminWithdrawItem => item !== null);
  };

  return {
    active: mapList(body.active),
    done: mapList(body.done),
  };
};

export default function AdminWithdrawsPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [activeItems, setActiveItems] = useState<AdminWithdrawItem[]>([]);
  const [doneItems, setDoneItems] = useState<AdminWithdrawItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [busyRowId, setBusyRowId] = useState("");
  const [copiedRowId, setCopiedRowId] = useState("");
  const [acceptModalItem, setAcceptModalItem] = useState<AdminWithdrawItem | null>(null);
  const [acceptTxHash, setAcceptTxHash] = useState("");
  const [returnModalItem, setReturnModalItem] = useState<AdminWithdrawItem | null>(null);
  const [returnReason, setReturnReason] = useState("");

  const shortenWallet = (wallet: string): string => {
    const text = wallet.trim();
    if (!text || text === "-" || text.length <= 12) {
      return text || "-";
    }
    return `${text.slice(0, 9)}...`;
  };

  const handleCopyWallet = async (item: AdminWithdrawItem): Promise<void> => {
    const wallet = item.wallet.trim();
    if (!wallet || wallet === "-") {
      return;
    }
    try {
      await navigator.clipboard.writeText(wallet);
      setCopiedRowId(item.id);
      window.setTimeout(() => {
        setCopiedRowId((prev) => (prev === item.id ? "" : prev));
      }, 1200);
    } catch {
      setStatus("Could not copy wallet address.");
    }
  };

  const loadWithdraws = useCallback(async () => {
    setIsLoading(true);
    setStatus("");
    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setActiveItems([]);
        setDoneItems([]);
        setStatus("Login required for withdraws.");
        return;
      }
      const response = await bridge.getAdminWithdraws();
      const parsed = parseWithdrawsPayload(response);
      setActiveItems(parsed.active);
      setDoneItems(parsed.done);
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWithdraws();
  }, [loadWithdraws]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadWithdraws();
  }, [bridgeState.isAuthenticated, loadWithdraws]);

  const openAcceptModal = (item: AdminWithdrawItem): void => {
    setAcceptModalItem(item);
    setAcceptTxHash("");
    setStatus("");
  };

  const closeAcceptModal = (): void => {
    if (acceptModalItem && busyRowId === acceptModalItem.id) {
      return;
    }
    setAcceptModalItem(null);
    setAcceptTxHash("");
  };

  const openReturnModal = (item: AdminWithdrawItem): void => {
    setReturnModalItem(item);
    setReturnReason("");
    setStatus("");
  };

  const closeReturnModal = (): void => {
    if (returnModalItem && busyRowId === returnModalItem.id) {
      return;
    }
    setReturnModalItem(null);
    setReturnReason("");
  };

  const handleAccept = async (): Promise<void> => {
    if (!acceptModalItem) {
      return;
    }
    const txHash = acceptTxHash.trim();
    if (!txHash) {
      setStatus("Tx hash is required.");
      return;
    }
    setBusyRowId(acceptModalItem.id);
    setStatus("");
    try {
      await bridge.acceptAdminWithdraw(acceptModalItem.id, txHash);
      setStatus(`Withdraw #${acceptModalItem.id} accepted.`);
      setAcceptModalItem(null);
      setAcceptTxHash("");
      await loadWithdraws();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setBusyRowId("");
    }
  };

  const handleReturn = async (): Promise<void> => {
    if (!returnModalItem) {
      return;
    }
    const reason = returnReason.trim();
    if (!reason) {
      setStatus("Return reason is required.");
      return;
    }
    setBusyRowId(returnModalItem.id);
    setStatus("");
    try {
      await bridge.returnAdminWithdraw(returnModalItem.id, reason);
      setStatus(`Withdraw #${returnModalItem.id} returned.`);
      setReturnModalItem(null);
      setReturnReason("");
      await loadWithdraws();
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setBusyRowId("");
    }
  };

  return (
    <AdminShell subtitle="Withdraw queue" title="Withdraws">
      <div className="mb-3">
        {!bridgeState.isAuthenticated ? (
          <button className="btn btn-primary btn-sm mr-2" onClick={() => bridge.openAuthDialog("login")} type="button">
            Login
          </button>
        ) : (
          <button className="btn btn-primary btn-sm mr-2" onClick={() => void loadWithdraws()} type="button">
            Refresh
          </button>
        )}
      </div>

      <div className="kt-portlet kt-portlet--mobile">
        <div className="kt-portlet__head kt-portlet__head--lg">
          <div className="kt-portlet__head-label">
            <span className="kt-portlet__head-icon">
              <i className="kt-font-brand flaticon2-information" />
            </span>
            <h3 className="kt-portlet__head-title">Active</h3>
          </div>
        </div>
        <div className="kt-portlet__body">
          <div className="table-responsive">
            <table className="table table-striped- table-bordered table-hover table-checkable" id="dtable">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Sum</th>
                  <th className="admin-col-system">System</th>
                  <th className="admin-col-wallet">Wallet</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map((item) => {
                  const rowBusy = busyRowId === item.id;
                  return (
                    <tr key={`active-${item.id}`}>
                      <td>
                        <Link className="admin-withdraw-user" href={item.userId ? `/admin/user/${item.userId}` : "/admin/users"}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={item.username} src={item.avatar} />
                          <span>{item.username}</span>
                        </Link>
                      </td>
                      <td>{item.value}$</td>
                      <td className="admin-col-system">{item.system}</td>
                      <td className="admin-col-wallet">
                        <div className="admin-wallet-cell">
                          <span className="admin-wallet-text" title={item.wallet}>
                            {shortenWallet(item.wallet)}
                          </span>
                          <button
                            className="btn btn-outline-secondary btn-sm admin-wallet-copy"
                            disabled={!item.wallet || item.wallet === "-"}
                            onClick={() => void handleCopyWallet(item)}
                            type="button"
                          >
                            {copiedRowId === item.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="admin-withdraw-actions">
                          <button className="btn btn-success btn-sm" disabled={rowBusy} onClick={() => openAcceptModal(item)} type="button">
                            {rowBusy ? "..." : "Accept"}
                          </button>
                          <button className="btn btn-danger btn-sm" disabled={rowBusy} onClick={() => openReturnModal(item)} type="button">
                            {rowBusy ? "..." : "Return"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && activeItems.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No active withdraw requests.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="kt-portlet kt-portlet--mobile">
        <div className="kt-portlet__head kt-portlet__head--lg">
          <div className="kt-portlet__head-label">
            <span className="kt-portlet__head-icon">
              <i className="kt-font-brand flaticon2-checkmark" />
            </span>
            <h3 className="kt-portlet__head-title">Done</h3>
          </div>
        </div>
        <div className="kt-portlet__body">
          <div className="table-responsive">
            <table className="table table-striped- table-bordered table-hover table-checkable" id="dtable2">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Sum</th>
                  <th className="admin-col-system">System</th>
                  <th className="admin-col-wallet">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {doneItems.map((item) => (
                  <tr key={`done-${item.id}`}>
                    <td>
                      <Link className="admin-withdraw-user" href={item.userId ? `/admin/user/${item.userId}` : "/admin/users"}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={item.username} src={item.avatar} />
                        <span>{item.username}</span>
                      </Link>
                    </td>
                    <td>{item.value}$</td>
                    <td className="admin-col-system">{item.system}</td>
                    <td className="admin-col-wallet">
                      <div className="admin-wallet-cell">
                        <span className="admin-wallet-text" title={item.wallet}>
                          {shortenWallet(item.wallet)}
                        </span>
                        <button
                          className="btn btn-outline-secondary btn-sm admin-wallet-copy"
                          disabled={!item.wallet || item.wallet === "-"}
                          onClick={() => void handleCopyWallet(item)}
                          type="button"
                        >
                          {copiedRowId === item.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && doneItems.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No finished withdraws yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isLoading ? <div className="admin-message mt-3">Loading withdraws...</div> : null}
      {status ? <div className="admin-message mt-3">{status}</div> : null}

      {acceptModalItem ? (
        <>
          <div aria-hidden="false" className="modal fade show" role="dialog" style={{ display: "block" }}>
            <div className="modal-dialog modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Accept withdraw</h5>
                  <button aria-label="Close" className="close" disabled={busyRowId === acceptModalItem.id} onClick={closeAcceptModal} type="button">
                    <span aria-hidden="true">&times;</span>
                  </button>
                </div>
                <div className="modal-body">
                  <div className="form-group mb-0">
                    <label>Tx hash</label>
                    <input
                      autoFocus
                      className="form-control"
                      onChange={(event) => setAcceptTxHash(event.target.value)}
                      placeholder="Enter transaction hash"
                      type="text"
                      value={acceptTxHash}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" disabled={busyRowId === acceptModalItem.id} onClick={closeAcceptModal} type="button">
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busyRowId === acceptModalItem.id || acceptTxHash.trim().length === 0}
                    onClick={() => void handleAccept()}
                    type="button"
                  >
                    {busyRowId === acceptModalItem.id ? "..." : "OK"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" onClick={closeAcceptModal} />
        </>
      ) : null}

      {returnModalItem ? (
        <>
          <div aria-hidden="false" className="modal fade show" role="dialog" style={{ display: "block" }}>
            <div className="modal-dialog modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Return withdraw</h5>
                  <button aria-label="Close" className="close" disabled={busyRowId === returnModalItem.id} onClick={closeReturnModal} type="button">
                    <span aria-hidden="true">&times;</span>
                  </button>
                </div>
                <div className="modal-body">
                  <div className="form-group mb-0">
                    <label>Return reason</label>
                    <input
                      autoFocus
                      className="form-control"
                      onChange={(event) => setReturnReason(event.target.value)}
                      placeholder="Enter reason"
                      type="text"
                      value={returnReason}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" disabled={busyRowId === returnModalItem.id} onClick={closeReturnModal} type="button">
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busyRowId === returnModalItem.id || returnReason.trim().length === 0}
                    onClick={() => void handleReturn()}
                    type="button"
                  >
                    {busyRowId === returnModalItem.id ? "..." : "OK"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" onClick={closeReturnModal} />
        </>
      ) : null}
    </AdminShell>
  );
}
