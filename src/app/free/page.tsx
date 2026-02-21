"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";
import { pushToast } from "@/components/casino/state/toast-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

type BonusMode = "group" | "refs";
type BonusSector = {
  id: string;
  label: string;
  reward: number;
  weight: number;
};

type AffiliateStatsLike = {
  registrations?: unknown;
};

const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;
const SPIN_DURATION_MS = 4_000;
const REFERRAL_GOAL = 10;
const REFERRAL_REWARD = 15;
const DEFAULT_SECTORS: BonusSector[] = [
  { id: "s1", label: "0.10", reward: 0.1, weight: 25 },
  { id: "s2", label: "0.25", reward: 0.25, weight: 20 },
  { id: "s3", label: "0.50", reward: 0.5, weight: 18 },
  { id: "s4", label: "1.00", reward: 1, weight: 14 },
  { id: "s5", label: "2.00", reward: 2, weight: 10 },
  { id: "s6", label: "5.00", reward: 5, weight: 8 },
  { id: "s7", label: "10.00", reward: 10, weight: 4 },
  { id: "s8", label: "25.00", reward: 25, weight: 1 },
];

const bridge = getCasinoBridge();

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const parseSectors = (raw: unknown): BonusSector[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const sector = item as { id?: unknown; label?: unknown; reward?: unknown; weight?: unknown };
      const id = typeof sector.id === "string" ? sector.id.trim() : "";
      const label = typeof sector.label === "string" ? sector.label.trim() : "";
      if (!id || !label) {
        return null;
      }
      return {
        id,
        label,
        reward: asNumber(sector.reward, 0),
        weight: Math.max(1, Math.floor(asNumber(sector.weight, 1))),
      };
    })
    .filter((sector): sector is BonusSector => sector !== null);
};

const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export default function FreeCoinsPage() {
  const [bonusMode, setBonusMode] = useState<BonusMode>("group");
  const [wheelSectors, setWheelSectors] = useState<BonusSector[]>(DEFAULT_SECTORS);
  const [cooldownMs, setCooldownMs] = useState(DEFAULT_COOLDOWN_MS);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [wheelRotationDeg, setWheelRotationDeg] = useState(0);
  const [wheelTransitionMs, setWheelTransitionMs] = useState(0);
  const [isWheelLoading, setIsWheelLoading] = useState(true);
  const [referralRegistrations, setReferralRegistrations] = useState(0);
  const [isSubmittingSpin, setIsSubmittingSpin] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);

  const spinResetTimerRef = useRef<number | null>(null);
  const isSpinningRef = useRef(false);

  const bridgeState = useSyncExternalStore(
    bridge.subscribeStore,
    bridge.getState,
    bridge.getServerSnapshot,
  );

  const cooldownStorageKey = useMemo(() => {
    const userKey = bridgeState.userId || "guest";
    return `win2x.bonus.nextAt.${userKey}`;
  }, [bridgeState.userId]);

  const maxReward = useMemo(() => {
    return wheelSectors.reduce((max, sector) => Math.max(max, sector.reward), 0);
  }, [wheelSectors]);

  const cooldownMinutes = useMemo(() => {
    return Math.max(1, Math.floor(cooldownMs / 60000));
  }, [cooldownMs]);

  useEffect(() => {
    isSpinningRef.current = isSpinning;
  }, [isSpinning]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const rawValue = window.localStorage.getItem(cooldownStorageKey);
    if (!rawValue) {
      setNextAt(null);
      return;
    }
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      setNextAt(parsed);
      return;
    }
    window.localStorage.removeItem(cooldownStorageKey);
    setNextAt(null);
  }, [cooldownStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!nextAt || nextAt <= Date.now()) {
      window.localStorage.removeItem(cooldownStorageKey);
      return;
    }
    window.localStorage.setItem(cooldownStorageKey, String(Math.floor(nextAt)));
  }, [nextAt, cooldownStorageKey]);

  useEffect(() => {
    if (!nextAt) {
      setRemainingSec(0);
      return;
    }

    const sync = () => {
      const leftMs = nextAt - Date.now();
      if (leftMs <= 0) {
        setNextAt(null);
        setRemainingSec(0);
        return;
      }
      setRemainingSec(Math.ceil(leftMs / 1000));
    };

    sync();
    const timerId = window.setInterval(sync, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [nextAt]);

  const spinToSector = useCallback(
    (sectorId: string) => {
      if (!sectorId || wheelSectors.length === 0) {
        return;
      }

      const sectorIndex = wheelSectors.findIndex((sector) => sector.id === sectorId);
      if (sectorIndex < 0) {
        return;
      }

      const sectorAngle = 360 / wheelSectors.length;
      const targetCenterAngle = sectorIndex * sectorAngle + sectorAngle / 2;

      setWheelTransitionMs(SPIN_DURATION_MS);
      setWheelRotationDeg((previousDeg) => {
        const normalized = previousDeg % 360;
        const base = previousDeg - normalized;
        return Number((base + 1440 + (360 - targetCenterAngle)).toFixed(2));
      });

      setIsSpinning(true);

      if (spinResetTimerRef.current !== null) {
        window.clearTimeout(spinResetTimerRef.current);
      }
      spinResetTimerRef.current = window.setTimeout(() => {
        spinResetTimerRef.current = null;
        setIsSpinning(false);
        setWheelTransitionMs(0);
      }, SPIN_DURATION_MS + 120);
    },
    [wheelSectors],
  );

  useEffect(() => {
    return () => {
      if (spinResetTimerRef.current !== null) {
        window.clearTimeout(spinResetTimerRef.current);
        spinResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadWheel = async () => {
      setIsWheelLoading(true);
      try {
        await bridge.ensureReady();
        const responseRaw = await bridge.getBonusWheel();
        if (cancelled || !responseRaw || typeof responseRaw !== "object") {
          return;
        }
        const response = responseRaw as { sectors?: unknown; cooldownMs?: unknown };
        const sectors = parseSectors(response.sectors);
        setWheelSectors(sectors.length > 0 ? sectors : DEFAULT_SECTORS);
        setCooldownMs(Math.max(1_000, asNumber(response.cooldownMs, DEFAULT_COOLDOWN_MS)));
      } catch (error) {
        if (!cancelled) {
          const wsError = toWsError(error);
          pushToast("error", wsError.message);
        }
      } finally {
        if (!cancelled) {
          setIsWheelLoading(false);
        }
      }
    };

    void loadWheel();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadReferralStats = async () => {
      if (!bridgeState.isAuthenticated) {
        if (!cancelled) {
          setReferralRegistrations(0);
        }
        return;
      }

      try {
        await bridge.ensureReady();
        const raw = await bridge.getAffiliateStats();
        if (!cancelled && raw && typeof raw === "object") {
          const stats = raw as AffiliateStatsLike;
          const registrations = Math.max(0, Math.floor(asNumber(stats.registrations, 0)));
          setReferralRegistrations(registrations);
        }
      } catch {
        if (!cancelled) {
          setReferralRegistrations(0);
        }
      }
    };

    void loadReferralStats();
    return () => {
      cancelled = true;
    };
  }, [bridgeState.isAuthenticated]);

  useEffect(() => {
    const unsubscribeAnim = bridge.subscribeEvent("bonus.spin.anim", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object" || isSpinningRef.current) {
        return;
      }
      const payload = payloadRaw as { sectorId?: unknown };
      const sectorId = typeof payload.sectorId === "string" ? payload.sectorId : "";
      if (!sectorId) {
        return;
      }
      spinToSector(sectorId);
    });

    return () => {
      unsubscribeAnim();
    };
  }, [spinToSector]);

  useEffect(() => {
    const unsubscribeResult = bridge.subscribeEvent("bonus.spin.result", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as { sectorId?: unknown };
      const sectorId = typeof payload.sectorId === "string" ? payload.sectorId : "";
      if (sectorId && !isSpinningRef.current) {
        spinToSector(sectorId);
      }
      const fallbackNextAt = Date.now() + cooldownMs;
      setNextAt((current) => {
        if (current && current > fallbackNextAt) {
          return current;
        }
        return fallbackNextAt;
      });
    });

    return () => {
      unsubscribeResult();
    };
  }, [cooldownMs, spinToSector]);

  const handleSpin = async () => {
    if (bonusMode !== "group") {
      pushToast("info", "Referral bonus is not available yet.");
      return;
    }

    if (isWheelLoading || isSubmittingSpin || isSpinning) {
      return;
    }

    if (remainingSec > 0) {
      pushToast("warning", `Recharge through ${formatCountdown(remainingSec)}`);
      return;
    }

    if (!bridgeState.isAuthenticated) {
      bridge.openAuthDialog("login");
      pushToast("info", "Please login to spin the bonus wheel.");
      return;
    }

    setIsSubmittingSpin(true);
    try {
      await bridge.ensureReady();
      const resultRaw = await bridge.spinBonus();
      if (!resultRaw || typeof resultRaw !== "object") {
        throw new Error("Invalid spin response");
      }
      const result = resultRaw as { sectorId?: unknown; reward?: unknown; nextAt?: unknown };
      const sectorId = typeof result.sectorId === "string" ? result.sectorId : "";
      const reward = asNumber(result.reward, 0);
      const nextAtValue = Math.floor(asNumber(result.nextAt, 0));

      if (sectorId) {
        spinToSector(sectorId);
      }

      if (reward > 0) {
        pushToast("success", `You won ${reward.toFixed(2)} bonus coins`);
      }

      if (nextAtValue > Date.now()) {
        setNextAt(nextAtValue);
      } else {
        setNextAt(Date.now() + cooldownMs);
      }
    } catch (error) {
      const wsError = toWsError(error);
      const retryAt = Math.floor(asNumber(wsError.details?.retryAt, 0));
      if (retryAt > Date.now()) {
        setNextAt(retryAt);
        pushToast(
          "warning",
          `Bonus cooldown is active (${formatCountdown(Math.ceil((retryAt - Date.now()) / 1000))})`,
        );
      } else if (wsError.code !== "UNAUTHORIZED") {
        pushToast("error", wsError.message);
      }
    } finally {
      setIsSubmittingSpin(false);
    }
  };

  const spinButtonLabel = isSubmittingSpin ? "Processing..." : isSpinning ? "Spinning..." : "Spin";

  return (
    <MainLayout>
      <div className="section">
        <div className="dailyFree_dailyFree">
          <div className="quest-banner daily">
            <div className="caption">
              <h1>
                <span>Free coins</span>
              </h1>
            </div>
            <div className="info">
              <span>Perform one-time and daily tasks and get coins for free</span>
            </div>
          </div>

          <div className="dailyFree_wrap">
            <div className="dailyFree_free">
              <div className="form_container">
                <div className="wheel_half">
                  <div className="wheel_wheel">
                    <div
                      className="wheel_flex"
                      id="fortuneWheel"
                      style={{
                        transform: `rotate(-${wheelRotationDeg}deg)`,
                        transition:
                          wheelTransitionMs > 0
                            ? `transform ${wheelTransitionMs}ms cubic-bezier(0.15, 0.15, 0, 1)`
                            : "none",
                      }}
                    >
                      <img alt="Bonus wheel" src="/img/wheel.png" style={{ height: "100%", objectFit: "contain", width: "100%" }} />
                    </div>
                    <div className="wheel_ring">
                      <div className="wheel_ringInner" />
                    </div>
                    <div className="wheel_pin">
                      <svg fill="none" height="47" viewBox="0 0 22 47" width="22" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21.78 10.89c0 6.01-10.9 35.37-10.9 35.37S0 16.9 0 10.89a10.9 10.9 0 0 1 21.78 0z" fill="#FFD400" />
                        <circle cx="10.89" cy="10.48" fill="#E4A51C" r="6.44" />
                        <circle cx="10.89" cy="10.48" fill="#FFF" id="dotCircle" r="4.1" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="form_info">
                  <div className="form_wrapper group" style={{ display: bonusMode === "group" ? "flex" : "none" }}>
                    <div className="form_text">
                      <span>
                        Get to <strong>{maxReward.toFixed(2)} coins for bonus score</strong>
                      </span>
                    </div>
                    <div className="form_block">
                      {remainingSec > 0 ? (
                        <div className="form_recharge">
                          <span>Recharge through:</span>
                          <div className="form_timeLeft">{formatCountdown(remainingSec)}</div>
                        </div>
                      ) : (
                        <>
                          <div className="form_value">
                            {cooldownMinutes} mins<div className="form_text">recharge</div>
                          </div>
                          <span id="spin-wheel-button">
                            <button
                              className="btn"
                              disabled={isWheelLoading || isSubmittingSpin || isSpinning}
                              onClick={() => void handleSpin()}
                              type="button"
                            >
                              {isWheelLoading ? "Loading..." : spinButtonLabel}
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="form_wrapper refs" style={{ display: bonusMode === "refs" ? "flex" : "none" }}>
                    <div className="form_text">
                      Invite{" "}
                      <strong>
                        {REFERRAL_GOAL} active referrals
                        <div className="popover-tip-block" id="purposeTip">
                          <div className="popover-tip-icon">
                            <SymbolIcon className="icon icon-help" id="icon-help" />
                          </div>
                        </div>
                      </strong>{" "}
                      <br /> and get to <strong>{REFERRAL_REWARD.toFixed(2)} coins for bonus score</strong>
                    </div>
                    <div className="form_block">
                      <div className="form_value">
                        {Math.min(referralRegistrations, REFERRAL_GOAL)} / {REFERRAL_GOAL}
                        <div className="form_text">referral</div>
                      </div>
                      <span id="spin-wheel-button">
                        <button className="btn" disabled type="button">
                          Unavailable
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="list_list">
                <div
                  className={`list_item group${bonusMode === "group" ? " list_active" : ""}`}
                  data-bonus="group"
                  onClick={() => setBonusMode("group")}
                >
                  <SymbolIcon className="icon icon-faucet" id="icon-faucet" />
                  <div className="list_text">
                    <span>
                      Get to <strong>{maxReward.toFixed(2)} coins for bonus score</strong>
                    </span>{" "}
                    <span>once a {cooldownMinutes} mins</span>
                  </div>
                </div>

                <div
                  className={`list_item refs${bonusMode === "refs" ? " list_active" : ""}`}
                  data-bonus="refs"
                  onClick={() => setBonusMode("refs")}
                >
                  <SymbolIcon className="icon icon-faucet" id="icon-faucet" />
                  <div className="list_text">
                    <span>
                      Invite <strong>{REFERRAL_GOAL} referral</strong> <br /> and get to{" "}
                      <strong>{REFERRAL_REWARD.toFixed(2)} coins for bonus score</strong>
                    </span>
                  </div>
                </div>

                <div className="list_item list_disabled">
                  <div className="list_notAvailable">Unavailable</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
