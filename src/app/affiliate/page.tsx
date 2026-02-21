"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MainLayout } from "@/components/casino/layout/main-layout";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";
import { pushToast } from "@/components/casino/state/toast-store";
import { SymbolIcon } from "@/components/casino/ui/symbol-icon";

type AffiliateStats = {
  refCode: string;
  totalIncome: number;
  transitions: number;
  registrations: number;
  availableBalance: number;
  minWithdraw: number;
  referralWinPercent: number;
  referralSignupBonus: number;
};

const DEFAULT_STATS: AffiliateStats = {
  refCode: "",
  totalIncome: 0,
  transitions: 0,
  registrations: 0,
  availableBalance: 0,
  minWithdraw: 1,
  referralWinPercent: 10,
  referralSignupBonus: 1,
};

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

const asInt = (value: unknown, fallback = 0): number => {
  const parsed = Math.floor(asNumber(value, fallback));
  return parsed > 0 ? parsed : 0;
};

const parseAffiliateStats = (raw: unknown): AffiliateStats => {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_STATS;
  }

  const data = raw as {
    refCode?: unknown;
    totalIncome?: unknown;
    transitions?: unknown;
    registrations?: unknown;
    availableBalance?: unknown;
    minWithdraw?: unknown;
    referralWinPercent?: unknown;
    referralSignupBonus?: unknown;
  };

  return {
    refCode: typeof data.refCode === "string" ? data.refCode.trim() : "",
    totalIncome: Number(asNumber(data.totalIncome, 0).toFixed(2)),
    transitions: asInt(data.transitions, 0),
    registrations: asInt(data.registrations, 0),
    availableBalance: Number(asNumber(data.availableBalance, 0).toFixed(2)),
    minWithdraw: Number(asNumber(data.minWithdraw, 1).toFixed(2)),
    referralWinPercent: Number(asNumber(data.referralWinPercent, 10).toFixed(2)),
    referralSignupBonus: Number(asNumber(data.referralSignupBonus, 1).toFixed(2)),
  };
};

export default function AffiliatePage() {
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const [stats, setStats] = useState<AffiliateStats>(DEFAULT_STATS);

  const bridgeState = useSyncExternalStore(
    bridge.subscribeStore,
    bridge.getState,
    bridge.getServerSnapshot,
  );

  const effectiveRefCode = useMemo(() => {
    if (stats.refCode) {
      return stats.refCode;
    }
    if (bridgeState.userId) {
      return bridgeState.userId.slice(0, 8).toUpperCase();
    }
    return "YOU123";
  }, [bridgeState.userId, stats.refCode]);

  const referralLink = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://win2x.gg";
    return `${origin}/?ref=${effectiveRefCode}`;
  }, [effectiveRefCode]);

  const loadStats = useCallback(async () => {
    if (!bridgeState.isAuthenticated) {
      setStats(DEFAULT_STATS);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      await bridge.ensureReady();
      const raw = await bridge.getAffiliateStats();
      setStats(parseAffiliateStats(raw));
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        pushToast("error", wsError.message);
      }
      setStats(DEFAULT_STATS);
    } finally {
      setIsLoading(false);
    }
  }, [bridgeState.isAuthenticated]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      setCopied(false);
    }
  };

  const handleClaim = async () => {
    if (!bridgeState.isAuthenticated) {
      bridge.openAuthDialog("login");
      pushToast("info", "Please login to claim affiliate balance.");
      return;
    }
    if (isLoading || isClaiming) {
      return;
    }
    if (stats.availableBalance <= 0) {
      pushToast("warning", "No referral balance to claim");
      return;
    }
    if (stats.availableBalance < stats.minWithdraw) {
      pushToast("warning", `Minimum withdrawal amount ${stats.minWithdraw.toFixed(2)} coins`);
      return;
    }

    setIsClaiming(true);
    try {
      await bridge.ensureReady();
      const responseRaw = await bridge.claimAffiliate();
      if (responseRaw && typeof responseRaw === "object") {
        const response = responseRaw as { claimed?: unknown };
        const claimed = asNumber(response.claimed, 0);
        pushToast("success", `Claimed ${claimed.toFixed(2)} coins`);
      } else {
        pushToast("success", "Affiliate balance claimed");
      }
      await loadStats();
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        pushToast("error", wsError.message);
      }
    } finally {
      setIsClaiming(false);
    }
  };

  const takeDisabled =
    isClaiming || isLoading || stats.availableBalance <= 0 || stats.availableBalance < stats.minWithdraw;

  return (
    <MainLayout>
      <div className="section">
        <div className="section-page">
          <div className="quest-banner affiliate">
            <div className="caption">
              <h1>
                <span>Referral program</span>
              </h1>
            </div>
            <div className="info">
              <span>Earn {stats.referralWinPercent}% from your referrals&apos; win amount.</span>
            </div>
            <div className="info">
              <span>Your referrals receive {stats.referralSignupBonus.toFixed(2)} bonus at registration.</span>
            </div>
          </div>

          <div className="affiliates-form">
            <div className="text">Your link to attract referrals:</div>
            <form>
              <div className="form-row">
                <div className="form-field input-group">
                  <div className="input-valid">
                    <input className="input-field" id="code" readOnly type="text" value={referralLink} />
                    <div className="input-group-append">
                      <button className="btn" onClick={handleCopy} type="button">
                        <span>Copy</span>
                      </button>
                      <div className={`copy-tooltip${copied ? " visible" : ""}`}>
                        <span>Copied</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div className="affiliate-stats">
            <div className="left">
              <div className="affiliate-stats-item">
                <div className="wrap">
                  <div className="block">
                    <SymbolIcon className="icon icon-coin bonus" id="icon-coin" />
                    <div className="num">{stats.totalIncome.toFixed(2)}</div>
                    <div className="text">Total income</div>
                  </div>
                </div>
              </div>
              <div className="affiliate-stats-item border-top">
                <div className="wrap border-right">
                  <div className="block">
                    <SymbolIcon className="icon icon-network" id="icon-network" />
                    <div className="num">{stats.transitions}</div>
                    <div className="text">Transitions</div>
                  </div>
                </div>
                <div className="wrap">
                  <div className="block">
                    <SymbolIcon className="icon icon-person" id="icon-person" />
                    <div className="num">{stats.registrations}</div>
                    <div className="text">Registrations</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="right">
              <div className="affiliate-stats-item full">
                <div className="wrap">
                  <div className="block">
                    <SymbolIcon className="icon icon-coin bonus" id="icon-coin" />
                    <div className="num">{stats.availableBalance.toFixed(2)}</div>
                    <div className="text">Available balance</div>
                    <span
                      data-placement="top"
                      data-toggle="tooltip"
                      id="withdraw-button"
                      title={`Minimum withdrawal amount ${stats.minWithdraw.toFixed(2)} coins`}
                    >
                      <button className="btn" disabled={takeDisabled} onClick={() => void handleClaim()} type="button">
                        {isClaiming ? "Taking..." : "Take"}
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
