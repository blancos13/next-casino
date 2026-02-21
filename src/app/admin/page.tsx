"use client";

import Chart from "chart.js/auto";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type DashboardSeriesItem = {
  date: string;
  count?: number;
  sum?: string;
};

type DashboardSummary = {
  kpi: {
    payToday: string;
    payWeek: string;
    payMonth: string;
    payAll: string;
    withReq: string;
    usersCount: number;
  };
  profit: {
    jackpot: string;
    pvp: string;
    battle: string;
    wheel: string;
    dice: string;
    crash: string;
    exchange: string;
    total: string;
    refExpense: string;
  };
  charts: {
    registrations: DashboardSeriesItem[];
    deposits: DashboardSeriesItem[];
  };
  lists: {
    latestDeposits: Array<{
      id: string;
      username: string;
      avatar: string;
      sum: string;
      date: number | null;
    }>;
    latestUsers: Array<{
      id: string;
      username: string;
      avatar: string;
      refCode: string;
      createdAt: number | null;
    }>;
    richestUsers: Array<{
      id: string;
      username: string;
      avatar: string;
      balance: string;
    }>;
    chat: Array<{
      id: string;
      userId: string;
      username: string;
      text: string;
      createdAt: number | null;
    }>;
  };
};

const bridge = getCasinoBridge();

const asString = (value: unknown, fallback = "0.00"): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  return fallback;
};

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

const asTimestamp = (value: unknown): number | null => {
  const parsed = asNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed > 1_000_000_000_000 ? Math.trunc(parsed) : Math.trunc(parsed * 1000);
};

const parseSeries = (value: unknown): DashboardSeriesItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      return {
        date: typeof item.date === "string" ? item.date : "",
        count: item.count !== undefined ? Math.max(0, Math.trunc(asNumber(item.count, 0))) : undefined,
        sum: item.sum !== undefined ? asString(item.sum) : undefined,
      } satisfies DashboardSeriesItem;
    })
    .filter((row) => Boolean(row) && (row as DashboardSeriesItem).date.length > 0) as DashboardSeriesItem[];
};

const parseDashboard = (payload: unknown): DashboardSummary | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const root = payload as { data?: unknown };
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : (payload as Record<string, unknown>);

  const kpiRaw = data.kpi && typeof data.kpi === "object" ? (data.kpi as Record<string, unknown>) : {};
  const profitRaw = data.profit && typeof data.profit === "object" ? (data.profit as Record<string, unknown>) : {};
  const chartsRaw = data.charts && typeof data.charts === "object" ? (data.charts as Record<string, unknown>) : {};
  const listsRaw = data.lists && typeof data.lists === "object" ? (data.lists as Record<string, unknown>) : {};

  const latestDeposits = Array.isArray(listsRaw.latestDeposits)
    ? (listsRaw.latestDeposits as Array<Record<string, unknown>>).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        username: typeof row.username === "string" ? row.username : "User",
        avatar: typeof row.avatar === "string" ? row.avatar : "/img/no_avatar.jpg",
        sum: asString(row.sum),
        date: asTimestamp(row.date),
      }))
    : [];

  const latestUsers = Array.isArray(listsRaw.latestUsers)
    ? (listsRaw.latestUsers as Array<Record<string, unknown>>).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        username: typeof row.username === "string" ? row.username : "User",
        avatar: typeof row.avatar === "string" ? row.avatar : "/img/no_avatar.jpg",
        refCode: typeof row.refCode === "string" ? row.refCode : "",
        createdAt: asTimestamp(row.createdAt),
      }))
    : [];

  const richestUsers = Array.isArray(listsRaw.richestUsers)
    ? (listsRaw.richestUsers as Array<Record<string, unknown>>).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        username: typeof row.username === "string" ? row.username : "User",
        avatar: typeof row.avatar === "string" ? row.avatar : "/img/no_avatar.jpg",
        balance: asString(row.balance),
      }))
    : [];

  const chat = Array.isArray(listsRaw.chat)
    ? (listsRaw.chat as Array<Record<string, unknown>>).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        userId: typeof row.userId === "string" ? row.userId : "",
        username: typeof row.username === "string" ? row.username : "User",
        text: typeof row.text === "string" ? row.text : "",
        createdAt: asTimestamp(row.createdAt),
      }))
    : [];

  return {
    kpi: {
      payToday: asString(kpiRaw.payToday),
      payWeek: asString(kpiRaw.payWeek),
      payMonth: asString(kpiRaw.payMonth),
      payAll: asString(kpiRaw.payAll),
      withReq: asString(kpiRaw.withReq),
      usersCount: Math.max(0, Math.trunc(asNumber(kpiRaw.usersCount))),
    },
    profit: {
      jackpot: asString(profitRaw.jackpot),
      pvp: asString(profitRaw.pvp),
      battle: asString(profitRaw.battle),
      wheel: asString(profitRaw.wheel),
      dice: asString(profitRaw.dice),
      crash: asString(profitRaw.crash),
      exchange: asString(profitRaw.exchange),
      total: asString(profitRaw.total),
      refExpense: asString(profitRaw.refExpense),
    },
    charts: {
      registrations: parseSeries(chartsRaw.registrations),
      deposits: parseSeries(chartsRaw.deposits),
    },
    lists: {
      latestDeposits,
      latestUsers,
      richestUsers,
      chat,
    },
  };
};

const formatDateTime = (timestampMs: number | null): string => {
  if (!timestampMs) {
    return "-";
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
};

const parseSeriesValues = (series: DashboardSeriesItem[], key: "count" | "sum"): number[] =>
  series.map((item) => {
    if (key === "count") {
      return Math.max(0, Math.trunc(asNumber(item.count, 0)));
    }
    return asNumber(item.sum, 0);
  });

export default function AdminDashboardPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");

  const registrationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const depositsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const registrationChartRef = useRef<Chart | null>(null);
  const depositsChartRef = useRef<Chart | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setStatus("");
    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setDashboard(null);
        setStatus("Login required for admin dashboard.");
        return;
      }
      const response = await bridge.getAdminOverview();
      const parsed = parseDashboard(response);
      if (!parsed) {
        setDashboard(null);
        setStatus("Could not parse dashboard data.");
        return;
      }
      setDashboard(parsed);
    } catch (error) {
      setDashboard(null);
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadDashboard();
  }, [bridgeState.isAuthenticated, loadDashboard]);

  useEffect(() => {
    const registrations = dashboard?.charts.registrations ?? [];
    const labels = registrations.map((item) => item.date);
    const values = parseSeriesValues(registrations, "count");
    const canvas = registrationCanvasRef.current;
    if (!canvas) {
      return;
    }

    registrationChartRef.current?.destroy();
    registrationChartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Users",
            data: values,
            tension: 0.35,
            borderColor: "#2c80ff",
            backgroundColor: "rgba(44,128,255,0.1)",
            pointBorderColor: "#2c80ff",
            pointBackgroundColor: "#fff",
            pointRadius: 4,
            pointHoverRadius: 5,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
            },
          },
        },
      },
    });

    return () => {
      registrationChartRef.current?.destroy();
      registrationChartRef.current = null;
    };
  }, [dashboard?.charts.registrations]);

  useEffect(() => {
    const deposits = dashboard?.charts.deposits ?? [];
    const labels = deposits.map((item) => item.date);
    const values = parseSeriesValues(deposits, "sum");
    const canvas = depositsCanvasRef.current;
    if (!canvas) {
      return;
    }

    depositsChartRef.current?.destroy();
    depositsChartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Deposits",
            data: values,
            tension: 0.35,
            borderColor: "#2c80ff",
            backgroundColor: "rgba(44,128,255,0.1)",
            pointBorderColor: "#2c80ff",
            pointBackgroundColor: "#fff",
            pointRadius: 4,
            pointHoverRadius: 5,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    });

    return () => {
      depositsChartRef.current?.destroy();
      depositsChartRef.current = null;
    };
  }, [dashboard?.charts.deposits]);

  const defaultDashboard: DashboardSummary = useMemo(
    () => ({
      kpi: {
        payToday: "0.00",
        payWeek: "0.00",
        payMonth: "0.00",
        payAll: "0.00",
        withReq: "0.00",
        usersCount: 0,
      },
      profit: {
        jackpot: "0.00",
        pvp: "0.00",
        battle: "0.00",
        wheel: "0.00",
        dice: "0.00",
        crash: "0.00",
        exchange: "0.00",
        total: "0.00",
        refExpense: "0.00",
      },
      charts: {
        registrations: [],
        deposits: [],
      },
      lists: {
        latestDeposits: [],
        latestUsers: [],
        richestUsers: [],
        chat: [],
      },
    }),
    [],
  );

  const data = dashboard ?? defaultDashboard;

  return (
    <AdminShell subtitle="Statistics" title="Statistics">
      <div className="kt-portlet">
        <div className="kt-portlet__body kt-portlet__body--fit">
          <div className="row row-no-padding row-col-separator-xl">
            <div className="col-md-12 col-lg-6 col-xl-3">
              <div className="kt-widget24">
                <div className="kt-widget24__details">
                  <div className="kt-widget24__info">
                    <h4 className="kt-widget24__title">Deposits on</h4>
                    <span className="kt-widget24__desc">for today</span>
                  </div>
                  <span className="kt-widget24__stats kt-font-success">{data.kpi.payToday}$</span>
                </div>
              </div>
            </div>
            <div className="col-md-12 col-lg-6 col-xl-3">
              <div className="kt-widget24">
                <div className="kt-widget24__details">
                  <div className="kt-widget24__info">
                    <h4 className="kt-widget24__title">Deposits on</h4>
                    <span className="kt-widget24__desc">for 7 days</span>
                  </div>
                  <span className="kt-widget24__stats kt-font-success">{data.kpi.payWeek}$</span>
                </div>
              </div>
            </div>
            <div className="col-md-12 col-lg-6 col-xl-3">
              <div className="kt-widget24">
                <div className="kt-widget24__details">
                  <div className="kt-widget24__info">
                    <h4 className="kt-widget24__title">Deposits on</h4>
                    <span className="kt-widget24__desc">per month</span>
                  </div>
                  <span className="kt-widget24__stats kt-font-success">{data.kpi.payMonth}$</span>
                </div>
              </div>
            </div>
            <div className="col-md-12 col-lg-6 col-xl-3">
              <div className="kt-widget24">
                <div className="kt-widget24__details">
                  <div className="kt-widget24__info">
                    <h4 className="kt-widget24__title">Deposits on</h4>
                    <span className="kt-widget24__desc">for all time</span>
                  </div>
                  <span className="kt-widget24__stats kt-font-success">{data.kpi.payAll}$</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="kt-portlet">
        <div className="kt-portlet__body kt-portlet__body--fit">
          <div className="row row-no-padding row-col-separator-xl">
            <div className="col-md-12 col-lg-6 col-xl-6">
              <div className="kt-widget24">
                <div className="kt-widget24__details">
                  <div className="kt-widget24__info">
                    <h4 className="kt-widget24__title">Users</h4>
                    <span className="kt-widget24__desc">total</span>
                  </div>
                  <span className="kt-widget24__stats kt-font-brand">{data.kpi.usersCount}</span>
                </div>
              </div>
            </div>
            <div className="col-md-12 col-lg-6 col-xl-6">
              <div className="kt-widget24">
                <div className="kt-widget24__details">
                  <div className="kt-widget24__info">
                    <h4 className="kt-widget24__title">For withdraw</h4>
                    <span className="kt-widget24__desc">total amount</span>
                  </div>
                  <span className="kt-widget24__stats kt-font-danger">{data.kpi.withReq}$</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="kt-portlet">
        <div className="kt-portlet__body kt-portlet__body--fit">
          <div className="row row-no-padding row-col-separator-xl">
            <div className="col-md-12 col-lg-12 col-xl-4">
              <div className="kt-widget1">
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Commission Jackpot</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.jackpot}$</span>
                </div>
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Commission PvP</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.pvp}$</span>
                </div>
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Commission Battle</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.battle}$</span>
                </div>
              </div>
            </div>
            <div className="col-md-12 col-lg-12 col-xl-4">
              <div className="kt-widget1">
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Profit Wheel</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.wheel}$</span>
                </div>
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Profit Dice</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.dice}$</span>
                </div>
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Profit Crash</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.crash}$</span>
                </div>
              </div>
            </div>
            <div className="col-md-12 col-lg-12 col-xl-4">
              <div className="kt-widget1">
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Profit exchanges</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.exchange}$</span>
                </div>
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Total Profit</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-success">{data.profit.total}$</span>
                </div>
                <div className="kt-widget1__item">
                  <div className="kt-widget1__info">
                    <h3 className="kt-widget1__title">Ref. system/promo (expense)</h3>
                  </div>
                  <span className="kt-widget1__number kt-font-danger">{data.profit.refExpense}$</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-xl-6">
          <div className="kt-portlet kt-portlet--height-fluid">
            <div className="kt-portlet__head">
              <div className="kt-portlet__head-label">
                <h3 className="kt-portlet__head-title">Registration for current month</h3>
              </div>
            </div>
            <div className="kt-portlet__body kt-portlet__body--fluid">
              <div className="kt-widget12">
                <div className="kt-widget12__chart" style={{ height: 250 }}>
                  <canvas ref={registrationCanvasRef} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-xl-6">
          <div className="kt-portlet kt-portlet--height-fluid">
            <div className="kt-portlet__head">
              <div className="kt-portlet__head-label">
                <h3 className="kt-portlet__head-title">Deposit for current month</h3>
              </div>
            </div>
            <div className="kt-portlet__body kt-portlet__body--fluid">
              <div className="kt-widget12">
                <div className="kt-widget12__chart" style={{ height: 250 }}>
                  <canvas ref={depositsCanvasRef} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-xl-4">
          <div className="kt-portlet">
            <div className="kt-portlet__head">
              <div className="kt-portlet__head-label">
                <h3 className="kt-portlet__head-title">Latest deposits</h3>
              </div>
            </div>
            <div className="kt-portlet__body">
              <div className="kt-widget3 admin-scroll-box">
                {data.lists.latestDeposits.map((row) => (
                  <div className="kt-widget3__item" key={`${row.id}-${row.date ?? 0}`}>
                    <div className="kt-widget3__header">
                      <div className="kt-widget3__user-img">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={row.username} className="kt-widget3__img" src={row.avatar} />
                      </div>
                      <div className="kt-widget3__info">
                        <span className="kt-widget3__username">{row.username}</span>
                        <br />
                        <span className="kt-widget3__time">{formatDateTime(row.date)}</span>
                      </div>
                      <span className="kt-widget3__status kt-font-success">{row.sum}$</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="col-xl-4">
          <div className="kt-portlet">
            <div className="kt-portlet__head">
              <div className="kt-portlet__head-label">
                <h3 className="kt-portlet__head-title">Latest users</h3>
              </div>
            </div>
            <div className="kt-portlet__body">
              <div className="kt-widget3 admin-scroll-box">
                {data.lists.latestUsers.map((row) => (
                  <div className="kt-widget3__item" key={row.id}>
                    <div className="kt-widget3__header">
                      <div className="kt-widget3__user-img">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={row.username} className="kt-widget3__img" src={row.avatar} />
                      </div>
                      <div className="kt-widget3__info">
                        <span className="kt-widget3__username">{row.username}</span>
                        <br />
                        <span className="kt-widget3__time">Referral: {row.refCode || "No"}</span>
                      </div>
                      <span className="kt-widget3__status kt-font-success">{formatDateTime(row.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="col-xl-4">
          <div className="kt-portlet">
            <div className="kt-portlet__head">
              <div className="kt-portlet__head-label">
                <h3 className="kt-portlet__head-title">The richest</h3>
              </div>
            </div>
            <div className="kt-portlet__body">
              <div className="kt-widget3 admin-scroll-box">
                {data.lists.richestUsers.map((row) => (
                  <div className="kt-widget3__item" key={row.id}>
                    <div className="kt-widget3__header">
                      <div className="kt-widget3__user-img">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={row.username} className="kt-widget3__img" src={row.avatar} />
                      </div>
                      <div className="kt-widget3__info">
                        <span className="kt-widget3__username">{row.username}</span>
                      </div>
                      <span className="kt-widget3__status kt-font-success">{row.balance}$</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-xl-12">
          <div className="kt-portlet">
            <div className="kt-portlet__head">
              <div className="kt-portlet__head-label">
                <h3 className="kt-portlet__head-title">Chat feed</h3>
              </div>
            </div>
            <div className="kt-portlet__body">
              <div className="kt-widget3 admin-scroll-box admin-scroll-box--chat">
                {data.lists.chat.map((row) => (
                  <div className="kt-widget3__item" key={row.id}>
                    <div className="kt-widget3__header">
                      <div className="kt-widget3__info">
                        <span className="kt-widget3__username">{row.username}</span>
                        <br />
                        <span className="kt-widget3__time">{formatDateTime(row.createdAt)}</span>
                      </div>
                    </div>
                    <div className="kt-widget3__body">
                      <p className="kt-widget3__text">{row.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? <div className="admin-message">Loading dashboard...</div> : null}
      {status ? <div className="admin-message">{status}</div> : null}

      <div className="admin-actions">
        {!bridgeState.isAuthenticated ? (
          <button className="btn btn-primary btn-sm" onClick={() => bridge.openAuthDialog("login")} type="button">
            Login
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => void loadDashboard()} type="button">
            Refresh
          </button>
        )}
      </div>
    </AdminShell>
  );
}
