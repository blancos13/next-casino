"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type AdminUserItem = {
  id: string;
  username: string;
  avatar: string;
  balance: string;
  bonus: string;
  role: "admin" | "moder" | "youtuber" | "user";
  ip: string;
  ban: boolean;
};

type AdminUsersResponse = {
  items: AdminUserItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

const USERS_PAGE_SIZE = 20;
const bridge = getCasinoBridge();

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

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

const asRole = (value: unknown): AdminUserItem["role"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "admin" || normalized === "moder" || normalized === "youtuber") {
    return normalized;
  }
  return "user";
};

const parseUsersResponse = (payload: unknown): AdminUsersResponse | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as {
    items?: unknown;
    total?: unknown;
    page?: unknown;
    pageSize?: unknown;
    pages?: unknown;
    data?: unknown;
  };
  const body =
    root.data && typeof root.data === "object"
      ? (root.data as {
          items?: unknown;
          total?: unknown;
          page?: unknown;
          pageSize?: unknown;
          pages?: unknown;
        })
      : root;

  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  const items = itemsRaw
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      return {
        id: asString(item.id),
        username: asString(item.username, "User"),
        avatar: asString(item.avatar, "/img/no_avatar.jpg"),
        balance: asString(item.balance, "0.00"),
        bonus: asString(item.bonus, "0.00"),
        role: asRole(item.role),
        ip: asString(item.ip, "-"),
        ban: asBoolean(item.ban),
      } satisfies AdminUserItem;
    })
    .filter((item) => Boolean(item)) as AdminUserItem[];

  return {
    items,
    total: Math.max(0, Math.trunc(asNumber(body.total, 0))),
    page: Math.max(1, Math.trunc(asNumber(body.page, 1))),
    pageSize: Math.max(1, Math.trunc(asNumber(body.pageSize, USERS_PAGE_SIZE))),
    pages: Math.max(1, Math.trunc(asNumber(body.pages, 1))),
  };
};

const roleLabel: Record<AdminUserItem["role"], string> = {
  admin: "Admin",
  moder: "Moder",
  youtuber: "YouTuber",
  user: "User",
};

export default function AdminUsersPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [items, setItems] = useState<AdminUserItem[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(USERS_PAGE_SIZE);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");

  const loadUsers = useCallback(async (targetPage: number, targetQuery: string) => {
    setIsLoading(true);
    setStatus("");

    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setItems([]);
        setTotal(0);
        setPages(1);
        setStatus("Login required for users table.");
        return;
      }

      const response = await bridge.getAdminUsers({
        page: targetPage,
        pageSize: USERS_PAGE_SIZE,
        query: targetQuery,
      });
      const parsed = parseUsersResponse(response);
      if (!parsed) {
        setItems([]);
        setTotal(0);
        setPages(1);
        setStatus("Could not parse users data.");
        return;
      }

      setItems(parsed.items);
      setTotal(parsed.total);
      setPage(parsed.page);
      setPageSize(parsed.pageSize);
      setPages(parsed.pages);
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers(page, query);
  }, [loadUsers, page, query]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadUsers(page, query);
  }, [bridgeState.isAuthenticated, loadUsers, page, query]);

  const range = useMemo(() => {
    if (total <= 0 || items.length === 0) {
      return "0-0";
    }
    const start = (page - 1) * pageSize + 1;
    const end = start + items.length - 1;
    return `${start}-${end}`;
  }, [items.length, page, pageSize, total]);

  return (
    <AdminShell subtitle="Users table" title="Users">
      <div className="kt-portlet">
        <div className="kt-portlet__body">
          <form
            className="form-inline mb-3"
          onSubmit={(event) => {
            event.preventDefault();
            const nextQuery = queryInput.trim();
            if (page === 1 && nextQuery === query) {
              void loadUsers(1, nextQuery);
              return;
            }
            setPage(1);
            setQuery(nextQuery);
          }}
          >
            <div className="input-group input-group-sm mr-2" style={{ maxWidth: 420, width: "100%" }}>
              <input
                className="form-control"
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Search by username, IP, email or ID"
                type="text"
                value={queryInput}
              />
            </div>
            <button className="btn btn-primary btn-sm mr-2" disabled={isLoading} type="submit">
              Search
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={isLoading}
              onClick={() => {
                setQueryInput("");
                if (query === "" && page === 1) {
                  void loadUsers(1, "");
                  return;
                }
                setQuery("");
                setPage(1);
              }}
              type="button"
            >
              Reset
            </button>
          </form>

          <div className="mb-3">
            {!bridgeState.isAuthenticated ? (
              <button className="btn btn-primary btn-sm mr-2" onClick={() => bridge.openAuthDialog("login")} type="button">
                Login
              </button>
            ) : (
              <button className="btn btn-primary btn-sm mr-2" onClick={() => void loadUsers(page, query)} type="button">
                Refresh
              </button>
            )}
            {bridgeState.isAuthenticated ? (
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  void bridge.logout();
                  setItems([]);
                }}
                type="button"
              >
                Logout
              </button>
            ) : null}
          </div>

          <div className="table-responsive">
            <table className="table table-striped- table-bordered table-hover table-checkable" id="dtable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Balance</th>
                  <th>Bonuses</th>
                  <th>Role</th>
                  <th>IP</th>
                  <th>Ban</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="admin-code">{item.id}</td>
                    <td>
                      <div className="admin-user-cell">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={item.username} src={item.avatar} />
                        <span>{item.username}</span>
                      </div>
                    </td>
                    <td>{item.balance}$</td>
                    <td>{item.bonus}$</td>
                    <td>
                      <span className={`admin-badge admin-badge--${item.role}`}>{roleLabel[item.role]}</span>
                    </td>
                    <td>{item.ip}</td>
                    <td>
                      <span className={`admin-badge ${item.ban ? "admin-badge--danger" : "admin-badge--ok"}`}>
                        {item.ban ? "Yes" : "No"}
                      </span>
                    </td>
                    <td>
                      <Link className="admin-link" href={`/admin/user/${item.id}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
                {!isLoading && items.length === 0 ? (
                  <tr>
                    <td className="admin-empty" colSpan={8}>
                      No users found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="d-flex flex-wrap justify-content-between align-items-center">
            <div className="admin-pagination__meta">
              Showing {range} of {total}
            </div>
            <div className="d-flex align-items-center" style={{ gap: 8 }}>
              <button
                className="btn btn-outline-secondary btn-sm"
                disabled={isLoading || page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                type="button"
              >
                Prev
              </button>
              <span className="admin-pagination__meta">
                Page {page} / {pages}
              </span>
              <button
                className="btn btn-outline-secondary btn-sm"
                disabled={isLoading || page >= pages}
                onClick={() => setPage((prev) => Math.min(pages, prev + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>

          {isLoading ? <div className="admin-message mt-3">Loading users...</div> : null}
          {!isLoading && status ? <div className="admin-message mt-3">{status}</div> : null}
        </div>
      </div>
    </AdminShell>
  );
}
