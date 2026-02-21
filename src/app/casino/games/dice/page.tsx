"use client";

import type { CSSProperties } from "react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { openFairGameModal } from "@/components/casino/layout/fair-game-modal";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { getDiceStore } from "@/components/casino/state/dice-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const clampTarget = (value: number): number => clamp(value, 2, 98);
const diceStore = getDiceStore();

export default function DicePage() {
  const [betAmount, setBetAmount] = useState("1.00");
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<"under" | "over">("under");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSliderActive, setIsSliderActive] = useState(false);
  const [showRollMarker, setShowRollMarker] = useState(false);
  const sliderHideTimerRef = useRef<number | null>(null);
  const cubeHideTimerRef = useRef<number | null>(null);

  const diceState = useSyncExternalStore(diceStore.subscribe, diceStore.getSnapshot, diceStore.getServerSnapshot);

  const bet = useMemo(() => {
    const parsed = Number.parseFloat(betAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [betAmount]);

  const chance = useMemo(() => {
    const raw = direction === "over" ? 100 - target : target;
    return Number(clamp(raw, 2, 98).toFixed(2));
  }, [direction, target]);

  const multiplier = useMemo(() => {
    const raw = 96 / chance;
    return Number.isFinite(raw) ? raw : 0;
  }, [chance]);

  const winAmount = useMemo(() => bet * multiplier, [bet, multiplier]);

  const handleBetChange = (value: string) => {
    if (!value) {
      setBetAmount("");
      return;
    }
    if (/^\d*\.?\d{0,2}$/.test(value)) {
      setBetAmount(value);
    }
  };

  const adjustBet = (mode: "plus" | "multiply" | "divide" | "max", value: number) => {
    const current = bet;
    let next = current;
    if (mode === "plus") next = current + value;
    if (mode === "multiply") next = current * value;
    if (mode === "divide") next = current / value;
    if (mode === "max") next = diceState.maxBet;
    setBetAmount(next.toFixed(2));
  };

  const handleRoll = async () => {
    if (isSubmitting) {
      return;
    }

    const parsedAmount = Number.parseFloat(betAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      diceStore.setStatus("Bet amount invalid");
      return;
    }

    setIsSubmitting(true);
    diceStore.setStatus("");

    const ok = await diceStore.placeBet({
      amount: parsedAmount,
      chance,
      direction,
    });

    if (ok) {
      setShowRollMarker(true);
      if (cubeHideTimerRef.current !== null) {
        window.clearTimeout(cubeHideTimerRef.current);
      }
      cubeHideTimerRef.current = window.setTimeout(() => {
        setShowRollMarker(false);
        cubeHideTimerRef.current = null;
      }, 4000);
    }

    setIsSubmitting(false);
  };

  const sliderBackground =
    direction === "under"
      ? `linear-gradient(to right, #62ca5b 0%, #62ca5b ${target}%, #e86376 ${target}%, #e86376 100%)`
      : `linear-gradient(to right, #e86376 0%, #e86376 ${target}%, #62ca5b ${target}%, #62ca5b 100%)`;

  const applyChance = (nextChance: number) => {
    if (!Number.isFinite(nextChance)) {
      return;
    }
    const normalizedChance = clamp(nextChance, 2, 98);
    const nextTarget = direction === "over" ? 100 - normalizedChance : normalizedChance;
    setTarget(Number(clampTarget(nextTarget).toFixed(2)));
  };

  const applyTarget = (nextTarget: number) => {
    if (!Number.isFinite(nextTarget)) {
      return;
    }
    setTarget(Number(clampTarget(nextTarget).toFixed(2)));
  };

  const setDirectionWithMirroredTarget = (nextDirection: "under" | "over") => {
    if (nextDirection === direction) {
      return;
    }
    const flippedTarget = 100 - target;
    setDirection(nextDirection);
    setTarget(Number(clampTarget(flippedTarget).toFixed(2)));
  };

  const showSliderLabel = () => {
    if (sliderHideTimerRef.current !== null) {
      window.clearTimeout(sliderHideTimerRef.current);
      sliderHideTimerRef.current = null;
    }
    setIsSliderActive(true);
  };

  const scheduleHideSliderLabel = () => {
    if (sliderHideTimerRef.current !== null) {
      window.clearTimeout(sliderHideTimerRef.current);
    }
    sliderHideTimerRef.current = window.setTimeout(() => {
      setIsSliderActive(false);
      sliderHideTimerRef.current = null;
    }, 1000);
  };

  return (
    <MainLayout>
      <div className="section game-section">
        <div className="container">
          <div className="game">
            <div className="game-sidebar">
              <div className="sidebar-block">
                <div className="bet-component">
                  <div className="bet-form">
                    <div className="form-row">
                      <label>
                        <div className="form-label">
                          <span>Bet Amount</span>
                        </div>
                        <div className="form-row">
                          <div className="form-field">
                            <input
                              className="input-field no-bottom-radius"
                              id="sum"
                              name="sum"
                              onChange={(event) => handleBetChange(event.target.value)}
                              type="text"
                              value={betAmount}
                            />
                            <button className="btn btn-bet-clear" type="button">
                              x
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
                        <div className="two-cols">
                          <div className="form-row">
                            <label>
                              <div className="form-label">
                                <span>Rate</span>
                              </div>
                              <div className="form-field">
                                <div className="input-valid">
                                  <input
                                    className="input-field"
                                    id="coef"
                                    onChange={(event) => {
                                      const nextMultiplier = Number.parseFloat(event.target.value);
                                      if (!Number.isFinite(nextMultiplier) || nextMultiplier <= 0) {
                                        return;
                                      }
                                      applyChance(96 / nextMultiplier);
                                    }}
                                    value={multiplier.toFixed(2)}
                                  />
                                  <div className="input-suffix">
                                    <span>{multiplier.toFixed(2)}</span> x
                                  </div>
                                  <div className="valid" />
                                </div>
                              </div>
                            </label>
                          </div>
                          <div className="form-row">
                            <label>
                              <div className="form-label">
                                <span>Chance</span>
                              </div>
                              <div className="form-field">
                                <div className="input-valid">
                                  <input
                                    className="input-field"
                                    id="chance"
                                    onChange={(event) => {
                                      applyChance(Number.parseFloat(event.target.value));
                                    }}
                                    value={chance.toFixed(2)}
                                  />
                                  <div className="input-suffix">
                                    <span>{chance.toFixed(2)}</span> %
                                  </div>
                                  <div className="valid" />
                                </div>
                              </div>
                            </label>
                          </div>
                        </div>
                        <div className="form-row">
                          <label>
                            <div className="form-label">
                              <span>Win</span>
                            </div>
                            <div className="form-field">
                              <input
                                className="input-field"
                                id="win"
                                onChange={(event) => {
                                  const nextWin = Number.parseFloat(event.target.value);
                                  if (!Number.isFinite(nextWin) || multiplier <= 0) {
                                    return;
                                  }
                                  setBetAmount((nextWin / multiplier).toFixed(2));
                                }}
                                value={winAmount.toFixed(2)}
                              />
                            </div>
                          </label>
                        </div>
                        <div className="form-row">
                          <div className="buttons-group buttons-group--tall">
                            <button
                              className={`btn btn-action${direction === "under" ? " isActive" : ""}`}
                              onClick={() => setDirectionWithMirroredTarget("under")}
                              type="button"
                            >
                              Under
                            </button>
                            <button
                              className={`btn btn-action${direction === "over" ? " isActive" : ""}`}
                              onClick={() => setDirectionWithMirroredTarget("over")}
                              type="button"
                            >
                              Over
                            </button>
                          </div>
                        </div>
                      </label>
                    </div>
                    <button
                      className="btn btn-green btn-play"
                      disabled={isSubmitting}
                      onClick={() => void handleRoll()}
                      type="button"
                    >
                      <span>Make Bet</span>
                    </button>
                    {diceState.status ? (
                      <div style={{ color: "#aeb9d1", fontSize: 11, marginTop: 8, textAlign: "center" }}>
                        {diceState.status}
                      </div>
                    ) : null}
                  </div>
                  <div className="bet-footer">
                    <button className="btn btn-light" onClick={() => openFairGameModal(diceState.diceHash)} type="button">
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                      <span>Fair game</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="game-component">
              <div className="game-block">
                <div className="game-area__wrap">
                  <div className="game-area">
                    <div className="progress-wrap">
                      <div className="progress-item left">
                        <div className="title">
                          Min Bet: <span>{diceState.minBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                        </div>
                        <div className="title">
                          Max Bet: <span>{diceState.maxBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                        </div>
                      </div>
                    </div>
                    <div className="top-corners" />
                    <div className="bottom-corners" />
                    <div className="game-area-content">
                      <div className="dice">
                        <div className="game-dice">
                          <img alt="" src="/img/dice-bg.svg" />
                          <span
                            className={`result${diceState.rollResult !== null ? " visible" : ""}${
                              diceState.lastWin === true ? " positive" : diceState.lastWin === false ? " negative" : ""
                            }`}
                          >
                            {diceState.rollResult !== null ? diceState.rollResult.toFixed(2) : ""}
                          </span>
                        </div>
                        <div className="game-bar">
                          <div
                            className="dice-roll"
                            style={diceState.rollResult !== null ? ({ transform: `translate(${diceState.rollResult}%, 0px)` } as CSSProperties) : undefined}
                          >
                            <div
                              className={`dice__cube${showRollMarker ? " visible" : ""}${
                                diceState.lastWin === true ? " positive" : diceState.lastWin === false ? " negative" : ""
                              }`}
                            />
                          </div>
                          <span
                            className="input-range__slider-container"
                            style={{ left: `calc(${target}% + ${(50 - target) * 0.24}px)`, position: "absolute" }}
                          >
                            <span className={`input-range__label input-range__label--value${isSliderActive ? " isActive" : ""}`}>
                              <span className="input-range__label-container">{target.toFixed(2)}</span>
                            </span>
                          </span>
                          <div aria-disabled="false" className="input-range">
                            <div className="cntr" id="range" />
                            <input
                              className="range"
                              id="r1"
                              max={100}
                              min={0}
                              onMouseDown={showSliderLabel}
                              onMouseMove={showSliderLabel}
                              onMouseOut={scheduleHideSliderLabel}
                              onMouseUp={scheduleHideSliderLabel}
                              onTouchEnd={scheduleHideSliderLabel}
                              onTouchStart={showSliderLabel}
                              onChange={(event) => applyTarget(Number(event.target.value))}
                              step={0.01}
                              style={{ background: sliderBackground } as CSSProperties}
                              type="range"
                              value={target}
                            />
                          </div>
                          <div className="bar-component">
                            <div className="bar-labels">
                              <div className="item">
                                <span>0</span>
                              </div>
                              <div className="item">
                                <span>25</span>
                              </div>
                              <div className="item">
                                <span>50</span>
                              </div>
                              <div className="item">
                                <span>75</span>
                              </div>
                              <div className="item">
                                <span>100</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="game-history__wrap">
                <div className="hash">
                  <span className="title">HASH:</span> <span className="text">{diceState.diceHash}</span>
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
                  <div className="th">Roll</div>
                  <div className="th">Rate</div>
                  <div className="th">Chance</div>
                  <div className="th">Win</div>
                </div>
              </div>
            </div>
            <div className="table-stats-wrap" style={{ maxHeight: "100%", minHeight: 530 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {diceState.historyRows.map((row) => (
                      <tr key={row.id}>
                        <td className="username" style={{ width: "24%" }}>
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <span className="sanitize-avatar">
                                <img alt="" src="/img/no_avatar.jpg" />
                              </span>
                              <span className="sanitize-name" style={{ color: "#fff" }}>
                                {row.user}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span>{row.bet.toFixed(2)}</span>
                              <SymbolIcon className="icon icon-coin" id="icon-coin" />
                            </span>
                          </div>
                        </td>
                        <td>{row.roll.toFixed(2)}</td>
                        <td>x{row.multiplier.toFixed(2)}</td>
                        <td>{row.chance.toFixed(2)}%</td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span className={row.win ? "win" : "lose"}>
                                {row.win ? "+" : "-"}
                                {Math.abs(row.result).toFixed(2)}
                              </span>
                              <SymbolIcon className="icon icon-coin" id="icon-coin" />
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
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
