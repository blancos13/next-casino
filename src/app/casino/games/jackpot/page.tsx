"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { openFairGameModal } from "@/components/casino/layout/fair-game-modal";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { getJackpotStore, type JackpotRoom } from "@/components/casino/state/jackpot-store";
import { pushToast } from "@/components/casino/state/toast-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

const jackpotStore = getJackpotStore();

const jackpotRooms = [
  { id: "easy" as JackpotRoom, title: "Easy" },
  { id: "medium" as JackpotRoom, title: "Medium" },
  { id: "hard" as JackpotRoom, title: "Hard" },
];

const asPositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
};

const DEFAULT_AVATAR_SRC = "/img/no_avatar.jpg";

export default function JackpotPage() {
  const [betAmount, setBetAmount] = useState("1.00");
  const jackpotState = useSyncExternalStore(
    jackpotStore.subscribe,
    jackpotStore.getSnapshot,
    jackpotStore.getServerSnapshot,
  );

  const betAmountNum = useMemo(() => asPositive(Number.parseFloat(betAmount)), [betAmount]);

  const ringGradient = useMemo(() => {
    if (jackpotState.chances.length === 0) {
      return "conic-gradient(rgba(255,255,255,0.08) 0deg 360deg)";
    }
    const segments = jackpotState.chances.map((chance) => {
      const start = chance.circle.start;
      const end = chance.circle.end;
      return `${chance.color} ${start}deg ${end}deg`;
    });
    const lastEnd = jackpotState.chances[jackpotState.chances.length - 1]?.circle.end ?? 0;
    if (lastEnd < 360) {
      segments.push(`rgba(255,255,255,0.08) ${lastEnd}deg 360deg`);
    }
    return `conic-gradient(${segments.join(", ")})`;
  }, [jackpotState.chances]);

  const ringAvatars = useMemo(() => {
    return jackpotState.chances
      .filter((chance) => chance.chance >= 5)
      .map((chance) => {
      const mid = (chance.circle.start + chance.circle.end) / 2;
      return {
        id: chance.id,
        deg: mid,
        color: chance.color,
        avatar: chance.avatar || DEFAULT_AVATAR_SRC,
      };
      });
  }, [jackpotState.chances]);

  const timerMinutes = Math.floor(Math.max(0, jackpotState.countdownSec) / 60);
  const timerSeconds = Math.max(0, jackpotState.countdownSec) - timerMinutes * 60;

  const handleBet = async () => {
    if (!betAmountNum) {
      pushToast("error", "Enter a valid bet amount");
      return;
    }
    await jackpotStore.placeBet(Number(betAmountNum.toFixed(2)));
  };

  const adjustBet = (mode: "plus" | "multiply" | "divide" | "max", value: number) => {
    const current = betAmountNum || 0;
    let next = current;
    if (mode === "plus") next = current + value;
    if (mode === "multiply") next = current * value;
    if (mode === "divide") next = current / value;
    if (mode === "max") next = 100;
    setBetAmount(next.toFixed(2));
  };

  return (
    <MainLayout>
      <div className="section game-section">
        <div className="container">
          <div className="game jackpot-prefix">
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
                      <div className="button-group__content rooms">
                        {jackpotRooms.map((room) => (
                          <button
                            className={`btn ${room.id}${jackpotState.room === room.id ? " isActive" : ""}`}
                            key={room.id}
                            onClick={() => void jackpotStore.setRoom(room.id)}
                            type="button"
                          >
                            <span>{room.title}</span>
                          </button>
                        ))}
                      </div>
                      <span className="button-group-label">
                        <span>Rooms</span>
                      </span>
                    </div>

                    <button className="btn btn-green btn-play" onClick={() => void handleBet()} type="button">
                      <span>Make bet</span>
                    </button>
                  </div>

                  <div className="bet-footer">
                    <button className="btn btn-light" onClick={() => openFairGameModal(jackpotState.hash)} type="button">
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                      <span>Fair game</span>
                    </button>
                    <button className="btn btn-light" type="button">
                      <SymbolIcon className="icon icon-history" id="icon-history" />
                      <span>History</span>
                    </button>
                  </div>

                </div>
              </div>
            </div>

            <div className="game-component">
              <div className="game-block">
                <div className="progress-wrap">
                  <div className="progress-item left">
                    <div className="title">
                      Min sum: <span>{jackpotState.minBet.toFixed(2)}</span>{" "}
                      <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                    <div className="title">
                      Max sum: <span>{jackpotState.maxBet.toFixed(2)}</span>{" "}
                      <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                  </div>
                  <div className="progress-item right">
                    <div className="title">
                      Game #<span>{jackpotState.gameId > 0 ? jackpotState.gameId : "----"}</span>
                    </div>
                  </div>
                </div>

                <div className="game-area__wrap">
                  <div className="game-area">
                    <div className="game-area-content">
                      <div className="circle">
                        <div className="fix-circle">
                          <div
                            className="circle_jackpot"
                            id="circle"
                            style={{
                              background: ringGradient,
                            }}
                          />
                        </div>
                        <div className="avatars" aria-hidden="true">
                          {ringAvatars.map((avatar) => (
                            <div className="avatar" key={avatar.id} style={{ transform: `rotate(${avatar.deg}deg)` }}>
                              <span className="avatar-marker" style={{ borderColor: avatar.color }}>
                                <img alt="" src={avatar.avatar || DEFAULT_AVATAR_SRC} />
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="time">
                          <div
                            className="spinner"
                            style={{
                              transition:
                                jackpotState.spinMs > 0 ? `transform ${jackpotState.spinMs}ms ease` : "none",
                              transform: `rotate(${jackpotState.spinnerDeg}deg)`,
                            }}
                          >
                            <SymbolIcon className="icon" id="icon-picker" />
                          </div>
                          <div className="block">
                            <img alt="Win2x" className="jackpot-center-logo" src="/img/logo_small.png" />
                            <div className="title">Bank</div>
                            <div className="value" id="value">
                              {jackpotState.pot.toFixed(2)}
                            </div>
                            <div className="line" />
                            <div className="title">To start</div>
                            <div className="value" id="timer">
                              {String(timerMinutes).padStart(2, "0")}:{String(timerSeconds).padStart(2, "0")}
                            </div>
                          </div>
                        </div>
                      </div>

                      {jackpotState.winner ? (
                        <div
                          className={`game-tooltip isTransparent won ${jackpotState.room}${jackpotState.winnerVisible ? " isActive" : ""}`}
                        >
                          <div className="wrap">
                            <div className="user">
                              <button className="btn btn-link" type="button">
                                <span className="sanitize-user">
                                  <div className="sanitize-avatar">
                                    <img alt="" src={jackpotState.winner.avatar || DEFAULT_AVATAR_SRC} />
                                  </div>
                                  <span className="sanitize-name">{jackpotState.winner.username}</span>
                                </span>
                              </button>
                            </div>
                            {jackpotState.winner.balance > 0 ? (
                              <div className="payout">
                                {jackpotState.winner.balance.toFixed(2)}{" "}
                                <SymbolIcon className="icon icon-coin balance" id="icon-coin" />
                              </div>
                            ) : null}
                            {jackpotState.winner.bonus > 0 ? (
                              <div className="payout">
                                {jackpotState.winner.bonus.toFixed(2)}{" "}
                                <SymbolIcon className="icon icon-coin bonus" id="icon-coin" />
                              </div>
                            ) : null}
                            <div className="badge">
                              <div className="text">Winner</div>
                            </div>
                            <div className="status">
                              <span>
                                Lucky ticket <span className="profit">{jackpotState.winner.ticket}</span>{" "}
                                <SymbolIcon className="icon" id="icon-ticket" />
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="hash">
                        <span className="title">HASH:</span> <span className="text">{jackpotState.hash}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="jackpot-hits">
                <div className="carousel slide" id="carousel">
                  <button className="btn btn-prev" type="button">
                    <SymbolIcon className="icon icon-left" id="icon-left" />
                  </button>
                  <div className="carousel-inner chances">
                    <div
                      className={`carousel-item active items-${Math.max(1, Math.min(6, jackpotState.chances.length || 1))}`}
                      id="chances"
                    >
                      {jackpotState.chances.map((item) => (
                        <div className="item" key={item.id} title={item.username}>
                          <div className="user">
                            <img
                              alt={item.username}
                              src={item.avatar || DEFAULT_AVATAR_SRC}
                              style={{ border: `1px solid ${item.color}` }}
                            />
                          </div>
                          <div className="hit">{item.chance.toFixed(2)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button className="btn btn-next" type="button">
                    <SymbolIcon className="icon icon-left" id="icon-left" />
                  </button>
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
                  <div className="th">Chance</div>
                  <div className="th">Tickets</div>
                </div>
              </div>
            </div>
            <div className="table-stats-wrap" style={{ maxHeight: "100%", minHeight: 530 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {jackpotState.bets.map((row) => (
                      <tr key={row.id}>
                        <td className="username">
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <div className="sanitize-avatar">
                                <img alt={row.username} src={row.avatar || DEFAULT_AVATAR_SRC} style={{ border: `1px solid ${row.color}` }} />
                              </div>
                              <span className="sanitize-name">{row.username}</span>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span>{row.amount.toFixed(2)}</span>
                              <SymbolIcon className={`icon icon-coin ${row.balance}`} id="icon-coin" />
                            </span>
                          </div>
                        </td>
                        <td>{row.chance.toFixed(2)}%</td>
                        <td>
                          <div className="bet-number rtl">
                            <span className="bet-wrap">
                              <span>
                                {row.from} - {row.to}
                              </span>
                              <SymbolIcon className="icon" id="icon-ticket" />
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {jackpotState.bets.length === 0 ? (
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
