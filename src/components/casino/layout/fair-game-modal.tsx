"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCasinoBridge, toWsError } from "../state/casino-bridge";
import { SymbolIcon } from "../ui/symbol-icon";

type FairResult = {
  game: string;
  round: string;
  number: string;
};

const FAIR_MODAL_OPEN_EVENT = "win2x.fair.open";

const asText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
};

const parseFairResult = (payload: unknown): FairResult | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const row = payload as {
    game?: unknown;
    round?: unknown;
    number?: unknown;
  };
  const round = asText(row.round).trim();
  const number = asText(row.number).trim();
  if (!round || !number) {
    return null;
  }
  return {
    game: asText(row.game).trim() || "game",
    round,
    number,
  };
};

export const openFairGameModal = (hash = ""): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(FAIR_MODAL_OPEN_EVENT, {
      detail: { hash },
    }),
  );
};

export function FairGameModal() {
  const bridge = getCasinoBridge();
  const [isOpen, setIsOpen] = useState(false);
  const [hash, setHash] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FairResult | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ hash?: unknown }>;
      const nextHash = typeof customEvent.detail?.hash === "string" ? customEvent.detail.hash.trim() : "";
      setHash(nextHash);
      setIsChecking(false);
      setResult(null);
      setError("");
      setIsOpen(true);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener(FAIR_MODAL_OPEN_EVENT, onOpen as EventListener);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(FAIR_MODAL_OPEN_EVENT, onOpen as EventListener);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  const closeModal = (): void => {
    setIsOpen(false);
  };

  const handleCheck = async (): Promise<void> => {
    const normalizedHash = hash.trim();
    if (!normalizedHash) {
      setResult(null);
      setError("Hash is required.");
      return;
    }
    setIsChecking(true);
    setError("");
    setResult(null);
    try {
      await bridge.ensureReady();
      const payload = await bridge.fairCheck(normalizedHash);
      const parsed = parseFairResult(payload);
      if (!parsed) {
        setError("No verification data found for this hash.");
        return;
      }
      setResult(parsed);
    } catch (errorRaw) {
      setError(toWsError(errorRaw).message);
    } finally {
      setIsChecking(false);
    }
  };

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <div className="fair-game-modal__backdrop" onClick={closeModal} />
      <div aria-modal="true" className="fair-game-modal" onClick={closeModal} role="dialog" tabIndex={-1}>
        <div className="fair-game-modal__dialog" onClick={(event) => event.stopPropagation()} role="document">
          <div className="fair-game-modal__content">
            <button className="modal-close" onClick={closeModal} type="button">
              <SymbolIcon className="icon icon-close" id="icon-close" />
            </button>
            <div className="fair-game-modal__container">
              <h1>
                <span>Fair game</span>
              </h1>
              <span>
                Verify completed rounds by entering a round hash.
              </span>
              <div className="collapse-component">
                <div className="form-field">
                  <div className="input-valid">
                    <input
                      className="input-field input-with-icon"
                      name="hash"
                      onChange={(event) => setHash(event.target.value)}
                      placeholder="Enter hash"
                      value={hash}
                    />
                    <div className="input-icon">
                      <SymbolIcon className="icon icon-fairness" id="icon-fairness" />
                    </div>
                  </div>
                </div>
              </div>
              <button className="btn btn-rotate" onClick={() => void handleCheck()} type="button">
                <span>{isChecking ? "Checking..." : "Check"}</span>
              </button>
              {error ? <div className="fair-game-modal__error">{error}</div> : null}
              {result ? (
                <div className="fair-game-modal__table">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>
                          <span>Game</span>
                        </th>
                        <th>
                          <span>Round</span>
                        </th>
                        <th>
                          <span>Generated number</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{result.game}</td>
                        <td>{result.round}</td>
                        <td>{result.number}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

