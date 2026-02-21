"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getCasinoBridge, toWsError } from "../state/casino-bridge";
import { getChatStore } from "../state/chat-store";
import { pushToast } from "../state/toast-store";
import { SymbolIcon } from "../ui/symbol-icon";

const toneColor = {
  default: "#d8e1f7",
  loss: "#e86376",
  win: "#62ca5b",
};

const chatStore = getChatStore();
const bridge = getCasinoBridge();

type ChatUserCard = {
  userId: string;
  username: string;
  avatar: string;
  betAmount: string;
  totalGames: number;
  wins: number;
  lose: number;
};
const parseChatUserCard = (payload: unknown): ChatUserCard | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const row = payload as Record<string, unknown>;
  const userId = typeof row.userId === "string" ? row.userId : "";
  if (!userId) {
    return null;
  }
  const toInt = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.trunc(parsed));
      }
    }
    return 0;
  };
  const toAmount = (value: unknown): string => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toFixed(2);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed.toFixed(2);
      }
      if (value.trim().length > 0) {
        return value;
      }
    }
    return "0.00";
  };
  return {
    userId,
    username: typeof row.username === "string" && row.username.trim().length > 0 ? row.username : "Player",
    avatar: typeof row.avatar === "string" && row.avatar.trim().length > 0 ? row.avatar : "/img/no_avatar.jpg",
    betAmount: toAmount(row.betAmount),
    totalGames: toInt(row.totalGames),
    wins: toInt(row.wins),
    lose: toInt(row.lose),
  };
};
export function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "profile">("chat");
  const [profileStatus, setProfileStatus] = useState("");
  const [userCardOpen, setUserCardOpen] = useState(false);
  const [userCardLoading, setUserCardLoading] = useState(false);
  const [userCardError, setUserCardError] = useState("");
  const [userCard, setUserCard] = useState<ChatUserCard | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const chatState = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getServerSnapshot);
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);

  useEffect(() => {
    const element = conversationRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [chatState.messages.length]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated && activeTab !== "chat") {
      setActiveTab("chat");
    }
  }, [activeTab, bridgeState.isAuthenticated]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    await chatStore.sendMessage(trimmed);
    setDraft("");
  };

  const handleLogout = async () => {
    try {
      await bridge.logout();
      setProfileStatus("");
      setActiveTab("chat");
    } catch (error) {
      setProfileStatus(toWsError(error).message);
    }
  };

  const handleShareBalance = async () => {
    if (!bridgeState.isAuthenticated) {
      bridge.openAuthDialog("login");
      pushToast("info", "Please login to share balance in chat.");
      return;
    }

    const message = `Balance: ${bridgeState.balanceMain} | Bonus: ${bridgeState.balanceBonus}`;
    try {
      await bridge.ensureReady();
      await bridge.sendChat(message);
      pushToast("success", "Balance shared in chat.");
    } catch (error) {
      pushToast("error", toWsError(error).message);
    }
  };

  const closeUserCard = (): void => {
    setUserCardOpen(false);
    setUserCardLoading(false);
    setUserCardError("");
    setUserCard(null);
  };
  const openUserCard = async (userId?: string): Promise<void> => {
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      pushToast("error", "User information is unavailable.");
      return;
    }
    setUserCardOpen(true);
    setUserCardLoading(true);
    setUserCardError("");
    setUserCard(null);
    try {
      await bridge.ensureReady();
      const payload = await bridge.getChatUserCard(normalizedUserId);
      const parsed = parseChatUserCard(payload);
      if (!parsed) {
        setUserCardError("Unable to load user card.");
        return;
      }
      setUserCard(parsed);
    } catch (error) {
      setUserCardError(toWsError(error).message);
    } finally {
      setUserCardLoading(false);
    }
  };
  const userCardModal =
    userCardOpen && typeof document !== "undefined"
      ? createPortal(
          <>
            <div className="chat-user-modal__backdrop" onClick={closeUserCard} />
            <div
              aria-hidden={!userCardOpen}
              aria-modal="true"
              className="chat-user-modal"
              onClick={closeUserCard}
              role="dialog"
              tabIndex={-1}
            >
              <div className="chat-user-modal__dialog user-modal" onClick={(event) => event.stopPropagation()} role="document">
                <div className="chat-user-modal__content">
                  <button className="modal-close" onClick={closeUserCard} type="button">
                    <SymbolIcon className="icon icon-close" id="icon-close" />
                  </button>
                  <div className="user-modal__container">
                    {userCardLoading ? <div className="no-stats">Loading user stats...</div> : null}
                    {!userCardLoading && userCardError ? <div className="no-stats">{userCardError}</div> : null}
                    {!userCardLoading && !userCardError && userCard ? (
                      <>
                        <div className="user-modal__head">
                          <div className="avatar">
                            <img alt="" src={userCard.avatar} />
                          </div>
                          <div className="user-block">
                            <div className="user-name">{userCard.username}</div>
                          </div>
                        </div>
                        <div className="card-stats">
                          <div className="stats-item">
                            <div className="item-label">Bet amount</div>
                            <div className="item-value positive">
                              <div className="icon-wrapper">
                                <SymbolIcon className="icon icon-coin" id="icon-coin" />
                              </div>
                              {userCard.betAmount}
                            </div>
                          </div>
                          <div className="stats-item">
                            <div className="item-label">Total games</div>
                            <div className="item-value">{userCard.totalGames}</div>
                          </div>
                        </div>
                        <div className="card-stats">
                          <div className="stats-item">
                            <div className="item-label">Victories</div>
                            <div className="item-value">{userCard.wins}</div>
                          </div>
                          <div className="stats-item">
                            <div className="item-label">Defeats</div>
                            <div className="item-value">{userCard.lose}</div>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )
      : null;
  return (
    <div className="right-sidebar chat-sidebar-react">
      <div className="sidebar-container">
        {bridgeState.isAuthenticated ? (
          <div className="tabs-nav">
            <div className={`item${activeTab === "chat" ? " current" : ""}`} onClick={() => setActiveTab("chat")}>
              <SymbolIcon className="icon icon-conversations" id="icon-conversations" />
              <span>Chat</span>
            </div>
            <div className={`item${activeTab === "profile" ? " current" : ""}`} onClick={() => setActiveTab("profile")}>
              <SymbolIcon className="icon icon-person" id="icon-person" />
              <span>Profile</span>
            </div>
          </div>
        ) : null}

        <div className={`chat tab${activeTab === "chat" ? " current" : ""}`}>
          <div className="chat-params">
            <div className="item">
              <div className="chat-online">
                Online: <span>{chatState.onlineCount}</span>
              </div>
            </div>
            <div className="item">
              <div className="share">
                <button onClick={() => void handleShareBalance()} title="Share balance to chat" type="button">
                  <SymbolIcon className="icon icon-coin" id="icon-coin" />
                </button>
              </div>
              <button className="close-btn" onClick={() => setActiveTab("chat")} type="button">
                <SymbolIcon className="icon icon-close" id="icon-close" />
              </button>
            </div>
          </div>

          <div className="chat-conversation">
            <div className="chat-conversation-inner chat-conversation-inner-react" ref={conversationRef}>
              {chatState.messages.map((message) => (
                <div className="message-block" key={message.id}>
                  <div className="message-avatar">
                    <img alt="" src="/img/no_avatar.jpg" />
                  </div>
                  <div className="message-content">
                    <div>
                      <button className="user-link" onClick={() => void openUserCard(message.userId)} type="button">
                        {message.user}
                      </button>{" "}
                      <span className="message-text" style={{ color: toneColor[message.tone] }}>
                        {message.message}
                      </span>
                    </div>
                    <span>{message.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {bridgeState.isAuthenticated ? (
            <div className="chat-message-input">
              <div className="chat-textarea">
                <textarea
                  className="chat-editable"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Write a message"
                  value={draft}
                />
              </div>
              <div className="chat-controls">
                <button className="item" type="button">
                  <SymbolIcon className="icon icon-smile" id="icon-smile" />
                </button>
                <button className="item" onClick={() => void handleSend()} type="button">
                  <SymbolIcon className="icon icon-send" id="icon-send" />
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-empty-block">You must be logged in to chat</div>
          )}

          {chatState.status ? (
            <div style={{ color: "#9eaccd", fontSize: 11, marginTop: 8, textAlign: "center" }}>
              {chatState.status}
            </div>
          ) : null}
        </div>

        <div className={`user-profile tab${activeTab === "profile" ? " current" : ""}`}>
          {bridgeState.isAuthenticated ? (
            <>
              <div className="user-block">
                <div className="user-avatar">
                  <button className="close-btn" onClick={() => setActiveTab("chat")} type="button">
                    <SymbolIcon className="icon icon-close" id="icon-close" />
                  </button>
                  <div className="avatar">
                    <img alt="" src="/img/no_avatar.jpg" />
                  </div>
                </div>
                <div className="user-name">
                  <div className="nickname">{bridgeState.username || "Player"}</div>
                </div>
              </div>
              <ul className="profile-nav">
                <li>
                  <Link href="/profile/history">
                    <div className="item-icon">
                      <SymbolIcon className="icon icon-history" id="icon-history" />
                    </div>
                    <span>History</span>
                  </Link>
                </li>
              </ul>
              <button className="btn btn-logout" onClick={() => void handleLogout()} type="button">
                <div className="item-icon">
                  <SymbolIcon className="icon icon-logout" id="icon-logout" />
                </div>
                <span>Logout</span>
              </button>
              {profileStatus ? (
                <div style={{ color: "#9eaccd", fontSize: 11, marginTop: 8, textAlign: "center" }}>
                  {profileStatus}
                </div>
              ) : null}
            </>
          ) : (
            <div className="chat-empty-block">You must be logged in to profile</div>
          )}
        </div>
      </div>
      {userCardModal}
    </div>
  );
}
