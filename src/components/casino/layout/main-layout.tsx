import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { FairGameModal } from "./fair-game-modal";
import { GameNavbar } from "./game-navbar";
import { ToastLayer } from "./toast-layer";
import { TopNavbar } from "./top-navbar";
import { WsReadyOverlay } from "./ws-ready-overlay";

type MainLayoutProps = {
  children: ReactNode;
};

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="wrapper">
      <WsReadyOverlay />
      <ToastLayer />
      <FairGameModal />
      <ChatPanel />
      <div className="page">
        <TopNavbar />
        <GameNavbar />
        <main className="main-content">
          <div className="main-content-top">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
