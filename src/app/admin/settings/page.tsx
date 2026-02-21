"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getCasinoBridge, toWsError } from "@/components/casino/state/casino-bridge";

type TabId = "site" | "jackpot" | "wheel" | "crash" | "pvp" | "battle" | "dice";

type FieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  colClass?: string;
};

type AdminSettingsRoom = {
  id: string;
  name: string;
  title: string;
  time: string;
  min: string;
  max: string;
  bets: string;
};

type ParsedSettings = {
  settings: Record<string, string>;
  rooms: AdminSettingsRoom[];
};
type ProviderFlowTarget = "deposit" | "withdraw";
type ProviderNetwork = {
  id: string;
  name: string;
  requestNetwork: string;
  aliases: string[];
  status: boolean;
};
type ProviderCurrency = {
  code: string;
  name: string;
  status: boolean;
  networks: ProviderNetwork[];
};
type ProviderSelection = {
  code: string;
  networks: string[];
};
type ProviderFlowConfig = {
  enabled: boolean;
  selections: ProviderSelection[];
};
type ProviderConfig = {
  provider: "oxapay";
  catalog: ProviderCurrency[];
  deposit: ProviderFlowConfig;
  withdraw: ProviderFlowConfig;
};

const bridge = getCasinoBridge();

const TAB_LIST: Array<{ id: TabId; label: string }> = [
  { id: "site", label: "Site settings" },
  { id: "jackpot", label: "Jackpot" },
  { id: "wheel", label: "Wheel" },
  { id: "crash", label: "Crash" },
  { id: "pvp", label: "PvP" },
  { id: "battle", label: "Battle" },
  { id: "dice", label: "Dice" },
];

const DEFAULT_ROOMS: AdminSettingsRoom[] = [
  { id: "1", name: "easy", title: "Easy", time: "", min: "", max: "", bets: "" },
  { id: "2", name: "medium", title: "Medium", time: "", min: "", max: "", bets: "" },
  { id: "3", name: "hard", title: "Hard", time: "", min: "", max: "", bets: "" },
];

const ROOM_SORT_ORDER: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

const DEFAULT_SITE_SETTINGS: Record<string, string> = {
  domain: "localhost:3000",
  sitename: "win2x",
  title: "win2x - crypto casino",
  description: "Win2x crypto casino platform.",
  keywords: "win2x, crypto casino",
};
const DEFAULT_PROVIDER_FLOW: ProviderFlowConfig = {
  enabled: true,
  selections: [],
};
const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "oxapay",
  catalog: [],
  deposit: { ...DEFAULT_PROVIDER_FLOW },
  withdraw: { ...DEFAULT_PROVIDER_FLOW },
};

const toText = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return fallback;
};

const cloneRooms = (rooms: AdminSettingsRoom[]): AdminSettingsRoom[] => rooms.map((room) => ({ ...room }));
const cloneProviderFlow = (flow: ProviderFlowConfig): ProviderFlowConfig => ({
  enabled: flow.enabled,
  selections: flow.selections.map((selection) => ({
    code: selection.code,
    networks: [...selection.networks],
  })),
});
const cloneProviderConfig = (config: ProviderConfig): ProviderConfig => ({
  provider: "oxapay",
  catalog: config.catalog.map((currency) => ({
    code: currency.code,
    name: currency.name,
    status: currency.status,
    networks: currency.networks.map((network) => ({
      id: network.id,
      name: network.name,
      requestNetwork: network.requestNetwork,
      aliases: [...network.aliases],
      status: network.status,
    })),
  })),
  deposit: cloneProviderFlow(config.deposit),
  withdraw: cloneProviderFlow(config.withdraw),
});

const resolveCurrentHost = (): string => {
  if (typeof window !== "undefined" && typeof window.location?.host === "string" && window.location.host.trim().length > 0) {
    return window.location.host.trim();
  }
  return DEFAULT_SITE_SETTINGS.domain;
};

const asPositiveText = (value: string | undefined, fallback: string): string => {
  const parsed = Number.parseFloat((value ?? "").trim());
  if (Number.isFinite(parsed) && parsed > 0) {
    return `${parsed}`;
  }
  return fallback;
};

const applySiteSettingsDefaults = (settings: Record<string, string>): Record<string, string> => {
  const domain = (settings.domain ?? "").trim() || resolveCurrentHost();
  const sitename = (settings.sitename ?? "").trim() || DEFAULT_SITE_SETTINGS.sitename;
  const title = (settings.title ?? "").trim() || DEFAULT_SITE_SETTINGS.title;
  const description = (settings.description ?? "").trim() || DEFAULT_SITE_SETTINGS.description;
  const keywords = (settings.keywords ?? "").trim() || DEFAULT_SITE_SETTINGS.keywords;
  const refPerc = asPositiveText(settings.ref_perc, "10");
  const refSum = asPositiveText(settings.ref_sum, "1");
  const minRefWithdraw = asPositiveText(settings.min_ref_withdraw, "1");
  return {
    ...settings,
    domain,
    sitename,
    title,
    description,
    keywords,
    ref_perc: refPerc,
    ref_sum: refSum,
    min_ref_withdraw: minRefWithdraw,
  };
};

const parseSettingsPayload = (payload: unknown): ParsedSettings => {
  if (!payload || typeof payload !== "object") {
    return { settings: applySiteSettingsDefaults({}), rooms: cloneRooms(DEFAULT_ROOMS) };
  }

  const root = payload as { data?: unknown; settings?: unknown; rooms?: unknown };
  const body = root.data && typeof root.data === "object" ? (root.data as { settings?: unknown; rooms?: unknown }) : root;

  const settingsRaw = body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : {};
  const parsedSettings: Record<string, string> = {};
  for (const [key, value] of Object.entries(settingsRaw)) {
    parsedSettings[key] = toText(value);
  }

  const roomsRaw = Array.isArray(body.rooms) ? body.rooms : [];
  const parsedRooms = roomsRaw
    .map((value, index) => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const row = value as Record<string, unknown>;
      const name = toText(row.name, "").trim();
      if (!name) {
        return null;
      }
      const room: AdminSettingsRoom = {
        id: toText(row.id, `${index + 1}`),
        name,
        title: toText(row.title, name),
        time: toText(row.time),
        min: toText(row.min),
        max: toText(row.max),
        bets: toText(row.bets),
      };
      return room;
    })
    .filter((room): room is AdminSettingsRoom => room !== null)
    .sort((left, right) => {
      const leftOrder = ROOM_SORT_ORDER[left.name] ?? 99;
      const rightOrder = ROOM_SORT_ORDER[right.name] ?? 99;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.name.localeCompare(right.name);
    });

  return {
    settings: applySiteSettingsDefaults(parsedSettings),
    rooms: parsedRooms.length > 0 ? parsedRooms : cloneRooms(DEFAULT_ROOMS),
  };
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return fallback;
};
const normalizeProviderFlow = (raw: unknown): ProviderFlowConfig => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const selectionsRaw = Array.isArray(source.selections) ? source.selections : [];
  const map = new Map<string, ProviderSelection>();
  selectionsRaw.forEach((selectionRaw) => {
    if (!selectionRaw || typeof selectionRaw !== "object") {
      return;
    }
    const selection = selectionRaw as Record<string, unknown>;
    const code = toText(selection.code, "").trim().toUpperCase();
    if (!code) {
      return;
    }
    const networksRaw = Array.isArray(selection.networks) ? selection.networks : [];
    const networks = Array.from(
      new Set(
        networksRaw
          .map((network) => toText(network, "").trim())
          .filter((network) => network.length > 0),
      ),
    );
    map.set(code, { code, networks });
  });
  return {
    enabled: toBoolean(source.enabled, true),
    selections: Array.from(map.values()).sort((left, right) => left.code.localeCompare(right.code)),
  };
};
const parseProviderConfigPayload = (payload: unknown): ProviderConfig => {
  if (!payload || typeof payload !== "object") {
    return cloneProviderConfig(DEFAULT_PROVIDER_CONFIG);
  }
  const root = payload as { data?: unknown };
  const body = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : (payload as Record<string, unknown>);
  const catalogRaw = Array.isArray(body.catalog) ? body.catalog : [];
  const currencyMap = new Map<string, ProviderCurrency>();
  catalogRaw.forEach((currencyRaw) => {
    if (!currencyRaw || typeof currencyRaw !== "object") {
      return;
    }
    const currency = currencyRaw as Record<string, unknown>;
    const code = toText(currency.code, "").trim().toUpperCase();
    if (!code) {
      return;
    }
    const networksRaw = Array.isArray(currency.networks) ? currency.networks : [];
    const networkMap = new Map<string, ProviderNetwork>();
    networksRaw.forEach((networkRaw) => {
      if (!networkRaw || typeof networkRaw !== "object") {
        return;
      }
      const network = networkRaw as Record<string, unknown>;
      const id = toText(network.id, "").trim();
      if (!id) {
        return;
      }
      const aliasesRaw = Array.isArray(network.aliases) ? network.aliases : [];
      const aliases = Array.from(
        new Set(
          aliasesRaw
            .map((alias) => toText(alias, "").trim())
            .filter((alias) => alias.length > 0),
        ),
      );
      networkMap.set(id, {
        id,
        name: toText(network.name, `${id} Network`),
        requestNetwork: toText(network.requestNetwork, id),
        aliases,
        status: toBoolean(network.status, true),
      });
    });
    currencyMap.set(code, {
      code,
      name: toText(currency.name, code),
      status: toBoolean(currency.status, true),
      networks: Array.from(networkMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
    });
  });
  return {
    provider: "oxapay",
    catalog: Array.from(currencyMap.values()).sort((left, right) => left.code.localeCompare(right.code)),
    deposit: normalizeProviderFlow(body.deposit),
    withdraw: normalizeProviderFlow(body.withdraw),
  };
};
const siteSections: Array<{ title: string; rows: FieldSpec[][] }> = [
  {
    title: "General setting:",
    rows: [
      [
        { key: "domain", label: "Domain:", placeholder: "localhost:3000", colClass: "col-lg-4" },
        { key: "sitename", label: "Sitename:", placeholder: "win2x", colClass: "col-lg-4" },
        { key: "title", label: "Title:", placeholder: "win2x - crypto casino", colClass: "col-lg-4" },
      ],
      [
        { key: "description", label: "Description for search engines:", placeholder: "Win2x crypto casino platform.", colClass: "col-lg-6" },
        { key: "keywords", label: "Keywords for search engines:", placeholder: "win2x, crypto casino", colClass: "col-lg-6" },
      ],
      [
        { key: "exchange_min", label: "Minimum amount for bonus exchange:", placeholder: "1000", colClass: "col-lg-4" },
        { key: "exchange_curs", label: "Bonus exchange rate:", placeholder: "2", colClass: "col-lg-4" },
        { key: "chat_dep", label: "The amount of deposit to use the chat. 0 - Disabled", placeholder: "0", colClass: "col-lg-4" },
      ],
      [
        { key: "bonus_group_time", label: "Timed bonus interval (every N minutes)", placeholder: "15", colClass: "col-lg-4" },
        { key: "max_active_ref", label: "Number of active referrals to receive the bonus:", placeholder: "8", colClass: "col-lg-4" },
      ],
    ],
  },
  {
    title: "Setup a referral system:",
    rows: [
      [
        { key: "ref_perc", label: "Referral win commission (%):", placeholder: "10", colClass: "col-lg-4" },
        { key: "ref_sum", label: "Signup bonus for referred user (coins):", placeholder: "1", colClass: "col-lg-4" },
        { key: "min_ref_withdraw", label: "Minimum referral withdrawal (coins):", placeholder: "1", colClass: "col-lg-4" },
      ],
    ],
  },
  {
    title: "Other settings:",
    rows: [
      [
        { key: "min_dep", label: "Minimum deposit amount:", placeholder: "Enter sum", colClass: "col-lg-3" },
        { key: "max_dep", label: "Maximum deposit amount:", placeholder: "Enter sum", colClass: "col-lg-3" },
        { key: "min_dep_withdraw", label: "The amount of deposits to make a withdraw:", placeholder: "Enter sum", colClass: "col-lg-3" },
        { key: "profit_koef", label: "Profit system ratio for antiminus (deposites * coef.):", placeholder: "Enter coef", colClass: "col-lg-3" },
      ],
    ],
  },
  {
    title: "OxaPay payment system settings:",
    rows: [
      [
        { key: "oxapay_api_base", label: "API base URL:", placeholder: "https://api.oxapay.com", colClass: "col-lg-4" },
        { key: "oxapay_merchant_api_key", label: "Merchant API key:", placeholder: "Enter API key", colClass: "col-lg-4" },
        { key: "oxapay_callback_url", label: "Callback URL:", placeholder: "https://your-domain.com/webhooks/oxapay", colClass: "col-lg-4" },
      ],
      [
        { key: "oxapay_return_url", label: "Return URL:", placeholder: "https://your-domain.com/wallet", colClass: "col-lg-4" },
        { key: "oxapay_invoice_currency", label: "Invoice currency:", placeholder: "USD", colClass: "col-lg-4" },
        { key: "wallet_coins_per_usd", label: "Coins per USD:", placeholder: "1", colClass: "col-lg-4" },
      ],
      [
        { key: "oxapay_timeout_ms", label: "API timeout (ms):", placeholder: "15000", colClass: "col-lg-4" },
        { key: "oxapay_invoice_lifetime_min", label: "Invoice lifetime (minutes):", placeholder: "60", colClass: "col-lg-4" },
        { key: "oxapay_static_auto_withdrawal", label: "Static auto-withdrawal (0/1):", placeholder: "0", colClass: "col-lg-4" },
      ],
      [{ key: "oxapay_sandbox", label: "Sandbox mode (0/1):", placeholder: "0", colClass: "col-lg-4" }],
    ],
  },
];

const wheelFields: FieldSpec[] = [
  { key: "wheel_timer", label: "Timer:", placeholder: "Timer", colClass: "col-lg-4" },
  { key: "wheel_min_bet", label: "Minimum bet amount:", placeholder: "Minimum bet amount", colClass: "col-lg-4" },
  { key: "wheel_max_bet", label: "Maximum bet amount:", placeholder: "Maximum bet amount", colClass: "col-lg-4" },
];

const crashFields: FieldSpec[] = [
  { key: "crash_timer", label: "Timer:", placeholder: "Timer", colClass: "col-lg-4" },
  { key: "crash_min_bet", label: "Minimum bet amount:", placeholder: "Minimum bet amount", colClass: "col-lg-4" },
  { key: "crash_max_bet", label: "Maximum bet amount:", placeholder: "Maximum bet amount", colClass: "col-lg-4" },
];

const pvpFields: FieldSpec[] = [
  { key: "flip_commission", label: "Game fee in %:", placeholder: "Enter the percentage", colClass: "col-lg-4" },
  { key: "flip_min_bet", label: "Minimum bet amount:", placeholder: "Minimum bet amount", colClass: "col-lg-4" },
  { key: "flip_max_bet", label: "Maximum bet amount:", placeholder: "Maximum bet amount", colClass: "col-lg-4" },
];

const battleFields: FieldSpec[] = [
  { key: "battle_timer", label: "Timer:", placeholder: "Timer", colClass: "col-lg-3" },
  { key: "battle_min_bet", label: "Minimum bet amount:", placeholder: "Minimum bet amount", colClass: "col-lg-3" },
  { key: "battle_max_bet", label: "Maximum bet amount:", placeholder: "Maximum bet amount", colClass: "col-lg-3" },
  { key: "battle_commission", label: "Game fee in %:", placeholder: "Game fee in %", colClass: "col-lg-3" },
];

const diceFields: FieldSpec[] = [
  { key: "dice_min_bet", label: "Minimum bet amount:", placeholder: "Minimum bet amount", colClass: "col-lg-6" },
  { key: "dice_max_bet", label: "Maximum bet amount:", placeholder: "Maximum bet amount", colClass: "col-lg-6" },
];

export default function AdminSettingsPage() {
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);

  const [activeTab, setActiveTab] = useState<TabId>("site");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [rooms, setRooms] = useState<AdminSettingsRoom[]>(cloneRooms(DEFAULT_ROOMS));
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(cloneProviderConfig(DEFAULT_PROVIDER_CONFIG));
  const [providerFlowTab, setProviderFlowTab] = useState<ProviderFlowTarget>("deposit");

  const [initialSettings, setInitialSettings] = useState<Record<string, string>>({});
  const [initialRooms, setInitialRooms] = useState<AdminSettingsRoom[]>(cloneRooms(DEFAULT_ROOMS));
  const [initialProviderConfig, setInitialProviderConfig] = useState<ProviderConfig>(cloneProviderConfig(DEFAULT_PROVIDER_CONFIG));

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  const formDisabled = isLoading || isSaving || !bridgeState.isAuthenticated;

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setStatus("");
    try {
      await bridge.ensureReady();
      if (!bridge.getState().isAuthenticated) {
        setSettings({});
        setRooms(cloneRooms(DEFAULT_ROOMS));
        setInitialSettings({});
        setInitialRooms(cloneRooms(DEFAULT_ROOMS));
        const fallbackProviderConfig = cloneProviderConfig(DEFAULT_PROVIDER_CONFIG);
        setProviderConfig(fallbackProviderConfig);
        setInitialProviderConfig(cloneProviderConfig(fallbackProviderConfig));
        setStatus("Login required for settings.");
        return;
      }
      const [settingsResponse, providerResponse] = await Promise.all([
        bridge.getAdminSettings(),
        bridge.getAdminWalletProviderConfig(),
      ]);
      const parsed = parseSettingsPayload(settingsResponse);
      const parsedProvider = parseProviderConfigPayload(providerResponse);
      setSettings(parsed.settings);
      setRooms(parsed.rooms);
      setProviderConfig(parsedProvider);
      setInitialSettings({ ...parsed.settings });
      setInitialRooms(cloneRooms(parsed.rooms));
      setInitialProviderConfig(cloneProviderConfig(parsedProvider));
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    void loadSettings();
  }, [bridgeState.isAuthenticated, loadSettings]);

  const setSettingValue = (key: string, value: string): void => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const setRoomValue = (roomId: string, field: "time" | "min" | "max" | "bets", value: string): void => {
    setRooms((prev) =>
      prev.map((room) => {
        if (room.id !== roomId) {
          return room;
        }
        return { ...room, [field]: value };
      }),
    );
  };
  const updateProviderFlow = (target: ProviderFlowTarget, updater: (flow: ProviderFlowConfig) => ProviderFlowConfig): void => {
    setProviderConfig((prev) => ({
      ...prev,
      [target]: updater(prev[target]),
    }));
  };
  const setProviderFlowEnabled = (target: ProviderFlowTarget, enabled: boolean): void => {
    updateProviderFlow(target, (flow) => ({
      ...flow,
      enabled,
    }));
  };
  const toggleProviderCurrency = (target: ProviderFlowTarget, code: string): void => {
    updateProviderFlow(target, (flow) => {
      const nextSelections = [...flow.selections];
      const existingIndex = nextSelections.findIndex((selection) => selection.code === code);
      if (existingIndex >= 0) {
        nextSelections.splice(existingIndex, 1);
      } else {
        nextSelections.push({ code, networks: [] });
      }
      return {
        ...flow,
        selections: nextSelections.sort((left, right) => left.code.localeCompare(right.code)),
      };
    });
  };
  const toggleProviderNetwork = (target: ProviderFlowTarget, code: string, networkId: string): void => {
    updateProviderFlow(target, (flow) => {
      const nextSelections = [...flow.selections];
      const existingIndex = nextSelections.findIndex((selection) => selection.code === code);
      if (existingIndex < 0) {
        nextSelections.push({ code, networks: [networkId] });
      } else {
        const current = nextSelections[existingIndex];
        const hasNetwork = current.networks.includes(networkId);
        const nextNetworks = hasNetwork
          ? current.networks.filter((item) => item !== networkId)
          : [...current.networks, networkId];
        nextSelections[existingIndex] = {
          code: current.code,
          networks: Array.from(new Set(nextNetworks)).sort((left, right) => left.localeCompare(right)),
        };
      }
      return {
        ...flow,
        selections: nextSelections.sort((left, right) => left.code.localeCompare(right.code)),
      };
    });
  };
  const activeProviderFlow = providerConfig[providerFlowTab];
  const selectionMap = useMemo(() => {
    const map = new Map<string, ProviderSelection>();
    activeProviderFlow.selections.forEach((selection) => {
      map.set(selection.code, selection);
    });
    return map;
  }, [activeProviderFlow]);

  const handleSave = async (): Promise<void> => {
    if (formDisabled) {
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      const [settingsResponse, providerResponse] = await Promise.all([
        bridge.saveAdminSettings({
          settings,
          rooms: rooms.map((room) => ({
            id: room.id,
            name: room.name,
            title: room.title,
            time: room.time,
            min: room.min,
            max: room.max,
            bets: room.bets,
          })),
        }),
        bridge.saveAdminWalletProviderConfig({
          provider: "oxapay",
          deposit: providerConfig.deposit,
          withdraw: providerConfig.withdraw,
        }),
      ]);
      const parsed = parseSettingsPayload(settingsResponse);
      const parsedProvider = parseProviderConfigPayload(providerResponse);
      setSettings(parsed.settings);
      setRooms(parsed.rooms);
      setProviderConfig(parsedProvider);
      setInitialSettings({ ...parsed.settings });
      setInitialRooms(cloneRooms(parsed.rooms));
      setInitialProviderConfig(cloneProviderConfig(parsedProvider));
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(toWsError(error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = (): void => {
    setSettings({ ...initialSettings });
    setRooms(cloneRooms(initialRooms));
    setProviderConfig(cloneProviderConfig(initialProviderConfig));
    setStatus("Form reset.");
  };

  const sectionField = (field: FieldSpec) => (
    <div className={field.colClass ?? "col-lg-4"} key={field.key}>
      <label>{field.label}</label>
      <input
        className="form-control"
        disabled={formDisabled}
        onChange={(event) => setSettingValue(field.key, event.target.value)}
        placeholder={field.placeholder}
        type="text"
        value={settings[field.key] ?? ""}
      />
    </div>
  );

  const paneStyle = useMemo(() => ({ display: "none" as const }), []);
  const activePaneStyle = useMemo(() => ({ display: "block" as const }), []);

  return (
    <AdminShell subtitle="Site settings" title="Settings">
      <div className="kt-portlet kt-portlet--tabs">
        <div className="kt-portlet__head">
          <div className="kt-portlet__head-toolbar">
            <ul className="nav nav-tabs nav-tabs-line nav-tabs-line-danger nav-tabs-line-2x nav-tabs-line-right" role="tablist">
              {TAB_LIST.map((tab) => (
                <li className="nav-item" key={tab.id}>
                  <button
                    className={`nav-link ${activeTab === tab.id ? "active" : ""}`}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="kt-portlet__body">
          <div className="tab-content">
            <div className={`tab-pane ${activeTab === "site" ? "active" : ""}`} id="site" role="tabpanel" style={activeTab === "site" ? activePaneStyle : paneStyle}>
              {siteSections.map((section) => (
                <div className="kt-section" key={section.title}>
                  <h3 className="kt-section__title">{section.title}</h3>
                  {section.rows.map((row, rowIndex) => (
                    <div className="form-group row" key={`${section.title}-${rowIndex}`}>
                      {row.map(sectionField)}
                    </div>
                  ))}
                </div>
              ))}
              <div className="kt-section">
                <h3 className="kt-section__title">OxaPay currency controls</h3>
                <div className="admin-provider-flow-tabs">
                  <button
                    className={`btn btn-sm ${providerFlowTab === "deposit" ? "btn-primary" : "btn-secondary"}`}
                    disabled={formDisabled}
                    onClick={() => setProviderFlowTab("deposit")}
                    type="button"
                  >
                    Deposit
                  </button>
                  <button
                    className={`btn btn-sm ${providerFlowTab === "withdraw" ? "btn-primary" : "btn-secondary"}`}
                    disabled={formDisabled}
                    onClick={() => setProviderFlowTab("withdraw")}
                    type="button"
                  >
                    Withdraw
                  </button>
                </div>
                <div className="form-group row">
                  <div className="col-lg-3">
                    <label>{providerFlowTab === "deposit" ? "Deposit" : "Withdraw"} status:</label>
                    <div className="admin-provider-toggle-group">
                      <button
                        className={`btn btn-sm ${activeProviderFlow.enabled ? "btn-success" : "btn-secondary"}`}
                        disabled={formDisabled}
                        onClick={() => setProviderFlowEnabled(providerFlowTab, true)}
                        type="button"
                      >
                        Enabled
                      </button>
                      <button
                        className={`btn btn-sm ${!activeProviderFlow.enabled ? "btn-danger" : "btn-secondary"}`}
                        disabled={formDisabled}
                        onClick={() => setProviderFlowEnabled(providerFlowTab, false)}
                        type="button"
                      >
                        Disabled
                      </button>
                    </div>
                  </div>
                  <div className="col-lg-9">
                    <label>Selection behavior:</label>
                    <div className="admin-provider-hint">
                      Selected coins are active. Unselected coins are hidden. If a selected coin has no selected network, all its networks are active.
                    </div>
                  </div>
                </div>
                {providerConfig.catalog.length === 0 ? (
                  <div className="admin-provider-empty">
                    Provider catalog is empty. Sync `wallet_provider_currency_catalog` first.
                  </div>
                ) : (
                  <div className="admin-provider-grid">
                    {providerConfig.catalog.map((currency) => {
                      const selection = selectionMap.get(currency.code);
                      const currencySelected = Boolean(selection);
                      const currencyAllowed = currencySelected;
                      return (
                        <div
                          className={`admin-provider-card ${currencySelected ? "is-selected" : ""} ${
                            currencyAllowed ? "is-allowed" : "is-blocked"
                          }`}
                          key={currency.code}
                        >
                          <div className="admin-provider-card-head">
                            <div>
                              <strong>{currency.code}</strong>
                              <span>{currency.name}</span>
                            </div>
                            <button
                              className={`btn btn-sm ${currencySelected ? "btn-primary" : "btn-secondary"}`}
                              disabled={formDisabled || !currency.status}
                              onClick={() => toggleProviderCurrency(providerFlowTab, currency.code)}
                              type="button"
                            >
                              {currencySelected ? "Active" : "Enable"}
                            </button>
                          </div>
                          <div className="admin-provider-network-list">
                            {currency.networks.length === 0 ? (
                              <span className="admin-provider-network-empty">No networks</span>
                            ) : (
                              currency.networks.map((network) => {
                                const networkSelected = selection?.networks.includes(network.id) ?? false;
                                const networkAllowed = currencySelected && (selection?.networks.length ? networkSelected : true);
                                return (
                                  <button
                                    className={`admin-provider-network-btn ${networkSelected ? "is-selected" : ""} ${
                                      networkAllowed ? "is-allowed" : "is-blocked"
                                    }`}
                                    disabled={formDisabled || !currency.status}
                                    key={`${currency.code}:${network.id}`}
                                    onClick={() => toggleProviderNetwork(providerFlowTab, currency.code, network.id)}
                                    type="button"
                                  >
                                    {network.id}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className={`tab-pane ${activeTab === "jackpot" ? "active" : ""}`} id="jackpot" role="tabpanel" style={activeTab === "jackpot" ? activePaneStyle : paneStyle}>
              <div className="form-group">
                <label>Game fee in %:</label>
                <input
                  className="form-control"
                  disabled={formDisabled}
                  onChange={(event) => setSettingValue("jackpot_commission", event.target.value)}
                  placeholder="Enter the percentage"
                  type="text"
                  value={settings.jackpot_commission ?? ""}
                />
              </div>

              {rooms.map((room) => (
                <div className="kt-section" key={`${room.id}-${room.name}`}>
                  <h3 className="kt-section__title">Room {room.title || room.name}:</h3>
                  <div className="form-group row">
                    <div className="col-lg-3">
                      <label>Timer:</label>
                      <input
                        className="form-control"
                        disabled={formDisabled}
                        onChange={(event) => setRoomValue(room.id, "time", event.target.value)}
                        placeholder="Timer"
                        type="text"
                        value={room.time}
                      />
                    </div>
                    <div className="col-lg-3">
                      <label>Minimum bet amount:</label>
                      <input
                        className="form-control"
                        disabled={formDisabled}
                        onChange={(event) => setRoomValue(room.id, "min", event.target.value)}
                        placeholder="Minimum bet amount"
                        type="text"
                        value={room.min}
                      />
                    </div>
                    <div className="col-lg-3">
                      <label>Maximum bet amount:</label>
                      <input
                        className="form-control"
                        disabled={formDisabled}
                        onChange={(event) => setRoomValue(room.id, "max", event.target.value)}
                        placeholder="Maximum bet amount"
                        type="text"
                        value={room.max}
                      />
                    </div>
                    <div className="col-lg-3">
                      <label>Maximum number of bets per player:</label>
                      <input
                        className="form-control"
                        disabled={formDisabled}
                        onChange={(event) => setRoomValue(room.id, "bets", event.target.value)}
                        placeholder="Maximum number of bets per player"
                        type="text"
                        value={room.bets}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={`tab-pane ${activeTab === "wheel" ? "active" : ""}`} id="wheel" role="tabpanel" style={activeTab === "wheel" ? activePaneStyle : paneStyle}>
              <div className="form-group row">{wheelFields.map(sectionField)}</div>
            </div>

            <div className={`tab-pane ${activeTab === "crash" ? "active" : ""}`} id="crash" role="tabpanel" style={activeTab === "crash" ? activePaneStyle : paneStyle}>
              <div className="form-group row">{crashFields.map(sectionField)}</div>
            </div>

            <div className={`tab-pane ${activeTab === "pvp" ? "active" : ""}`} id="pvp" role="tabpanel" style={activeTab === "pvp" ? activePaneStyle : paneStyle}>
              <div className="form-group row">{pvpFields.map(sectionField)}</div>
            </div>

            <div className={`tab-pane ${activeTab === "battle" ? "active" : ""}`} id="battle" role="tabpanel" style={activeTab === "battle" ? activePaneStyle : paneStyle}>
              <div className="form-group row">{battleFields.map(sectionField)}</div>
            </div>

            <div className={`tab-pane ${activeTab === "dice" ? "active" : ""}`} id="dice" role="tabpanel" style={activeTab === "dice" ? activePaneStyle : paneStyle}>
              <div className="form-group row">{diceFields.map(sectionField)}</div>
            </div>
          </div>
        </div>

        <div className="kt-portlet__foot">
          <div className="kt-form__actions admin-settings-actions">
            <button className="btn btn-primary btn-sm" disabled={formDisabled} onClick={() => void handleSave()} type="button">
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={isSaving || isLoading} onClick={handleReset} type="button">
              Reset
            </button>
            <button className="btn btn-light btn-sm" disabled={isSaving} onClick={() => void loadSettings()} type="button">
              Refresh
            </button>
            {!bridgeState.isAuthenticated ? (
              <button className="btn btn-outline-primary btn-sm" onClick={() => bridge.openAuthDialog("login")} type="button">
                Login
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {isLoading ? <div className="admin-message mt-3">Loading settings...</div> : null}
      {status ? <div className="admin-message mt-3">{status}</div> : null}
    </AdminShell>
  );
}
