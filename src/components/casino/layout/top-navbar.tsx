"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getCasinoBridge, toWsError } from "../state/casino-bridge";
import { pushToast } from "../state/toast-store";
import { SymbolIcon } from "../ui/symbol-icon";

const bridge = getCasinoBridge();
const REF_STORAGE_KEY = "win2x.pendingRefCode";
const REF_VISITOR_KEY = "win2x.ref.visitor";

type DepositNetwork = {
  id: string;
  name: string;
  requestNetwork: string;
  aliases: string[];
  status: boolean;
  requiredConfirmations?: number;
  withdrawFee?: number;
  withdrawMin?: number;
  withdrawMax?: number;
  depositMin?: number;
  depositMax?: number;
  staticFixedFee?: number;
};

type DepositCurrency = {
  code: string;
  name: string;
  status: boolean;
  usdRate?: number | null;
  networks: DepositNetwork[];
};

type DepositProvider = {
  id: "oxapay";
  enabled: boolean;
  reason?: string;
  currencies: DepositCurrency[];
};

type DepositAddressItem = {
  toCurrency: string;
  network: string;
  address: string;
  trackId: string;
};

type WalletSelectKey = "depositCurrency" | "depositNetwork" | "withdrawCurrency" | "withdrawNetwork";

type WalletSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  iconSrc?: string;
  iconId?: string;
  iconClassName?: string;
};

const makeVisitorId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const CURRENCY_ICON_BY_CODE: Record<string, string> = {
  BCH: "bitcoin-cash",
  BNB: "bnb",
  BTC: "bitcoin",
  DOGE: "dogecoin",
  DOGS: "dogs",
  ETH: "ethereum",
  LTC: "litecoin",
  MATIC: "polygon",
  NOT: "notcoin",
  POL: "polygon",
  SHIB: "shiba-inu",
  SOL: "solana",
  TON: "ton",
  TRX: "tron",
  USDC: "usd-coin",
  USDT: "tether",
  XMR: "monero",
  XRP: "ripple",
};

const getCurrencyIconSrc = (code: string): string | null => {
  const iconName = CURRENCY_ICON_BY_CODE[code.trim().toUpperCase()];
  return iconName ? `/img/currencies/${iconName}.svg` : null;
};

export function TopNavbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);

  const [isBalanceOpen, setIsBalanceOpen] = useState(false);
  const [isPromoOpen, setIsPromoOpen] = useState(false);
  const [isWalletOpen, setIsWalletOpen] = useState(false);

  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState("");
  const [walletTab, setWalletTab] = useState<"deposit" | "withdraw" | "exchange">("deposit");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletCoinsPerUsd, setWalletCoinsPerUsd] = useState(1);
  const [exchangeFrom, setExchangeFrom] = useState<"main" | "bonus">("main");
  const [depositProvider, setDepositProvider] = useState<DepositProvider | null>(null);
  const [withdrawProvider, setWithdrawProvider] = useState<DepositProvider | null>(null);
  const [depositCurrency, setDepositCurrency] = useState("USDT");
  const [depositNetwork, setDepositNetwork] = useState("Tron");
  const [withdrawCurrency, setWithdrawCurrency] = useState("USDT");
  const [withdrawNetwork, setWithdrawNetwork] = useState("Tron");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [depositAddresses, setDepositAddresses] = useState<Record<string, DepositAddressItem>>({});
  const [depositAddressErrors, setDepositAddressErrors] = useState<Record<string, string>>({});
  const [isDepositMethodsLoading, setIsDepositMethodsLoading] = useState(false);
  const [isDepositAddressLoading, setIsDepositAddressLoading] = useState(false);
  const [openWalletSelect, setOpenWalletSelect] = useState<WalletSelectKey | null>(null);
  const [walletStatus, setWalletStatus] = useState("");
  const [isWalletSubmitting, setIsWalletSubmitting] = useState(false);

  const [authUsername, setAuthUsername] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordRepeat, setAuthPasswordRepeat] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  const affiliateActive = pathname === "/affiliate" || pathname.startsWith("/affiliate/");
  const freeActive = pathname === "/free" || pathname.startsWith("/free/");
  const selectedCurrency = depositProvider?.currencies.find((item) => item.code === depositCurrency) ?? null;
  const selectedWithdrawCurrency = withdrawProvider?.currencies.find((item) => item.code === withdrawCurrency) ?? null;
  const selectedWithdrawNetwork =
    selectedWithdrawCurrency?.networks.find((item) => item.id === withdrawNetwork) ?? null;
  const selectedDepositKey = `${depositCurrency}:${depositNetwork}`;
  const selectedDeposit = depositAddresses[selectedDepositKey] ?? null;
  const selectedDepositAddress = selectedDeposit?.address ?? "";
  const selectedDepositError = depositAddressErrors[selectedDepositKey] ?? "";

  const formatDepositInfo = (value?: number, unit?: string): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "Not specified";
    }
    const formatted = value.toString();
    return unit ? `${formatted} ${unit}` : formatted;
  };

  const formatCryptoAmount = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) {
      return "0";
    }
    if (value >= 1) {
      return value.toFixed(6).replace(/\.?0+$/, "");
    }
    return value.toFixed(12).replace(/\.?0+$/, "");
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(searchParamsKey);
    const refRaw = params.get("ref");
    const refCode = refRaw ? refRaw.trim().toUpperCase() : "";
    if (!refCode) {
      return;
    }

    window.localStorage.setItem(REF_STORAGE_KEY, refCode);

    let visitorId = window.localStorage.getItem(REF_VISITOR_KEY);
    if (!visitorId) {
      visitorId = makeVisitorId();
      window.localStorage.setItem(REF_VISITOR_KEY, visitorId);
    }

    const visitKey = `win2x.ref.visit.${refCode}`;
    if (window.localStorage.getItem(visitKey)) {
      return;
    }

    void bridge
      .ensureReady()
      .then(() => bridge.trackAffiliateVisit({ refCode, visitorId: visitorId as string }))
      .then((responseRaw) => {
        if (!responseRaw || typeof responseRaw !== "object") {
          return;
        }
        const response = responseRaw as { tracked?: unknown };
        if (response.tracked === true) {
          window.localStorage.setItem(visitKey, "1");
        }
      })
      .catch(() => {
        // noop
      });
  }, [searchParamsKey]);

  useEffect(() => {
    if (!isWalletOpen || !openWalletSelect) {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (target.closest(".wallet-select")) {
        return;
      }
      setOpenWalletSelect(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenWalletSelect(null);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isWalletOpen, openWalletSelect]);

  const closePromoModal = () => {
    setIsPromoOpen(false);
    setPromoCode("");
    setPromoStatus("");
  };

  const closeWalletModal = () => {
    setIsWalletOpen(false);
    setOpenWalletSelect(null);
    setWalletStatus("");
    setWalletAmount("");
    setWithdrawAddress("");
    setIsWalletSubmitting(false);
    setIsDepositMethodsLoading(false);
    setIsDepositAddressLoading(false);
  };

  const loadDepositMethods = useCallback(async (targetTab: "deposit" | "withdraw" = walletTab) => {
    setIsDepositMethodsLoading(true);
    try {
      const toNumber = (value: unknown): number | undefined => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      const responseRaw =
        targetTab === "withdraw" ? await bridge.walletGetWithdrawMethods() : await bridge.walletGetDepositMethods();
      if (!responseRaw || typeof responseRaw !== "object") {
        throw new Error(targetTab === "withdraw" ? "Invalid withdraw methods response" : "Invalid deposit methods response");
      }
      const coinsPerUsdRaw = (responseRaw as { coinsPerUsd?: unknown }).coinsPerUsd;
      const parsedCoinsPerUsd = Number(coinsPerUsdRaw);
      setWalletCoinsPerUsd(
        Number.isFinite(parsedCoinsPerUsd) && parsedCoinsPerUsd > 0 ? parsedCoinsPerUsd : 1,
      );
      const providersRaw = (responseRaw as { providers?: unknown }).providers;
      const providers = Array.isArray(providersRaw) ? providersRaw : [];
      const first = providers[0];
      if (!first || typeof first !== "object") {
        throw new Error(targetTab === "withdraw" ? "No withdraw provider available" : "No deposit provider available");
      }
      const enabled = (first as { enabled?: unknown }).enabled;
      const reason = (first as { reason?: unknown }).reason;
      const currenciesRaw = (first as { currencies?: unknown }).currencies;
      const currencies = Array.isArray(currenciesRaw)
        ? currenciesRaw
            .map((item) => {
              if (!item || typeof item !== "object") {
                return null;
              }
              const codeRaw = (item as { code?: unknown }).code;
              const nameRaw = (item as { name?: unknown }).name;
              const statusRaw = (item as { status?: unknown }).status;
              const code = typeof codeRaw === "string" ? codeRaw.trim().toUpperCase() : "";
              if (!code) {
                return null;
              }
              const networksRaw = (item as { networks?: unknown }).networks;
              const networks = Array.isArray(networksRaw)
                ? networksRaw
                    .map((networkRaw) => {
                      if (!networkRaw || typeof networkRaw !== "object") {
                        return null;
                      }
                      const networkObj = networkRaw as Record<string, unknown>;
                      const idRaw = networkObj.id;
                      const id = typeof idRaw === "string" ? idRaw.trim() : "";
                      if (!id) {
                        return null;
                      }
                      const aliasesRaw = networkObj.aliases;
                      const aliases = Array.isArray(aliasesRaw)
                        ? aliasesRaw
                            .map((alias) => (typeof alias === "string" ? alias.trim() : ""))
                            .filter((alias) => alias.length > 0)
                        : [];
                      return {
                        id,
                        name:
                          typeof networkObj.name === "string" && networkObj.name.trim()
                            ? networkObj.name.trim()
                            : `${id} Network`,
                        requestNetwork:
                          typeof networkObj.requestNetwork === "string" && networkObj.requestNetwork.trim()
                            ? networkObj.requestNetwork.trim()
                            : id,
                        aliases,
                        status: networkObj.status === false ? false : true,
                        requiredConfirmations: toNumber(networkObj.requiredConfirmations),
                        withdrawFee: toNumber(networkObj.withdrawFee),
                        withdrawMin: toNumber(networkObj.withdrawMin),
                        withdrawMax: toNumber(networkObj.withdrawMax),
                        depositMin: toNumber(networkObj.depositMin),
                        depositMax: toNumber(networkObj.depositMax),
                        staticFixedFee: toNumber(networkObj.staticFixedFee),
                      } satisfies DepositNetwork;
                    })
                    .filter((network) => Boolean(network)) as DepositNetwork[]
                : [];

              return {
                code,
                name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : code,
                status: statusRaw === false ? false : true,
                usdRate: toNumber((item as { usdRate?: unknown }).usdRate) ?? null,
                networks:
                  networks.length > 0
                    ? networks
                    : [
                        {
                          id: code,
                          name: `${code} Network`,
                          requestNetwork: code,
                          aliases: [code],
                          status: true,
                        },
                      ],
              };
            })
            .filter((item) => Boolean(item)) as DepositCurrency[]
        : [];

      const provider: DepositProvider = {
        id: "oxapay",
        enabled: Boolean(enabled),
        reason: typeof reason === "string" ? reason : undefined,
        currencies:
          currencies.length > 0
            ? currencies
            : [
                {
                  code: "USDT",
                  name: "Tether",
                  status: true,
                  usdRate: 1,
                  networks: [
                    {
                      id: "Tron",
                      name: "Tron Network",
                      requestNetwork: "TRON",
                      aliases: ["TRON", "TRC20", "TRX"],
                      status: true,
                    },
                  ],
                },
              ],
      };

      const firstCurrency =
        provider.currencies[0] ??
        ({
          code: "USDT",
          name: "Tether",
          status: true,
          usdRate: 1,
          networks: [
            {
              id: "Tron",
              name: "Tron Network",
              requestNetwork: "TRON",
              aliases: ["TRON"],
              status: true,
            },
          ],
        } satisfies DepositCurrency);
      if (targetTab === "withdraw") {
        setWithdrawProvider(provider);
        setWithdrawCurrency(firstCurrency.code);
        setWithdrawNetwork(firstCurrency.networks[0]?.id ?? firstCurrency.code);
      } else {
        setDepositProvider(provider);
        setDepositCurrency(firstCurrency.code);
        setDepositNetwork(firstCurrency.networks[0]?.id ?? firstCurrency.code);
      }
      if (!provider.enabled) {
        setWalletStatus(
          provider.reason ??
            (targetTab === "withdraw" ? "Withdraw is temporarily unavailable" : "Deposit is temporarily unavailable"),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : targetTab === "withdraw"
            ? "Failed to load withdraw methods"
            : "Failed to load deposit methods";
      setWalletCoinsPerUsd(1);
      if (targetTab === "withdraw") {
        setWithdrawProvider({
          id: "oxapay",
          enabled: false,
          reason: message,
          currencies: [],
        });
        setWithdrawCurrency("USDT");
        setWithdrawNetwork("Tron");
      } else {
        setDepositProvider({
          id: "oxapay",
          enabled: false,
          reason: message,
          currencies: [],
        });
        setDepositCurrency("USDT");
        setDepositNetwork("Tron");
      }
      setWalletStatus(message);
    } finally {
      setIsDepositMethodsLoading(false);
    }
  }, [walletTab]);

  const openWalletModal = (tab: "deposit" | "withdraw" | "exchange" = "deposit") => {
    setWalletTab(tab);
    setOpenWalletSelect(null);
    setWalletStatus("");
    setWalletAmount("");
    setIsWalletOpen(true);
    if (tab === "deposit" || tab === "withdraw") {
      void loadDepositMethods(tab);
    }
  };

  useEffect(() => {
    if (!isWalletOpen || (walletTab !== "deposit" && walletTab !== "withdraw")) {
      return;
    }
    if (isDepositMethodsLoading) {
      return;
    }
    if (walletTab === "deposit" && depositProvider) {
      return;
    }
    if (walletTab === "withdraw" && withdrawProvider) {
      return;
    }
    void loadDepositMethods(walletTab);
  }, [depositProvider, isDepositMethodsLoading, isWalletOpen, loadDepositMethods, walletTab, withdrawProvider]);

  useEffect(() => {
    if (!depositProvider) {
      return;
    }
    const selected = depositProvider.currencies.find((item) => item.code === depositCurrency);
    if (!selected) {
      return;
    }
    if (!selected.networks.some((network) => network.id === depositNetwork)) {
      setDepositNetwork(selected.networks[0]?.id ?? selected.code);
    }
  }, [depositCurrency, depositNetwork, depositProvider]);

  useEffect(() => {
    if (!withdrawProvider) {
      return;
    }
    const selected = withdrawProvider.currencies.find((item) => item.code === withdrawCurrency);
    if (!selected) {
      return;
    }
    if (!selected.networks.some((network) => network.id === withdrawNetwork)) {
      setWithdrawNetwork(selected.networks[0]?.id ?? selected.code);
    }
  }, [withdrawCurrency, withdrawNetwork, withdrawProvider]);

  const ensureDepositAddress = useCallback(async (force = false) => {
    if (!depositProvider || !depositProvider.enabled) {
      return;
    }
    const currency = depositProvider.currencies.find((item) => item.code === depositCurrency);
    if (!currency) {
      return;
    }
    const network = currency.networks.find((item) => item.id === depositNetwork);
    if (!network || !network.status) {
      return;
    }
    const key = `${currency.code}:${network.id}`;
    const cached = depositAddresses[key];
    if (cached?.address) {
      return;
    }
    if (!force && depositAddressErrors[key]) {
      return;
    }

    setIsDepositAddressLoading(true);
    setWalletStatus("");
    setDepositAddressErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const responseRaw = (await bridge.walletGetOrCreateStaticAddress({
        provider: "oxapay",
        toCurrency: currency.code,
        network: network.id,
      })) as {
        address?: unknown;
        trackId?: unknown;
        toCurrency?: unknown;
        network?: unknown;
      };

      const address =
        typeof responseRaw.address === "string" && responseRaw.address.trim()
          ? responseRaw.address.trim()
          : "";
      if (!address) {
        throw new Error("Could not generate deposit address");
      }

      const trackId =
        typeof responseRaw.trackId === "string" && responseRaw.trackId.trim()
          ? responseRaw.trackId.trim()
          : "";
      const resultCurrency =
        typeof responseRaw.toCurrency === "string" && responseRaw.toCurrency.trim()
          ? responseRaw.toCurrency.trim().toUpperCase()
          : currency.code;
      const resultNetwork =
        typeof responseRaw.network === "string" && responseRaw.network.trim()
          ? responseRaw.network.trim()
          : network.id;
      const resultKey = `${resultCurrency}:${resultNetwork}`;

      setDepositAddresses((prev) => ({
        ...prev,
        [resultKey]: {
          toCurrency: resultCurrency,
          network: resultNetwork,
          address,
          trackId,
        },
      }));
      setWalletStatus("Deposit address is ready. Send funds only on the selected network.");
    } catch (error) {
      const message = toWsError(error).message;
      setWalletStatus(message);
      setDepositAddressErrors((prev) => ({
        ...prev,
        [key]: message,
      }));
    } finally {
      setIsDepositAddressLoading(false);
    }
  }, [depositAddressErrors, depositAddresses, depositCurrency, depositNetwork, depositProvider]);

  useEffect(() => {
    if (!isWalletOpen || walletTab !== "deposit") {
      return;
    }
    if (isDepositMethodsLoading || isDepositAddressLoading) {
      return;
    }
    if (!depositProvider || !depositProvider.enabled) {
      return;
    }
    if (selectedDepositAddress) {
      return;
    }
    if (selectedDepositError) {
      return;
    }
    void ensureDepositAddress();
  }, [
    depositProvider,
    ensureDepositAddress,
    isDepositAddressLoading,
    isDepositMethodsLoading,
    isWalletOpen,
    selectedDepositAddress,
    selectedDepositError,
    walletTab,
  ]);

  const openAuthModal = (tab: "login" | "register") => {
    setAuthStatus("");
    bridge.openAuthDialog(tab);
  };

  const closeAuthModal = () => {
    bridge.closeAuthDialog();
    setAuthStatus("");
    setAuthPassword("");
    setAuthPasswordRepeat("");
  };

  const activatePromo = async () => {
    if (!bridgeState.isAuthenticated) {
      setPromoStatus("Login required");
      setIsPromoOpen(false);
      openAuthModal("login");
      return;
    }

    const code = promoCode.trim();
    if (!code) {
      setPromoStatus("Promo code is required");
      return;
    }

    try {
      await bridge.redeemPromo(code);
      setPromoStatus("Promo code activated");
      setPromoCode("");
      await bridge.refreshBalance();
    } catch (error) {
      setPromoStatus(toWsError(error).message);
    }
  };

  const parseWalletAmount = (raw: string): number => {
    const normalized = raw.replace(",", ".").trim();
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return Number(parsed.toFixed(2));
  };

  const withdrawAmountCoins = walletTab === "withdraw" ? parseWalletAmount(walletAmount) : 0;
  const withdrawRateUsd =
    typeof selectedWithdrawCurrency?.usdRate === "number" && selectedWithdrawCurrency.usdRate > 0
      ? selectedWithdrawCurrency.usdRate
      : null;
  const withdrawAmountUsd =
    withdrawAmountCoins > 0 ? Number((withdrawAmountCoins / walletCoinsPerUsd).toFixed(8)) : 0;
  const withdrawAmountCrypto =
    withdrawAmountUsd > 0 && withdrawRateUsd
      ? Number((withdrawAmountUsd / withdrawRateUsd).toFixed(12))
      : 0;
  const withdrawFeeCrypto =
    typeof selectedWithdrawNetwork?.withdrawFee === "number" ? selectedWithdrawNetwork.withdrawFee : 0;
  const withdrawReceiveCrypto = Math.max(0, Number((withdrawAmountCrypto - withdrawFeeCrypto).toFixed(12)));

  const renderWalletSelect = (
    key: WalletSelectKey,
    options: WalletSelectOption[],
    value: string,
    onChange: (nextValue: string) => void,
    disabled = false,
  ) => {
    const selectedOption = options.find((item) => item.value === value) ?? null;
    const label = selectedOption?.label ?? "Select";

    return (
      <div className={`form-field wallet-select${openWalletSelect === key ? " isOpen" : ""}`}>
        <button
          aria-expanded={openWalletSelect === key}
          aria-haspopup="listbox"
          className="input-field wallet-select-toggle"
          disabled={disabled}
          onClick={() => setOpenWalletSelect((prev) => (prev === key ? null : key))}
          type="button"
        >
          <span className="wallet-select-value">
            {selectedOption?.iconSrc ? (
              <span className="wallet-select-inline-icon">
                <Image alt="" height={14} src={selectedOption.iconSrc} width={14} />
              </span>
            ) : selectedOption?.iconId ? (
              <span className="wallet-select-inline-icon">
                <SymbolIcon
                  className={selectedOption.iconClassName ?? "icon icon-coin"}
                  id={selectedOption.iconId}
                />
              </span>
            ) : null}
            <span className="wallet-select-value-text">{label}</span>
          </span>
          <span className="wallet-select-caret">
            <SymbolIcon className="icon icon-down" id="icon-down" />
          </span>
        </button>
        <div className="wallet-select-menu">
          {options.length > 0 ? (
            options.map((option) => (
              <button
                className={`wallet-select-option${option.value === value ? " isSelected" : ""}`}
                disabled={option.disabled}
                key={`${key}-${option.value}`}
                onClick={() => {
                  if (option.disabled) {
                    return;
                  }
                  onChange(option.value);
                  setOpenWalletSelect(null);
                }}
                type="button"
              >
                {option.iconSrc ? (
                  <span className="wallet-select-inline-icon">
                    <Image alt="" height={14} src={option.iconSrc} width={14} />
                  </span>
                ) : option.iconId ? (
                  <span className="wallet-select-inline-icon">
                    <SymbolIcon className={option.iconClassName ?? "icon icon-coin"} id={option.iconId} />
                  </span>
                ) : null}
                <span className="wallet-select-option-label">{option.label}</span>
              </button>
            ))
          ) : (
            <div className="wallet-select-empty">No options available</div>
          )}
        </div>
      </div>
    );
  };

  const handleWalletSubmit = async () => {
    if (!bridgeState.isAuthenticated) {
      setWalletStatus("Login required");
      closeWalletModal();
      openAuthModal("login");
      return;
    }

    if (walletTab === "deposit") {
      if (!selectedDepositAddress) {
        if (!isDepositAddressLoading) {
          void ensureDepositAddress(true);
        }
        if (selectedDepositError) {
          setWalletStatus("Retrying deposit address generation...");
        }
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(selectedDepositAddress);
          setWalletStatus("Deposit address copied to clipboard.");
          pushToast("success", "Address copied");
        } catch {
          setWalletStatus("Could not copy automatically. Copy address manually.");
        }
      } else if (typeof window !== "undefined") {
        window.prompt("Copy deposit address:", selectedDepositAddress);
      }
      return;
    }

    const amount = parseWalletAmount(walletAmount);
    if (amount <= 0) {
      setWalletStatus("Enter valid amount");
      return;
    }

    setIsWalletSubmitting(true);
    setWalletStatus("");
    try {
      if (walletTab === "withdraw") {
        const address = withdrawAddress.trim();
        if (!withdrawProvider?.enabled) {
          setWalletStatus(withdrawProvider?.reason ?? "Withdraw is temporarily unavailable");
          return;
        }
        if (!selectedWithdrawCurrency || !selectedWithdrawNetwork) {
          setWalletStatus("Select currency and network");
          return;
        }
        if (!address) {
          setWalletStatus("Enter withdraw address");
          return;
        }
        await bridge.walletWithdraw({
          amount,
          provider: "oxapay",
          currency: selectedWithdrawCurrency.code,
          network: selectedWithdrawNetwork.id,
          address,
        });
        setWalletStatus(`Withdraw request created: ${amount.toFixed(2)} coins`);
        pushToast("success", "Withdraw completed");
        await bridge.refreshBalance();
      } else {
        const to = exchangeFrom === "main" ? "bonus" : "main";
        await bridge.walletExchange({
          from: exchangeFrom,
          to,
          amount,
        });
        setWalletStatus(`Exchange successful: ${amount.toFixed(2)} (${exchangeFrom} -> ${to})`);
        pushToast("success", "Exchange completed");
        await bridge.refreshBalance();
      }
      setWalletAmount("");
    } catch (error) {
      const message = toWsError(error).message;
      setWalletStatus(message);
      pushToast("error", message);
    } finally {
      setIsWalletSubmitting(false);
    }
  };

  const handleAuthSubmit = async () => {
    const username = authUsername.trim();
    const email = authEmail.trim();
    const password = authPassword;
    const passwordRepeat = authPasswordRepeat;
    const authTab = bridgeState.authDialogTab;
    const storedRefCode =
      typeof window !== "undefined" ? (window.localStorage.getItem(REF_STORAGE_KEY) ?? "").trim().toUpperCase() : "";

    if (!username) {
      setAuthStatus("Username is required");
      return;
    }
    if (!password) {
      setAuthStatus("Password is required");
      return;
    }
    if (authTab === "register" && password !== passwordRepeat) {
      setAuthStatus("Passwords do not match");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthStatus("");

    try {
      if (authTab === "login") {
        await bridge.login({ username, password });
      } else {
        await bridge.register({
          username,
          email: email || undefined,
          password,
          refCode: storedRefCode || undefined,
        });
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(REF_STORAGE_KEY);
        }
      }
      setAuthPassword("");
      setAuthPasswordRepeat("");
      setPromoStatus("");
    } catch (error) {
      setAuthStatus(toWsError(error).message);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  return (
    <>
      <div className="header">
        <div className="header-inner">
          <div className="header-block">
            <Link className="logo" href="/casino/games/dice">
              <img alt="win2x" src="/img/logo.png" />
            </Link>
            <div className="top-nav-wrapper">
              <ul className="top-nav">
                <li>
                  <Link className={affiliateActive ? "isActive" : ""} href="/affiliate">
                    <SymbolIcon className="icon icon-affiliate" id="icon-affiliate" />
                    <span>Referrals</span>
                  </Link>
                </li>
                <li>
                  <Link className={freeActive ? "isActive" : ""} href="/free">
                    <SymbolIcon className="icon icon-faucet" id="icon-faucet" />
                    <span>Free coins</span>
                  </Link>
                </li>
                <li>
                  <button className="btn" onClick={() => setIsPromoOpen(true)} type="button">
                    <SymbolIcon className="icon icon-promo" id="icon-promo" />
                    <span>Promocode</span>
                  </button>
                </li>
                <li>
                  <a href="#">
                    <SymbolIcon className="icon icon-faq" id="icon-faq" />
                    <span>Support</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="auth-buttons" style={{ alignItems: "center", display: "flex", gap: 10 }}>
            {bridgeState.isAuthenticated ? (
              <>
                <div className="deposit-wrap" style={{ height: 38 }}>
                  <div
                    className={`bottom-start rounded dropdown${isBalanceOpen ? " show" : ""}`}
                    onBlur={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (!next || !event.currentTarget.contains(next)) {
                        setIsBalanceOpen(false);
                      }
                    }}
                    tabIndex={0}
                  >
                    <button
                      aria-expanded={isBalanceOpen}
                      aria-haspopup="true"
                      className="dropdown-toggle btn btn-secondary"
                      onClick={() => setIsBalanceOpen((prev) => !prev)}
                      type="button"
                    >
                      <div className="selected balance">
                        <SymbolIcon className="icon icon-coin" id="icon-coin" />
                      </div>
                      <div className="opener" style={{ alignItems: "center", display: "flex", justifyContent: "center" }}>
                        <SymbolIcon className="icon icon-down" id="icon-down" />
                      </div>
                    </button>
                    <div className="dropdown-menu">
                      <button className="dropdown-item" type="button">
                        <div className="balance-item balance">
                          <SymbolIcon className="icon icon-coin" id="icon-coin" />
                          <span>Money</span>
                          <div className="value">{bridgeState.balanceMain}</div>
                        </div>
                      </button>
                      <button className="dropdown-item" type="button">
                        <div className="balance-item bonus">
                          <SymbolIcon className="icon icon-coin" id="icon-coin" />
                          <span>Bonus</span>
                          <div className="value">{bridgeState.balanceBonus}</div>
                        </div>
                      </button>
                    </div>
                  </div>
                  <div className="deposit-block">
                    <div className="select-field" style={{ width: 110 }}>
                      <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{bridgeState.balanceMain}</span>
                    </div>
                    <button
                      className="btn"
                      onClick={() => openWalletModal("deposit")}
                      style={{ fontSize: 14, height: "100%", paddingInline: 16 }}
                      type="button"
                    >
                      Wallet
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <button className="btn btn-light" onClick={() => openAuthModal("register")} type="button">
                  Register
                </button>
                <button className="btn" onClick={() => openAuthModal("login")} type="button">
                  Login
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {isPromoOpen ? <div className="modal-backdrop fade show" onClick={closePromoModal} /> : null}

      {isWalletOpen ? <div className="modal-backdrop fade show" onClick={closeWalletModal} /> : null}

      <div
        aria-hidden={!isPromoOpen}
        className={`modal fade${isPromoOpen ? " show" : ""}`}
        id="promoModal"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closePromoModal();
          }
        }}
        role="dialog"
        style={{ display: isPromoOpen ? "block" : "none" }}
        tabIndex={-1}
      >
        <div className="modal-dialog auth-modal modal-dialog-centered" role="document">
          <div className="modal-content">
            <button aria-label="Close" className="modal-close" onClick={closePromoModal} type="button">
              <SymbolIcon className="icon icon-close" id="icon-close" />
            </button>
            <div className="auth-modal__container">
              <h3 className="caption">
                <span>Promocode</span>
              </h3>
              <div className="auth-form">
                <div className="form-row">
                  <div className="form-field">
                    <div className="input-valid">
                      <input
                        className="input-field"
                        id="promoInput"
                        onChange={(event) => setPromoCode(event.target.value)}
                        placeholder="Enter promo code"
                        type="text"
                        value={promoCode}
                      />
                    </div>
                  </div>
                </div>
                <button className="btn btn-auth activatePromo" onClick={() => void activatePromo()} type="button">
                  <span>Activate</span>
                </button>
                {promoStatus ? (
                  <div className="form-row" style={{ color: "#aeb9d1", fontSize: 12, marginTop: 8, textAlign: "center" }}>
                    {promoStatus}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden={!isWalletOpen}
        className={`modal fade${isWalletOpen ? " show" : ""}`}
        id="walletModal"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeWalletModal();
          }
        }}
        role="dialog"
        style={{ display: isWalletOpen ? "block" : "none" }}
        tabIndex={-1}
      >
        <div className="modal-dialog auth-modal modal-dialog-centered" role="document">
          <div className="modal-content">
            <button aria-label="Close" className="modal-close" onClick={closeWalletModal} type="button">
              <SymbolIcon className="icon icon-close" id="icon-close" />
            </button>
            <div className="auth-modal__container">
              <h3 className="caption">
                <span>Wallet</span>
              </h3>
              <div className="auth-form">
                <div className="form-row" style={{ color: "#aeb9d1", display: "flex", fontSize: 12, justifyContent: "space-between" }}>
                  <span>Main: {bridgeState.balanceMain}</span>
                  <span>Bonus: {bridgeState.balanceBonus}</span>
                </div>

                <div className="change-form">
                  <button
                    className="btn"
                    onClick={() => {
                      setOpenWalletSelect(null);
                      setWalletStatus("");
                      setWalletTab("deposit");
                      if (!depositProvider && !isDepositMethodsLoading) {
                        void loadDepositMethods();
                      }
                    }}
                    style={{ color: walletTab === "deposit" ? "#ffffff" : "#828f9a" }}
                    type="button"
                  >
                    Deposit
                  </button>
                  <div className="or" />
                  <button
                    className="btn"
                    onClick={() => {
                      setOpenWalletSelect(null);
                      setWalletStatus("");
                      setWalletTab("withdraw");
                      if (!withdrawProvider && !isDepositMethodsLoading) {
                        void loadDepositMethods("withdraw");
                      }
                    }}
                    style={{ color: walletTab === "withdraw" ? "#ffffff" : "#828f9a" }}
                    type="button"
                  >
                    Withdraw
                  </button>
                  <div className="or" />
                  <button
                    className="btn"
                    onClick={() => {
                      setOpenWalletSelect(null);
                      setWalletStatus("");
                      setWalletTab("exchange");
                    }}
                    style={{ color: walletTab === "exchange" ? "#ffffff" : "#828f9a" }}
                    type="button"
                  >
                    Exchange
                  </button>
                </div>

                {walletTab === "deposit" ? (
                  <>
                    <div className="form-row">
                      {renderWalletSelect(
                        "depositCurrency",
                        (depositProvider?.currencies ?? []).map((currency) => ({
                          disabled: !currency.status,
                          iconSrc: getCurrencyIconSrc(currency.code) ?? undefined,
                          iconId: "icon-coin",
                          label: `${currency.code} (${currency.name})`,
                          value: currency.code,
                        })),
                        depositCurrency,
                        (nextValue) => setDepositCurrency(nextValue),
                        isDepositMethodsLoading || isDepositAddressLoading || isWalletSubmitting,
                      )}
                    </div>
                    <div className="form-row">
                      {renderWalletSelect(
                        "depositNetwork",
                        (selectedCurrency?.networks ?? []).map((network) => ({
                          disabled: !network.status,
                          label: `${network.id} (${network.name})`,
                          value: network.id,
                        })),
                        depositNetwork,
                        (nextValue) => setDepositNetwork(nextValue),
                        isDepositMethodsLoading ||
                          isDepositAddressLoading ||
                          isWalletSubmitting ||
                          !depositProvider ||
                          !depositProvider.enabled,
                      )}
                    </div>
                    <div className="form-row" style={{ color: "#8ea2c4", fontSize: 12 }}>
                      {isDepositMethodsLoading
                        ? "Loading deposit options..."
                        : isDepositAddressLoading
                          ? "Deposit address generating..."
                          : !depositProvider?.enabled
                            ? (depositProvider?.reason ?? "Deposit is temporarily unavailable")
                            : selectedDepositAddress
                              ? "Use this address only on the selected network. Balance updates automatically after confirmation."
                              : selectedDepositError
                                ? selectedDepositError
                                : "Deposit address generating..."}
                    </div>
                    <div className="form-row">
                      <div className="form-field">
                        <div className="input-valid">
                          <input
                            className="input-field"
                            placeholder="Deposit address"
                            readOnly
                            type="text"
                            value={selectedDepositAddress}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {walletTab === "exchange" ? (
                  <div className="change-form">
                    <button
                      className="btn"
                      onClick={() => setExchangeFrom("main")}
                      style={{ color: exchangeFrom === "main" ? "#ffffff" : "#828f9a" }}
                      type="button"
                    >
                      Main -&gt; Bonus
                    </button>
                    <div className="or" />
                    <button
                      className="btn"
                      onClick={() => setExchangeFrom("bonus")}
                      style={{ color: exchangeFrom === "bonus" ? "#ffffff" : "#828f9a" }}
                      type="button"
                    >
                      Bonus -&gt; Main
                    </button>
                  </div>
                ) : null}

                {walletTab === "withdraw" ? (
                  <>
                    <div className="form-row">
                      {renderWalletSelect(
                        "withdrawCurrency",
                        (withdrawProvider?.currencies ?? []).map((currency) => ({
                          disabled: !currency.status,
                          iconSrc: getCurrencyIconSrc(currency.code) ?? undefined,
                          iconId: "icon-coin",
                          label: `${currency.code} (${currency.name})`,
                          value: currency.code,
                        })),
                        withdrawCurrency,
                        (nextValue) => setWithdrawCurrency(nextValue),
                        isDepositMethodsLoading || isWalletSubmitting || !withdrawProvider?.enabled,
                      )}
                    </div>
                    <div className="form-row">
                      {renderWalletSelect(
                        "withdrawNetwork",
                        (selectedWithdrawCurrency?.networks ?? []).map((network) => ({
                          disabled: !network.status,
                          label: `${network.id} (${network.name})`,
                          value: network.id,
                        })),
                        withdrawNetwork,
                        (nextValue) => setWithdrawNetwork(nextValue),
                        isDepositMethodsLoading || isWalletSubmitting || !withdrawProvider?.enabled,
                      )}
                    </div>
                    <div className="form-row">
                      <div className="form-field">
                        <div className="input-valid">
                          <input
                            className="input-field"
                            onChange={(event) => setWithdrawAddress(event.target.value)}
                            placeholder="Withdraw address"
                            type="text"
                            value={withdrawAddress}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-field">
                        <div className="input-valid">
                          <input
                            className="input-field"
                            onChange={(event) => setWalletAmount(event.target.value)}
                            placeholder="Enter amount (coins)"
                            type="number"
                            value={walletAmount}
                          />
                        </div>
                      </div>
                    </div>
                    <div
                      className="form-row"
                      style={{
                        color: "#8ea2c4",
                        display: "grid",
                        fontSize: 12,
                        gap: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      <div>
                        Estimated receive: {formatCryptoAmount(withdrawReceiveCrypto)} {withdrawCurrency || "COIN"}
                      </div>
                      <div>
                        Gross amount: {formatCryptoAmount(withdrawAmountCrypto)} {withdrawCurrency || "COIN"}
                      </div>
                      <div>
                        Network fee: {formatDepositInfo(selectedWithdrawNetwork?.withdrawFee, withdrawCurrency)}
                      </div>
                      <div>
                        Minimum withdraw: {formatDepositInfo(selectedWithdrawNetwork?.withdrawMin, withdrawCurrency)}
                      </div>
                      <div>
                        Required confirmations: {formatDepositInfo(selectedWithdrawNetwork?.requiredConfirmations)}
                      </div>
                      <div>
                        Rate: {withdrawRateUsd ? `1 ${withdrawCurrency} = ${withdrawRateUsd.toFixed(8)} USD` : "Unavailable"}
                      </div>
                    </div>
                  </>
                ) : null}

                {walletTab === "exchange" ? (
                  <div className="form-row">
                    <div className="form-field">
                      <div className="input-valid">
                        <input
                          className="input-field"
                          onChange={(event) => setWalletAmount(event.target.value)}
                          placeholder="Enter amount"
                          type="number"
                          value={walletAmount}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                <button
                  className="btn btn-auth"
                  disabled={
                    isWalletSubmitting ||
                    (walletTab === "deposit" &&
                      (isDepositMethodsLoading ||
                        isDepositAddressLoading ||
                        !depositProvider ||
                        !depositProvider.enabled ||
                        (!selectedDepositAddress && !selectedDepositError))) ||
                    (walletTab === "withdraw" &&
                      (isDepositMethodsLoading ||
                        !withdrawProvider ||
                        !withdrawProvider.enabled ||
                        !selectedWithdrawCurrency ||
                        !selectedWithdrawNetwork ||
                        !withdrawAddress.trim() ||
                        withdrawAmountCoins <= 0 ||
                        !withdrawRateUsd))
                  }
                  onClick={() => void handleWalletSubmit()}
                  type="button"
                >
                  <span>
                    {walletTab === "deposit"
                      ? isDepositAddressLoading
                        ? "Generating..."
                        : selectedDepositAddress
                          ? "Copy Address"
                          : selectedDepositError
                            ? "Retry"
                            : "Copy Address"
                      : isWalletSubmitting
                        ? "Please wait..."
                        : walletTab === "withdraw"
                          ? "Withdraw"
                          : "Exchange"}
                  </span>
                </button>

                {walletStatus ? (
                  <div className="form-row" style={{ color: "#aeb9d1", fontSize: 12, marginTop: 8, textAlign: "center" }}>
                    {walletStatus}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {bridgeState.authDialogOpen ? <div className="modal-backdrop fade show" onClick={closeAuthModal} /> : null}

      <div
        aria-hidden={!bridgeState.authDialogOpen}
        className={`modal fade${bridgeState.authDialogOpen ? " show" : ""}`}
        id="authModal"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeAuthModal();
          }
        }}
        role="dialog"
        style={{ display: bridgeState.authDialogOpen ? "block" : "none" }}
        tabIndex={-1}
      >
        <div className="modal-dialog auth-modal modal-dialog-centered" role="document">
          <div className="modal-content">
            <button aria-label="Close" className="modal-close" onClick={closeAuthModal} type="button">
              <SymbolIcon className="icon icon-close" id="icon-close" />
            </button>
            <div className="auth-modal__container">
              <h3 className="caption">
                <span>{bridgeState.authDialogTab === "login" ? "Login" : "Register"}</span>
              </h3>
              <div className="auth-form">
                <div className="form-row">
                  <div className="form-field">
                    <div className="input-valid">
                      <input
                        className="input-field"
                        onChange={(event) => setAuthUsername(event.target.value)}
                        placeholder="Username"
                        type="text"
                        value={authUsername}
                      />
                    </div>
                  </div>
                </div>

                {bridgeState.authDialogTab === "register" ? (
                  <div className="form-row">
                    <div className="form-field">
                      <div className="input-valid">
                        <input
                          className="input-field"
                          onChange={(event) => setAuthEmail(event.target.value)}
                          placeholder="Email (optional)"
                          type="email"
                          value={authEmail}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="form-row">
                  <div className="form-field">
                    <div className="input-valid">
                      <input
                        className="input-field"
                        onChange={(event) => setAuthPassword(event.target.value)}
                        placeholder="Password"
                        type="password"
                        value={authPassword}
                      />
                    </div>
                  </div>
                </div>

                {bridgeState.authDialogTab === "register" ? (
                  <div className="form-row">
                    <div className="form-field">
                      <div className="input-valid">
                        <input
                          className="input-field"
                          onChange={(event) => setAuthPasswordRepeat(event.target.value)}
                          placeholder="Repeat Password"
                          type="password"
                          value={authPasswordRepeat}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                <button className="btn btn-auth" onClick={() => void handleAuthSubmit()} type="button">
                  <span>
                    {isAuthSubmitting
                      ? "Please wait..."
                      : bridgeState.authDialogTab === "login"
                        ? "Login"
                        : "Register"}
                  </span>
                </button>

                <div className="change-form">
                  <button
                    className="btn"
                    onClick={() => openAuthModal("login")}
                    style={{ color: bridgeState.authDialogTab === "login" ? "#ffffff" : "#828f9a" }}
                    type="button"
                  >
                    Login
                  </button>
                  <div className="or" />
                  <button
                    className="btn"
                    onClick={() => openAuthModal("register")}
                    style={{ color: bridgeState.authDialogTab === "register" ? "#ffffff" : "#828f9a" }}
                    type="button"
                  >
                    Register
                  </button>
                </div>

                {authStatus ? (
                  <div className="form-row" style={{ color: "#aeb9d1", fontSize: 12, marginTop: 8, textAlign: "center" }}>
                    {authStatus}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
