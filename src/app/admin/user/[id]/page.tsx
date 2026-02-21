"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type AdminUserFinancialStat = {
  win: string;
  lose: string;
};

type AdminUserDetail = {
  id: string;
  username: string;
  avatar: string;
  email: string;
  ip: string;
  balance: string;
  bonus: string;
  role: "admin" | "moder" | "youtuber" | "user";
  ban: boolean;
  banReason: string;
  chatBanUntil: number | null;
  chatBanReason: string;
  payments: {
    deposit: string;
    withdraw: string;
    exchanges: string;
  };
  stats: {
    jackpot: AdminUserFinancialStat;
    wheel: AdminUserFinancialStat;
    crash: AdminUserFinancialStat;
    coinflip: AdminUserFinancialStat;
    battle: AdminUserFinancialStat;
    dice: AdminUserFinancialStat;
    total: AdminUserFinancialStat;
  };
  createdAt: number | null;
  updatedAt: number | null;
};

const bridge = getCasinoBridge();

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
};

const asBoolean = (value: unknown): boolean => {
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

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const asRole = (value: unknown): AdminUserDetail["role"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "admin" || normalized === "moder" || normalized === "youtuber") {
    return normalized;
  }
  return "user";
};

const asStat = (value: unknown): AdminUserFinancialStat => {
  if (!value || typeof value !== "object") {
    return { win: "0.00", lose: "0.00" };
  }
  const row = value as Record<string, unknown>;
  return {
    win: asString(row.win, "0.00"),
    lose: asString(row.lose, "0.00"),
  };
};

const parseUserDetail = (payload: unknown): AdminUserDetail | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const root = payload as { data?: unknown };
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : (payload as Record<string, unknown>);

  const statsRaw = data.stats && typeof data.stats === "object" ? (data.stats as Record<string, unknown>) : {};
  const paymentsRaw =
    data.payments && typeof data.payments === "object" ? (data.payments as Record<string, unknown>) : {};

  return {
    id: asString(data.id),
    username: asString(data.username, "User"),
    avatar: asString(data.avatar, "/img/no_avatar.jpg"),
    email: asString(data.email),
    ip: asString(data.ip, "-"),
    balance: asString(data.balance, "0.00"),
    bonus: asString(data.bonus, "0.00"),
    role: asRole(data.role),
    ban: asBoolean(data.ban),
    banReason: asString(data.banReason),
    chatBanUntil: asNumber(data.chatBanUntil),
    chatBanReason: asString(data.chatBanReason),
    payments: {
      deposit: asString(paymentsRaw.deposit, "0.00"),
      withdraw: asString(paymentsRaw.withdraw, "0.00"),
      exchanges: asString(paymentsRaw.exchanges, "0.00"),
    },
    stats: {
      jackpot: asStat(statsRaw.jackpot),
      wheel: asStat(statsRaw.wheel),
      crash: asStat(statsRaw.crash),
      coinflip: asStat(statsRaw.coinflip),
      battle: asStat(statsRaw.battle),
      dice: asStat(statsRaw.dice),
      total: asStat(statsRaw.total),
    },
    createdAt: asNumber(data.createdAt),
    updatedAt: asNumber(data.updatedAt),
  };
};

const formatDate = (timestampMs: number | null): string => {
  if (!timestampMs) {
    return "-";
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
};

const toDateTimeLocal = (timestampSec: number | null): string => {
  if (!timestampSec) {
    return "";
  }
  const date = new Date(timestampSec * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

export default function AdminUserPage() {
  const params = useParams<{ id: string }>();
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const userId = useMemo(() => {
    const raw = params?.id;
    return typeof raw === "string" ? raw : "";
  }, [params?.id]);

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [balanceInput, setBalanceInput] = useState("");
  const [bonusInput, setBonusInput] = useState("");
  const [roleInput, setRoleInput] = useState<AdminUserDetail["role"]>("user");
  const [banInput, setBanInput] = useState(false);
  const [banReasonInput, setBanReasonInput] = useState("");
  const [chatBanUntilInput, setChatBanUntilInput] = useState("");
  const [chatBanReasonInput, setChatBanReasonInput] = useState("");

  const applyDetailToForm = useCallback((next: AdminUserDetail) => {
    setBalanceInput(next.balance);
    setBonusInput(next.bonus);
    setRoleInput(next.role);
    setBanInput(next.ban);
    setBanReasonInput(next.banReason);
    setChatBanUntilInput(toDateTimeLocal(next.chatBanUntil));
    setChatBanReasonInput(next.chatBanReason);
  }, []);

  const loadUser = useCallback(
    async (targetUserId: string) => {
      if (!targetUserId) {
        setStatus("User id is missing.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setStatus("");
      try {
        await bridge.ensureReady();
        if (!bridge.getState().isAuthenticated) {
          setDetail(null);
          setStatus("Login required for admin user details.");
          return;
        }
        const response = await bridge.getAdminUser(targetUserId);
        const parsed = parseUserDetail(response);
        if (!parsed) {
          setDetail(null);
          setStatus("Could not parse user detail.");
          return;
        }
        setDetail(parsed);
        applyDetailToForm(parsed);
      } catch (error) {
        setDetail(null);
        setStatus(toWsError(error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [applyDetailToForm],
  );

  useEffect(() => {
    void loadUser(userId);
  }, [loadUser, userId]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated || !userId) {
      return;
    }
    void loadUser(userId);
  }, [bridgeState.isAuthenticated, loadUser, userId]);

  const canSave = Boolean(detail) && !isLoading && !isSaving;
  const formDisabled = !detail || isLoading || isSaving;

  const handleSave = useCallback(() => {
    if (!detail) {
      setStatus("User data is not loaded yet.");
      return;
    }

    const balance = Number.parseFloat(balanceInput);
    const bonus = Number.parseFloat(bonusInput);
    if (!Number.isFinite(balance) || balance < 0 || !Number.isFinite(bonus) || bonus < 0) {
      setStatus("Balance and bonus must be valid numbers.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    const chatBanUntil = chatBanUntilInput.trim().length > 0 ? new Date(chatBanUntilInput).toISOString() : null;
    void bridge
      .updateAdminUser({
        userId: detail.id,
        balance,
        bonus,
        role: roleInput,
        ban: banInput,
        banReason: banReasonInput,
        chatBanUntil,
        chatBanReason: chatBanReasonInput,
      })
      .then((response) => {
        const parsed = parseUserDetail(response);
        if (!parsed) {
          setStatus("Saved, but failed to parse updated user.");
          return;
        }
        setDetail(parsed);
        applyDetailToForm(parsed);
        setStatus("User saved.");
      })
      .catch((error) => {
        setStatus(toWsError(error).message);
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [
    applyDetailToForm,
    balanceInput,
    banInput,
    banReasonInput,
    bonusInput,
    chatBanReasonInput,
    chatBanUntilInput,
    detail,
    roleInput,
  ]);

  const gameRows: Array<{ key: keyof AdminUserDetail["stats"]; label: string }> = [
    { key: "jackpot", label: "Jackpot" },
    { key: "wheel", label: "Wheel" },
    { key: "crash", label: "Crash" },
    { key: "coinflip", label: "Coinflip" },
    { key: "battle", label: "Battle" },
    { key: "dice", label: "Dice" },
    { key: "total", label: "Total" },
  ];

  return (
    <AdminShell subtitle="User details" title={userId ? `User #${userId}` : "User"}>
      <div className="admin-user-layout">
        <section className="admin-user-card">
          <div className="admin-user-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={detail?.username ?? "User"} src={detail?.avatar ?? "/img/no_avatar.jpg"} />
            <div>
              <h2>{detail?.username ?? "-"}</h2>
              <div className="admin-user-meta">{detail?.email || "No email"}</div>
              <div className="admin-user-meta">IP: {detail?.ip ?? "-"}</div>
            </div>
          </div>

          <div className="admin-user-stats-grid">
            <div className="admin-card">
              <div className="admin-card__label">Deposit Amount</div>
              <div className="admin-card__value">{detail?.payments.deposit ?? "0.00"}$</div>
            </div>
            <div className="admin-card">
              <div className="admin-card__label">Withdraw Amount</div>
              <div className="admin-card__value">{detail?.payments.withdraw ?? "0.00"}$</div>
            </div>
            <div className="admin-card">
              <div className="admin-card__label">Exchanges</div>
              <div className="admin-card__value">{detail?.payments.exchanges ?? "0.00"}$</div>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Win</th>
                  <th>Lose</th>
                </tr>
              </thead>
              <tbody>
                {gameRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{detail?.stats[row.key].win ?? "0.00"}$</td>
                    <td>{detail?.stats[row.key].lose ?? "0.00"}$</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-user-meta">Created: {formatDate(detail?.createdAt ?? null)}</div>
          <div className="admin-user-meta">Updated: {formatDate(detail?.updatedAt ?? null)}</div>
        </section>

        <section className="admin-user-form">
          <div className="admin-user-form-toolbar">
            <button className="btn btn-primary btn-sm" disabled={!canSave} onClick={() => handleSave()} type="button">
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              disabled={isLoading || !userId}
              onClick={() => {
                void loadUser(userId);
              }}
              type="button"
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="admin-form-grid">
            <label>
              <span>Username</span>
              <input className="form-control form-control-sm" disabled type="text" value={detail?.username ?? ""} />
            </label>
            <label>
              <span>Email</span>
              <input className="form-control form-control-sm" disabled type="text" value={detail?.email ?? ""} />
            </label>
            <label>
              <span>IP</span>
              <input className="form-control form-control-sm" disabled type="text" value={detail?.ip ?? ""} />
            </label>
            <label>
              <span>Balance</span>
              <input
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setBalanceInput(event.target.value)}
                step="0.01"
                type="number"
                value={balanceInput}
              />
            </label>
            <label>
              <span>Bonus</span>
              <input
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setBonusInput(event.target.value)}
                step="0.01"
                type="number"
                value={bonusInput}
              />
            </label>
            <label>
              <span>Role</span>
              <select
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setRoleInput(event.target.value as AdminUserDetail["role"])}
                value={roleInput}
              >
                <option value="admin">Admin</option>
                <option value="moder">Moder</option>
                <option value="youtuber">YouTuber</option>
                <option value="user">User</option>
              </select>
            </label>
            <label>
              <span>Banned On Site</span>
              <select
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setBanInput(event.target.value === "1")}
                value={banInput ? "1" : "0"}
              >
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </label>
            <label>
              <span>Ban Reason</span>
              <input
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setBanReasonInput(event.target.value)}
                type="text"
                value={banReasonInput}
              />
            </label>
            <label>
              <span>Chat Ban Until</span>
              <input
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setChatBanUntilInput(event.target.value)}
                type="datetime-local"
                value={chatBanUntilInput}
              />
            </label>
            <label>
              <span>Chat Ban Reason</span>
              <input
                className="form-control form-control-sm"
                disabled={formDisabled}
                onChange={(event) => setChatBanReasonInput(event.target.value)}
                type="text"
                value={chatBanReasonInput}
              />
            </label>
          </div>

          <div className="admin-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={!canSave}
              onClick={() => handleSave()}
              type="button"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              disabled={isLoading || !userId}
              onClick={() => {
                void loadUser(userId);
              }}
              type="button"
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
            {!bridgeState.isAuthenticated ? (
              <button className="btn btn-outline-secondary btn-sm" onClick={() => bridge.openAuthDialog("login")} type="button">
                Login
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {status ? <div className="admin-message">{status}</div> : null}
    </AdminShell>
  );
}
