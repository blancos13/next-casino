"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { openFairGameModal } from "@/components/casino/layout/fair-game-modal";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { getBattleStore, type BattleTeam } from "@/components/casino/state/battle-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

const battleStore = getBattleStore();

const TAU = Math.PI * 2;
const OUTER_RADIUS = 200;
const INNER_RADIUS = 180;
const FULL_RING_PATH =
  "M0,-200A200,200,0,1,1,0,200A200,200,0,1,1,0,-200L0,-180A180,180,0,1,0,0,180A180,180,0,1,0,0,-180Z";

const asPositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const trimNumber = (value: number): string => {
  const fixed = value.toFixed(2);
  if (fixed.endsWith(".00")) {
    return fixed.slice(0, -3);
  }
  if (fixed.endsWith("0")) {
    return fixed.slice(0, -1);
  }
  return fixed;
};

const pointForAngle = (radius: number, angle: number): { x: number; y: number } => ({
  x: Number((radius * Math.sin(angle)).toFixed(6)),
  y: Number((-radius * Math.cos(angle)).toFixed(6)),
});

const buildDonutSegmentPath = (startAngle: number, endAngle: number): string => {
  let span = endAngle - startAngle;
  if (!Number.isFinite(span)) {
    return "";
  }
  if (span < 0) {
    span = ((span % TAU) + TAU) % TAU;
  }
  if (span <= 0.000001) {
    return "";
  }
  if (span >= TAU - 0.000001) {
    return FULL_RING_PATH;
  }

  const outerStart = pointForAngle(OUTER_RADIUS, startAngle);
  const outerEnd = pointForAngle(OUTER_RADIUS, endAngle);
  const innerEnd = pointForAngle(INNER_RADIUS, endAngle);
  const innerStart = pointForAngle(INNER_RADIUS, startAngle);
  const largeArcFlag = span > Math.PI ? 1 : 0;

  return [
    `M${outerStart.x},${outerStart.y}`,
    `A${OUTER_RADIUS},${OUTER_RADIUS},0,${largeArcFlag},1,${outerEnd.x},${outerEnd.y}`,
    `L${innerEnd.x},${innerEnd.y}`,
    `A${INNER_RADIUS},${INNER_RADIUS},0,${largeArcFlag},0,${innerStart.x},${innerStart.y}`,
    "Z",
  ].join("");
};

export default function BattlePage() {
  const [betAmount, setBetAmount] = useState("1.00");
  const [selectedTeam, setSelectedTeam] = useState<BattleTeam>("red");
  const battleState = useSyncExternalStore(
    battleStore.subscribe,
    battleStore.getSnapshot,
    battleStore.getServerSnapshot,
  );

  const betAmountNum = useMemo(() => asPositive(Number.parseFloat(betAmount)), [betAmount]);

  const redChance = clamp(battleState.chances[0], 0, 100);
  const blueChance = clamp(battleState.chances[1], 0, 100);
  const blueRatio = clamp(blueChance / 100, 0, 1);
  const bluePath = useMemo(() => buildDonutSegmentPath(0, TAU * blueRatio), [blueRatio]);
  const redPath = useMemo(() => buildDonutSegmentPath(TAU * blueRatio, TAU), [blueRatio]);

  const redFactor = asPositive(battleState.factor[0]) || 2;
  const blueFactor = asPositive(battleState.factor[1]) || 2;
  const redBank = asPositive(battleState.bank[0]);
  const blueBank = asPositive(battleState.bank[1]);

  const redTicketEnd = clamp(Math.round(asPositive(battleState.tickets[0]) || 500), 1, 999);
  const blueTicketStart = clamp(
    Math.round(asPositive(battleState.tickets[1]) || redTicketEnd + 1),
    redTicketEnd + 1,
    1000,
  );

  const countdownSec = Math.max(0, Math.floor(battleState.countdownSec));
  const countdownMin = Math.floor(countdownSec / 60);
  const countdownRem = countdownSec - countdownMin * 60;
  const countdownLabel = `${String(countdownMin).padStart(2, "0")}:${String(countdownRem).padStart(2, "0")}`;

  const handleBet = async () => {
    if (!betAmountNum) {
      return;
    }
    await battleStore.placeBet(Number(betAmountNum.toFixed(2)), selectedTeam);
  };

  const adjustBet = (mode: "plus" | "multiply" | "divide" | "max", value: number) => {
    const current = betAmountNum || 0;
    let next = current;
    if (mode === "plus") next = current + value;
    if (mode === "multiply") next = current * value;
    if (mode === "divide") next = current / value;
    if (mode === "max") next = asPositive(battleState.maxBet);
    setBetAmount(next.toFixed(2));
  };

  return (
    <MainLayout>
      <div className="section game-section">
        <div className="container">
          <div className="game battle-prefix">
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

                    <div className="command-type btnToggle">
                      <button
                        className={`btn-bet bet-red${selectedTeam === "red" ? " isActive" : ""}`}
                        onClick={() => setSelectedTeam("red")}
                        type="button"
                      >
                        <div className="bet-chance">
                          <div className="chance-text">
                            <span id="red_persent">{trimNumber(redChance)}%</span>
                            <br />
                            Red
                            <p id="red_tickets">1 - {redTicketEnd}</p>
                          </div>
                        </div>
                        <div className="bet-text" id="red_factor">
                          x{trimNumber(redFactor)}
                        </div>
                      </button>
                      <button
                        className={`btn-bet bet-blue${selectedTeam === "blue" ? " isActive" : ""}`}
                        onClick={() => setSelectedTeam("blue")}
                        type="button"
                      >
                        <div className="bet-chance">
                          <div className="chance-text">
                            <span id="blue_persent">{trimNumber(blueChance)}%</span>
                            <br />
                            Blue
                            <p id="blue_tickets">
                              {blueTicketStart} - 1000
                            </p>
                          </div>
                        </div>
                        <div className="bet-text" id="blue_factor">
                          x{trimNumber(blueFactor)}
                        </div>
                      </button>
                    </div>

                    <button className="btn btn-green btn-play" onClick={() => void handleBet()} type="button">
                      <span>Make bet</span>
                    </button>
                  </div>

                  <div className="bet-footer">
                    <button className="btn btn-light" onClick={() => openFairGameModal(battleState.hash)} type="button">
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                      <span>Fair game</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="game-component">
              <div className="game_Wheel">
                <div className="progress-wrap">
                  <div className="progress-item left">
                    <div className="title">
                      Min Bet: <span id="minBet">{battleState.minBet.toFixed(2)}</span>{" "}
                      <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                    <div className="title">
                      Max Bet: <span id="maxBet">{battleState.maxBet.toFixed(2)}</span>{" "}
                      <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                  </div>
                  <div className="progress-item right">
                    <div className="title">
                      Game #<span id="gameId">{battleState.gameId || "----"}</span>
                    </div>
                  </div>
                </div>

                <div className="wheel-game">
                  <div className="wheel-content">
                    <svg className="UsersInterestChart" height="400" width="400">
                      <g className="chart" transform="translate(200, 200)">
                        <g className="timer" transform="translate(0,0)">
                          <g
                            className="bets"
                            id="circle"
                            style={{
                              transition:
                                battleState.spinMs > 0
                                  ? `transform ${battleState.spinMs}ms cubic-bezier(0.15, 0.15, 0, 1)`
                                  : "none",
                              transform: `rotate(${battleState.rotationDeg}deg)`,
                            }}
                          >
                            <path
                              d={bluePath || "M0,0"}
                              fill="#4986f5"
                              id="blue"
                              strokeWidth="5px"
                              style={{ opacity: bluePath ? 1 : 0 }}
                              transform="rotate(0)"
                            />
                            <path
                              d={redPath || "M0,0"}
                              fill="#e86376"
                              id="red"
                              strokeWidth="5px"
                              style={{ opacity: redPath ? 1 : 0 }}
                              transform="rotate(0)"
                            />
                          </g>
                        </g>
                      </g>
                      <polygon
                        points="200,10 220,40 180,40"
                        style={{ fill: "#ffffff", stroke: "rgba(255, 255, 255, 0.05)", strokeWidth: "5px" }}
                      />
                    </svg>

                    <div className="time">
                      <div className="block">
                        <div className="title">Bank</div>
                        <div className="value bank" id="value" style={{ color: "#7b8893" }}>
                          <span id="red_sum" style={{ color: "#e86376" }}>
                            {redBank.toFixed(2)}
                          </span>
                          /
                          <span id="blue_sum" style={{ color: "#4986f5" }}>
                            {blueBank.toFixed(2)}
                          </span>
                        </div>
                        <div className="line" />
                        <div className="title">To start</div>
                        <div className="value" id="timer">
                          {countdownLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="history_wrapper">
                  <div className="history_history">
                    {battleState.history.map((item, index) => (
                      <button
                        className={`item history_item history_${item.color} checkGame`}
                        data-hash={item.hash}
                        key={`${item.color}-${item.hash}-${index}`}
                        onClick={() => openFairGameModal(item.hash || battleState.hash)}
                        style={{ border: 0, padding: 0, background: "transparent" }}
                        type="button"
                      />
                    ))}
                  </div>
                </div>

                <div className="hash">
                  <span className="title">HASH:</span> <span className="text">{battleState.hash}</span>
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
                  <div className="th">Team</div>
                </div>
              </div>
            </div>
            <div className="table-stats-wrap" style={{ maxHeight: "100%", minHeight: 530 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {battleState.bets.map((bet) => (
                      <tr key={bet.id}>
                        <td className="username">
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <div className="sanitize-avatar">
                                <img alt="" src={bet.avatar} />
                              </div>
                              <span className="sanitize-name">{bet.user}</span>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span>{bet.amount.toFixed(2)}</span>
                              <SymbolIcon className={`icon icon-coin ${bet.balType}`} id="icon-coin" />
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`bet-type bet_${bet.team}`}>{bet.team === "red" ? "Red" : "Blue"}</span>
                        </td>
                      </tr>
                    ))}
                    {battleState.bets.length === 0 ? (
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
