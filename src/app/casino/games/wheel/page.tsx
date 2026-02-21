"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { openFairGameModal } from "@/components/casino/layout/fair-game-modal";
import { getWheelStore, type WheelColor } from "@/components/casino/state/wheel-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

const wheelStore = getWheelStore();

const wheelRates: Record<WheelColor, number> = {
  black: 2,
  red: 3,
  green: 5,
  yellow: 50,
};

const asPositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
};

export default function WheelPage() {
  const [betAmount, setBetAmount] = useState("1.00");
  const [selectedColor, setSelectedColor] = useState<WheelColor>("red");
  const wheelState = useSyncExternalStore(wheelStore.subscribe, wheelStore.getSnapshot, wheelStore.getServerSnapshot);

  const betAmountNum = useMemo(() => asPositive(Number.parseFloat(betAmount)), [betAmount]);
  const isBetDisabled =
    wheelState.isPlacingBet || wheelState.bettingPhase === "spinning" || wheelState.bettingPhase === "waitingSpin";
  const betButtonLabel =
    wheelState.isPlacingBet
      ? "Placing..."
      : wheelState.bettingPhase === "spinning"
        ? "Spinning..."
        : wheelState.bettingPhase === "waitingSpin"
          ? "Waiting for spin..."
          : "Make bet";

  const handleBet = async () => {
    if (!betAmountNum || isBetDisabled) {
      return;
    }
    await wheelStore.placeBet(Number(betAmountNum.toFixed(2)), selectedColor);
  };

  const adjustBet = (mode: "plus" | "multiply" | "divide" | "max", value: number) => {
    const current = betAmountNum || 0;
    let next = current;
    if (mode === "plus") next = current + value;
    if (mode === "multiply") next = current * value;
    if (mode === "divide") next = current / value;
    if (mode === "max") next = wheelState.maxBet;
    setBetAmount(next.toFixed(2));
  };

  return (
    <MainLayout>
      <div className="section game-section">
        <div className="container">
          <div className="game wheel-prefix">
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
                      </label>
                    </div>

                    <div className="button-group__wrap">
                      <div className="button-group__content wheel btnToggle">
                        <button
                          className={`btn btn-black btn-light${selectedColor === "black" ? " isActive" : ""}`}
                          onClick={() => setSelectedColor("black")}
                          type="button"
                        >
                          <span>x{wheelRates.black}</span>
                        </button>
                        <button
                          className={`btn btn-red btn-light${selectedColor === "red" ? " isActive" : ""}`}
                          onClick={() => setSelectedColor("red")}
                          type="button"
                        >
                          <span>x{wheelRates.red}</span>
                        </button>
                        <button
                          className={`btn btn-green btn-light${selectedColor === "green" ? " isActive" : ""}`}
                          onClick={() => setSelectedColor("green")}
                          type="button"
                        >
                          <span>x{wheelRates.green}</span>
                        </button>
                        <button
                          className={`btn btn-yellow btn-light${selectedColor === "yellow" ? " isActive" : ""}`}
                          onClick={() => setSelectedColor("yellow")}
                          type="button"
                        >
                          <span>x{wheelRates.yellow}</span>
                        </button>
                      </div>
                      <span className="button-group-label">
                        <span>Multiplier</span>
                      </span>
                    </div>

                    <button
                      className="btn btn-green btn-play"
                      disabled={isBetDisabled}
                      onClick={() => void handleBet()}
                      type="button"
                    >
                      <span>{betButtonLabel}</span>
                    </button>
                  </div>
                  <div className="bet-footer">
                    <button className="btn btn-light" onClick={() => openFairGameModal(wheelState.hash)} type="button">
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                      <span>Fair game</span>
                    </button>
                  </div>
                  {wheelState.status ? (
                    <div style={{ color: "#aeb9d1", fontSize: 11, marginTop: 8, textAlign: "center" }}>
                      {wheelState.status}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="game-component">
              <div className="game_Wheel">
                <div className="progress-wrap">
                  <div className="progress-item left">
                    <div className="title">
                      Min sum: <span>{wheelState.minBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                    <div className="title">
                      Max sum: <span>{wheelState.maxBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                  </div>
                  <div className="progress-item right">
                    <div className="title">
                      Game #<span>{wheelState.roundId ? wheelState.roundId.slice(0, 6) : "----"}</span>
                    </div>
                  </div>
                </div>

                <div className="wheel-game">
                  <div className="wheel-content">
                    <div
                      className="wheel-img"
                      style={{
                        transition:
                          wheelState.spinMs > 0
                            ? `transform ${wheelState.spinMs}ms cubic-bezier(0.32, 0.64, 0.45, 1)`
                            : "none",
                        transform: `rotate(${wheelState.rotationDeg}deg)`,
                      }}
                    >
                      <img alt="" src="/img/wheel.png" />
                    </div>
                    <div className="arrow">
                      <SymbolIcon className="icon" id="icon-picker" />
                    </div>
                    <div className="time" style={{ display: wheelState.spinMs > 0 ? "none" : "block" }}>
                      <div className="block">
                        <div className="title">To start</div>
                        <div className="value">00:{String(Math.max(0, wheelState.countdownSec)).padStart(2, "0")}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="history_wrapper">
                  <div className="history_history">
                    {wheelState.history.map((item, index) => (
                      <button
                        className={`item history_item history_${item.color} checkGame`}
                        data-hash={item.hash}
                        key={`${item.color}-${item.hash || "nohash"}-${index}`}
                        onClick={() => openFairGameModal(item.hash || wheelState.hash)}
                        style={{ border: 0, padding: 0, background: "transparent" }}
                        type="button"
                      />
                    ))}
                  </div>
                </div>

                <div className="hash">
                  <span className="title">HASH:</span> <span className="text">{wheelState.hash}</span>
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
                  <div className="th">Color</div>
                </div>
              </div>
            </div>
            <div className="table-stats-wrap" style={{ maxHeight: "100%", minHeight: 530 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {wheelState.bets.map((bet) => (
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
                        <td>
                          <span className={`bet-type bet_${bet.color}`}>x{wheelRates[bet.color]}</span>
                        </td>
                      </tr>
                    ))}
                    {wheelState.bets.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ color: "#9eaccd", textAlign: "center" }}>
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
