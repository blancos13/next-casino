"use client";

import { useSyncExternalStore } from "react";
import { getCasinoBridge } from "../state/casino-bridge";

const bridge = getCasinoBridge();

export function WsReadyOverlay() {
  const bridgeState = useSyncExternalStore(
    bridge.subscribeStore,
    bridge.getState,
    bridge.getServerSnapshot,
  );

  if (bridgeState.isReady) {
    return null;
  }

  return (
    <div className="ws-loading-screen">
      <div className="ws-loading-spinner" />
      <div className="ws-loading-text">Loading...</div>
    </div>
  );
}
