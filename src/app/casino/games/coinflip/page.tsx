"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { openFairGameModal } from "@/components/casino/layout/fair-game-modal";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { getCasinoBridge } from "@/components/casino/state/casino-bridge";
import {
  getCoinflipStore,
  type CoinSide,
  type CoinflipOpenGame,
  type CoinflipResolvingGame,
} from "@/components/casino/state/coinflip-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

const coinflipStore = getCoinflipStore();
const bridge = getCasinoBridge();
const DEFAULT_AVATAR = "/img/no_avatar.jpg";

type CoinflipLiveGame = CoinflipOpenGame | CoinflipResolvingGame;

const asPositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
};

const isResolvingGame = (game: CoinflipLiveGame): game is CoinflipResolvingGame => {
  return "phase" in game;
};

const CoinflipGameCard = ({
  game,
  currentUserId,
}: {
  game: CoinflipLiveGame;
  currentUserId: string;
}) => {
  const resolving = isResolvingGame(game);
  const creatorWon = resolving && game.winnerUserId === game.creatorUserId;
  const joinerWon = resolving && game.winnerUserId === game.joinerUserId;
  const showVs = !resolving || game.phase === "prepare" || game.phase === "countdown";
  const showCountdown = resolving && game.phase === "countdown" && game.countdownValue !== null;
  const sliderClass = resolving
    ? game.phase === "spinning"
      ? "is-spinning"
      : game.phase === "revealed"
        ? "is-revealed"
        : ""
    : "";
  const luckyTicket = resolving && game.phase === "revealed" ? String(game.winnerTicket) : "???";

  return (
    <div className={`game-coin${resolving ? " is-resolving" : ""}`}>
      <div className="top">
        <div className="left">
          <div className="players block">
            <div className={`user${creatorWon ? " win" : ""}`}>
              <div className="ava">
                <img alt="" src={game.creatorAvatar || DEFAULT_AVATAR} />
              </div>
              <div className="info">
                <div className="name">{game.creatorUser}</div>
                <p>
                  {game.creatorTicketFrom} - {game.creatorTicketTo} <SymbolIcon className="icon" id="icon-ticket" />
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="center">
          <div className={`vs${showCountdown ? " explode" : ""}${showVs ? "" : " is-hidden"}`}>
            {showCountdown ? game.countdownValue : "VS"}
          </div>
          <div className="arrow" />
          <div className="fixed-height">
            <div className="slider">
              <ul className={sliderClass}>
                {resolving
                  ? game.sliderItems.map((avatar, index) => (
                      <li
                        className={game.phase === "revealed" && index === 2 ? "winner" : ""}
                        key={`${game.id}-${index}`}
                      >
                        <img alt="" src={avatar || DEFAULT_AVATAR} />
                      </li>
                    ))
                  : null}
              </ul>
            </div>
          </div>
        </div>

        <div className="right">
          <div className="players block">
            {resolving ? (
              <div className={`user${joinerWon ? " win" : ""}`}>
                <div className="ava">
                  <img alt="" src={game.joinerAvatar || DEFAULT_AVATAR} />
                </div>
                <div className="info">
                  <div className="name">{game.joinerUser}</div>
                  <p>
                    {game.joinerTicketFrom} - {game.joinerTicketTo} <SymbolIcon className="icon" id="icon-ticket" />
                  </p>
                </div>
              </div>
            ) : (
              <div className="user">
                {game.creatorUserId !== currentUserId ? (
                  <button
                    className="btn btn-primary btn-join"
                    onClick={() => void coinflipStore.joinGame(game.id)}
                    type="button"
                  >
                    <span>Join</span>
                  </button>
                ) : (
                  <div className="info">
                    <div className="name">Expect opponent</div>
                    <p>0 - 0</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bottom">
        <div className="info block">
          <div className="bank">
            <span className="type">Bank:</span>
            <span className="val">
              <span>{(game.amount * 2).toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
            </span>
          </div>
          <div className="ticket">
            <span className="type">Lucky ticket:</span>
            <span className="val">
              <span>{luckyTicket}</span> <SymbolIcon className="icon" id="icon-ticket" />
            </span>
          </div>
        </div>
        <div className="hash">
          <span className="title">HASH:</span> <span className="text">{game.id.replaceAll("-", "")}</span>
        </div>
      </div>
    </div>
  );
};

export default function CoinflipPage() {
  const [betAmount, setBetAmount] = useState("1.00");
  const [side, setSide] = useState<CoinSide>("heads");

  const coinflipState = useSyncExternalStore(
    coinflipStore.subscribe,
    coinflipStore.getSnapshot,
    coinflipStore.getServerSnapshot,
  );
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);

  const betAmountNum = useMemo(() => asPositive(Number.parseFloat(betAmount)), [betAmount]);

  const liveGames = useMemo(() => {
    const resolvingIds = new Set(coinflipState.resolvingGames.map((game) => game.id));
    const openGames = coinflipState.openGames.filter((game) => !resolvingIds.has(game.id));
    return [...coinflipState.resolvingGames, ...openGames];
  }, [coinflipState.openGames, coinflipState.resolvingGames]);

  const yourGames = useMemo(
    () => liveGames.filter((game) => bridgeState.userId && game.creatorUserId === bridgeState.userId),
    [bridgeState.userId, liveGames],
  );

  const activeGames = useMemo(() => liveGames, [liveGames]);

  const handleCreateGame = async () => {
    if (!betAmountNum) {
      return;
    }
    await coinflipStore.createGame(Number(betAmountNum.toFixed(2)), side);
  };

  const adjustBet = (mode: "plus" | "multiply" | "divide" | "max", value: number) => {
    const current = betAmountNum || 0;
    let next = current;
    if (mode === "plus") next = current + value;
    if (mode === "multiply") next = current * value;
    if (mode === "divide") next = current / value;
    if (mode === "max") next = coinflipState.maxBet;
    setBetAmount(next.toFixed(2));
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
                      <div className="button-group__content">
                        <button
                          className={`btn${side === "heads" ? " isActive" : ""}`}
                          onClick={() => setSide("heads")}
                          type="button"
                        >
                          Heads
                        </button>
                        <button
                          className={`btn${side === "tails" ? " isActive" : ""}`}
                          onClick={() => setSide("tails")}
                          type="button"
                        >
                          Tails
                        </button>
                      </div>
                      <span className="button-group-label">
                        <span>Side</span>
                      </span>
                    </div>

                    <button className="btn btn-green btn-play" onClick={() => void handleCreateGame()} type="button">
                      <span>Make game</span>
                    </button>
                  </div>
                  <div className="bet-footer">
                    <button
                      className="btn btn-light"
                      onClick={() => openFairGameModal(coinflipState.endedGames[0]?.id ?? "")}
                      type="button"
                    >
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                      <span>Fair game</span>
                    </button>
                  </div>
                  {coinflipState.status ? (
                    <div style={{ color: "#aeb9d1", fontSize: 11, marginTop: 8, textAlign: "center" }}>
                      {coinflipState.status}
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
                      Min sum: <span>{coinflipState.minBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                    <div className="title">
                      Max sum: <span>{coinflipState.maxBet.toFixed(2)}</span> <SymbolIcon className="icon icon-coin" id="icon-coin" />
                    </div>
                  </div>
                </div>

                <div className="game-area__wrap">
                  <div className="game-area">
                    <div className="game-area-content">
                      <div className="coinflip-games">
                        <div className="yours">
                          <div className="line">
                            <span>You game</span>
                          </div>
                          <div className="scroll">
                            {yourGames.length > 0 ? (
                              yourGames.map((game) => (
                                <CoinflipGameCard currentUserId={bridgeState.userId} game={game} key={game.id} />
                              ))
                            ) : (
                              <div className="game-coin">
                                <div className="bottom">
                                  <div className="info block">
                                    <div className="bank">
                                      <span className="type">No open game</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="actives">
                          <div className="line">
                            <span>All games</span>
                          </div>
                          <div className="scroll">
                            {activeGames.length > 0 ? (
                              activeGames.map((game) => (
                                <CoinflipGameCard currentUserId={bridgeState.userId} game={game} key={game.id} />
                              ))
                            ) : (
                              <div className="game-coin">
                                <div className="bottom">
                                  <div className="info block">
                                    <div className="bank">
                                      <span className="type">No open games</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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
                  <div className="th">Participants</div>
                  <div className="th" />
                  <div className="th">Winner</div>
                  <div className="th">Bank</div>
                  <div className="th">Lucky ticket</div>
                  <div className="th">Check</div>
                </div>
              </div>
            </div>
            <div className="table-stats-wrap" style={{ maxHeight: "100%", minHeight: 530 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {coinflipState.endedGames.map((row) => (
                      <tr key={row.id}>
                        <td className="username">
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <div className="sanitize-avatar">
                                <img alt="" src={row.creatorAvatar || DEFAULT_AVATAR} />
                              </div>
                              <span className="sanitize-name">{row.creatorUser}</span>
                            </span>
                          </button>
                        </td>
                        <td className="username">
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <div className="sanitize-avatar">
                                <img alt="" src={row.joinerAvatar || DEFAULT_AVATAR} />
                              </div>
                              <span className="sanitize-name">{row.joinerUser}</span>
                            </span>
                          </button>
                        </td>
                        <td className="username">
                          <button className="btn btn-link" type="button">
                            <span className="sanitize-user">
                              <div className="sanitize-avatar">
                                <img alt="" src={row.winnerAvatar || DEFAULT_AVATAR} style={{ border: "solid 1px #4986f5" }} />
                              </div>
                              <span className="sanitize-name">{row.winnerUser}</span>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span>{(row.amount * 2).toFixed(2)}</span>
                              <SymbolIcon className="icon icon-coin" id="icon-coin" />
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="bet-number">
                            <span className="bet-wrap">
                              <span>{row.winnerTicket}</span>
                              <SymbolIcon className="icon" id="icon-ticket" />
                            </span>
                          </div>
                        </td>
                        <td>
                          <button className="btn btn-primary" onClick={() => openFairGameModal(row.id)} type="button">
                            Check
                          </button>
                        </td>
                      </tr>
                    ))}
                    {coinflipState.endedGames.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ color: "#9eaccd", textAlign: "center" }}>
                          No finished games yet
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
