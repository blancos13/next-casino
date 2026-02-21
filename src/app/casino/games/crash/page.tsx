"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { openFairGameModal } from "@/components/casino/layout/fair-game-modal";
import { getCasinoBridge } from "@/components/casino/state/casino-bridge";
import { getCrashStore } from "@/components/casino/state/crash-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

const crashStore = getCrashStore();
const bridge = getCasinoBridge();

const CRASH_GRAPH_WIDTH = 1100;
const CRASH_GRAPH_HEIGHT = 420;
const CRASH_GRAPH_MIN_MULTIPLIER = 1;
const CRASH_GRAPH_PLOT_LEFT_RATIO = 14 / 1100;
const CRASH_GRAPH_PLOT_RIGHT_RATIO = 14 / 1100;
const CRASH_GRAPH_PLOT_TOP_RATIO = 10 / 420;
const CRASH_GRAPH_PLOT_BOTTOM_RATIO = 16 / 420;

const drawCrashGrid = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  plotLeft: number,
): void => {
  const scaleX = width / CRASH_GRAPH_WIDTH;
  const scaleY = height / CRASH_GRAPH_HEIGHT;
  const gridHeight = height - 10 * scaleY;

  const lr = Math.round((width - 6 * scaleX) / (83.5 * scaleX)) + 1;
  const td = Math.round((gridHeight - 1 * scaleY) / (82.5 * scaleY)) + 1;

  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";

  for (let s = 0; s < lr; s += 1) {
    const x = plotLeft + 6 * scaleX + 83 * scaleX * s;
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    if (s === 0) {
      ctx.setLineDash([]);
    }
    ctx.moveTo(x, 0);
    ctx.lineTo(x, gridHeight);
    ctx.stroke();
    ctx.closePath();
  }

  for (let u = 0; u < td; u += 1) {
    const y = gridHeight - (88.8 * scaleY * u + (u + 1 === td ? 1 * scaleY : 0));
    const right = width - 6 * scaleX - 0.5 * scaleX - 9 * scaleX;
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    if (u === 0) {
      ctx.setLineDash([]);
    }
    ctx.moveTo(plotLeft + 6 * scaleX, y);
    ctx.lineTo(right + plotLeft, y);
    ctx.stroke();
    ctx.closePath();
  }

  ctx.setLineDash([]);
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
};

const asPositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
};

const historyColor = (value: number): string => {
  if (value > 6.49) {
    return "#eebef1";
  }
  if (value > 4.49) {
    return "#dcd0ff";
  }
  if (value > 2.99) {
    return "#ccccff";
  }
  if (value > 1.99) {
    return "#afdafc";
  }
  return "#a6caf0";
};

export default function CrashPage() {
  const [betAmount, setBetAmount] = useState("1.00");
  const [autoStop, setAutoStop] = useState("2.00");
  const [isBetPending, setIsBetPending] = useState(false);

  const crashState = useSyncExternalStore(crashStore.subscribe, crashStore.getSnapshot, crashStore.getServerSnapshot);
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);

  const betAmountNum = useMemo(() => asPositive(Number.parseFloat(betAmount)), [betAmount]);
  const autoStopNum = useMemo(() => asPositive(Number.parseFloat(autoStop)), [autoStop]);

  const myBet = useMemo(
    () => crashState.bets.find((bet) => bridgeState.userId && bet.userId === bridgeState.userId),
    [bridgeState.userId, crashState.bets],
  );

  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const cssWidth = Math.max(1, Math.round(canvas.clientWidth || CRASH_GRAPH_WIDTH));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight || CRASH_GRAPH_HEIGHT));
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
    const backingHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = cssWidth;
    const height = cssHeight;
    const plotLeft = width * CRASH_GRAPH_PLOT_LEFT_RATIO;
    const plotRight = width * CRASH_GRAPH_PLOT_RIGHT_RATIO;
    const plotTop = height * CRASH_GRAPH_PLOT_TOP_RATIO;
    const plotBottom = height * CRASH_GRAPH_PLOT_BOTTOM_RATIO;
    const plotWidth = width - plotLeft - plotRight;
    const plotHeight = height - plotTop - plotBottom;

    const safePoints = crashState.graphPoints
      .map((value) => (Number.isFinite(value) && value > 0 ? Number(value.toFixed(4)) : CRASH_GRAPH_MIN_MULTIPLIER))
      .filter((value) => value > 0);
    const points = safePoints.length > 1 ? safePoints : [];

    ctx.clearRect(0, 0, width, height);
    drawCrashGrid(ctx, width, height, plotLeft);

    if (crashState.phase === "betting" || points.length < 2) {
      return;
    }

    const yMax = Math.max(2, ...points, Number(crashState.multiplier.toFixed(2))) + 1;
    const yMin = 1;
    const yRange = Math.max(0.0001, yMax - yMin);
    const bottomY = plotTop + plotHeight;
    const span = Math.max(1, points.length - 1);

    const xy = points.map((value, index) => {
      const x = plotLeft + (index / span) * plotWidth;
      const normalizedY = (value - yMin) / yRange;
      const y = plotTop + (1 - normalizedY) * plotHeight;
      return {
        x,
        y: Math.max(plotTop, Math.min(bottomY, y)),
      };
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(xy[0]!.x, bottomY);
    for (const point of xy) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(xy[xy.length - 1]!.x, bottomY);
    ctx.closePath();
    ctx.fillStyle =
      crashState.phase === "ended" ? "rgba(167, 76, 92, 0.25)" : "rgba(73, 134, 245, 0.65)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xy[0]!.x, xy[0]!.y);
    for (let i = 1; i < xy.length; i += 1) {
      ctx.lineTo(xy[i]!.x, xy[i]!.y);
    }
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#ffffff";
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.restore();
  }, [crashState.graphPoints, crashState.multiplier, crashState.phase]);

  const canCashout =
    crashState.phase === "running" && myBet && !myBet.cashedOut && crashState.multiplier >= 1;
  const canBet = crashState.phase === "betting" && !myBet && !isBetPending;
  const buttonDisabled = !canCashout && !canBet;
  const chartInfoText =
    crashState.phase === "betting"
      ? `To start ${Math.max(0, crashState.countdownSec)}sec.`
      : crashState.phase === "ended"
        ? `Stop on x${crashState.multiplier.toFixed(2)}`
        : `x${crashState.multiplier.toFixed(2)}`;
  const chartInfoColor = crashState.phase === "ended" ? "#a74c5c" : historyColor(crashState.multiplier);

  const handleBet = async () => {
    if (!canBet || !betAmountNum) {
      return;
    }
    setIsBetPending(true);
    try {
      await crashStore.placeBet(Number(betAmountNum.toFixed(2)));
    } finally {
      setIsBetPending(false);
    }
  };

  const handleCashout = async () => {
    if (!canCashout) {
      return;
    }
    await crashStore.cashout(autoStopNum > 1 ? Number(autoStopNum.toFixed(2)) : undefined);
  };

  const adjustBet = (mode: "plus" | "multiply" | "divide" | "max", value: number) => {
    const current = betAmountNum || 0;
    let next = current;
    if (mode === "plus") next = current + value;
    if (mode === "multiply") next = current * value;
    if (mode === "divide") next = current / value;
    if (mode === "max") next = crashState.maxBet;
    setBetAmount(next.toFixed(2));
  };

  return (
    <MainLayout>
      <div className="section game-section">
        <div className="container">
          <div className="game crash-prefix">
            <div className="game-sidebar">
              <div className="sidebar-block">
                <div className="bet-component">
                  <div className="bet-form">
                    <div className="form-row">
                      <label>
                        <div className="form-label">
                          <span>Bet amount</span>
                        </div>
                        <div className="form-row">
                          <div className="form-field">
                            <input
                              className="input-field no-bottom-radius"
                              id="sum"
                              name="sum"
                              onChange={(event) => setBetAmount(event.target.value)}
                              type="text"
                              value={betAmount}
                            />
                            <button className="btn btn-bet-clear" onClick={() => setBetAmount("0.00")} type="button">
                              <SymbolIcon className="icon icon-close" id="icon-close" />
                            </button>
                            <div className="buttons-group no-top-radius">
                              <button className="btn btn-action" onClick={() => adjustBet("plus", 0.01)} type="button">
                                +0.01
                              </button>
                              <button className="btn btn-action" onClick={() => adjustBet("plus", 0.1)} type="button">
                                +0.10
                              </button>
                              <button className="btn btn-action" onClick={() => adjustBet("plus", 0.5)} type="button">
                                +0.50
                              </button>
                              <button className="btn btn-action" onClick={() => adjustBet("multiply", 2)} type="button">
                                2X
                              </button>
                              <button className="btn btn-action" onClick={() => adjustBet("divide", 2)} type="button">
                                1/2
                              </button>
                              <button className="btn btn-action" onClick={() => adjustBet("max", 0)} type="button">
                                MAX
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="form-row">
                          <label>
                            <div className="form-label">
                              <span>Auto stop</span>
                            </div>
                            <div className="form-field">
                              <div className="input-valid">
                                <input
                                  className="input-field"
                                  id="betout"
                                  onChange={(event) => setAutoStop(event.target.value)}
                                  type="text"
                                  value={autoStop}
                                />
                                <div className="input-suffix">
                                  <span>{autoStop}</span>&nbsp;x
                                </div>
                              </div>
                            </div>
                          </label>
                        </div>
                      </label>
                    </div>

                    <button
                      className={`btn btn-play ${canCashout ? "btn-warning" : "btn-green"}`}
                      disabled={buttonDisabled}
                      onClick={() => void (canCashout ? handleCashout() : handleBet())}
                      type="button"
                    >
                      <span>
                        {canCashout
                          ? "Cashout"
                          : isBetPending
                            ? "Submitting..."
                          : canBet
                            ? "Make bet"
                            : myBet && crashState.phase === "betting"
                              ? "Bet accepted"
                              : crashState.phase === "running"
                                ? "Round running"
                                : "Round ended"}
                      </span>
                    </button>
                  </div>
                  <div className="bet-footer">
                    <button className="btn btn-light" onClick={() => openFairGameModal(crashState.hash)} type="button">
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                      <span>Fair game</span>
                    </button>
                  </div>
                  {crashState.status ? (
                    <div style={{ color: "#aeb9d1", fontSize: 11, marginTop: 8, textAlign: "center" }}>
                      {crashState.status}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="game-component">
              <div className="game-block">
                <div className="progress-wrap">
                    <div className="progress-item left">
                      <div className="title">
                        Min sum: <span>{crashState.minBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                      </div>
                      <div className="title">
                        Max sum: <span>{crashState.maxBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                      </div>
                    </div>
                  <div className="progress-item right">
                    <div className="title">
                      Game #<span>{crashState.roundId ? crashState.roundId.slice(0, 6) : "----"}</span>
                    </div>
                  </div>
                </div>
                <div className="game-area__wrap">
                  <div className="game-area">
                    <div className="game-area-content" style={{ display: "block", width: "100%" }}>
                      <div className="crash__connected" style={{ marginTop: 20, minHeight: 420 }}>
                        <div style={{ height: 420, width: "100%" }}>
                          <canvas
                            aria-label="Crash graph"
                            height={CRASH_GRAPH_HEIGHT}
                            id="crashChart"
                            ref={chartCanvasRef}
                            role="img"
                            style={{ display: "block", height: "100%", width: "100%" }}
                            width={CRASH_GRAPH_WIDTH}
                          />
                        </div>
                        <h2>
                          <span id="chartInfo" style={{ color: chartInfoColor }}>
                            {chartInfoText}
                          </span>
                        </h2>
                      </div>
                      <div className="hash" style={{ marginTop: 8 }}>
                        <span className="title">HASH:</span> <span className="text">{crashState.hash}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="game-history__wrap">
                <div className="game-history">
                  {crashState.history.map((item, index) => (
                    <button
                      className="item checkGame"
                      data-hash={item.hash}
                      key={`${item.multiplier}-${item.hash || "nohash"}-${index}`}
                      onClick={() => openFairGameModal(item.hash || crashState.hash)}
                      style={{ border: 0, padding: 0, background: "transparent" }}
                      type="button"
                    >
                      <div className="item-bet" style={{ color: historyColor(item.multiplier) }}>
                        x{item.multiplier.toFixed(2)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section bets-section">
        <div className="container">
          <div className="game-stats">
            <div className="table-heading">
              <div className="thead">
                <div className="tr">
                  <div className="th">User</div>
                  <div className="th">Bet</div>
                  <div className="th">Auto stop</div>
                  <div className="th">Win</div>
                </div>
              </div>
            </div>
            <div className="table-stats-wrap" style={{ maxHeight: "100%", minHeight: 530 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {crashState.bets.map((bet) => (
                      <tr key={bet.id}>
                        <td className="username">
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <div className="sanitize-avatar">
                                <img alt="" src="/img/no_avatar.jpg" />
                              </div>
                              <span className="sanitize-name">{bet.user}</span>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span>{bet.amount.toFixed(2)}</span>
                              <SymbolIcon className="icon icon-coin" id="icon-coin" />
                            </span>
                          </div>
                        </td>
                        <td>{bet.cashoutMultiplier ? `x${bet.cashoutMultiplier.toFixed(2)}` : "-"}</td>
                        <td>
                          {bet.cashedOut && bet.payout !== null ? (
                            <span className="bet-wrap win">
                              <span>{bet.payout.toFixed(2)}</span>
                              <SymbolIcon className="icon icon-coin" id="icon-coin" />
                            </span>
                          ) : (
                            <span className="bet-wrap wait">
                              <SymbolIcon className="icon" id="icon-time" />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {crashState.bets.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ color: "#9eaccd", textAlign: "center" }}>
                          No bets yet
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
