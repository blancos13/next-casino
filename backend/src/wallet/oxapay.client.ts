import { createHmac, timingSafeEqual } from "crypto";
import { AppError } from "../common/errors";
import type { Env } from "../config/env";

type OxaPayGenericResponse = {
  result?: unknown;
  status?: unknown;
  message?: unknown;
  data?: unknown;
  error?: unknown;
};

type OxaPayNetworkRaw = {
  network?: unknown;
  name?: unknown;
  keys?: unknown;
  status?: unknown;
  minConfirm?: unknown;
  requiredConfirmations?: unknown;
  required_confirmations?: unknown;
  withdrawFee?: unknown;
  withdraw_fee?: unknown;
  withdrawMin?: unknown;
  withdraw_min?: unknown;
  withdrawMax?: unknown;
  withdraw_max?: unknown;
  depositMin?: unknown;
  deposit_min?: unknown;
  depositMax?: unknown;
  deposit_max?: unknown;
  staticFixedFee?: unknown;
  static_fixed_fee?: unknown;
};

type OxaPayCurrencyRaw = {
  symbol?: unknown;
  short_name?: unknown;
  currency?: unknown;
  name?: unknown;
  status?: unknown;
  networks?: unknown;
  networkList?: unknown;
};

type OxaPayAcceptedCurrencyRaw = {
  short_name?: unknown;
  currency?: unknown;
  symbol?: unknown;
  networks?: unknown;
  network?: unknown;
};

type OxaPayAllowedCoinsResponse = OxaPayGenericResponse & {
  allowed?: unknown;
};

type OxaPayStaticAddressResponse = OxaPayGenericResponse & {
  track_id?: unknown;
  trackId?: unknown;
  address?: unknown;
  wallet_address?: unknown;
  static_address?: unknown;
};

export type OxaPayCurrencyOption = {
  code: string;
  name: string;
  status: boolean;
  networks: OxaPayNetworkOption[];
};

export type OxaPayNetworkOption = {
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

export type OxaPayStaticAddressResult = {
  trackId: string;
  address: string;
  toCurrency: string;
  network: string;
  callbackUrl?: string;
  raw: Record<string, unknown>;
};

export class OxaPayClient {
  constructor(private readonly env: Env) {}

  getInvoiceCurrency(): string {
    return this.env.OXAPAY_INVOICE_CURRENCY.trim().toUpperCase();
  }

  getCoinsPerUsd(): number {
    return this.env.WALLET_COINS_PER_USD;
  }

  isConfigured(): boolean {
    return this.env.OXAPAY_MERCHANT_API_KEY.trim().length > 0;
  }

  isStaticAutoWithdrawalEnabled(): boolean {
    return this.env.OXAPAY_STATIC_AUTO_WITHDRAWAL;
  }

  verifyMerchantHmac(rawBody: string, hmacHeader?: string | null): boolean {
    if (!this.isConfigured()) {
      return false;
    }
    const provided = (hmacHeader ?? "").trim().toLowerCase();
    if (!provided) {
      return false;
    }
    const expected = createHmac("sha512", this.env.OXAPAY_MERCHANT_API_KEY.trim())
      .update(rawBody)
      .digest("hex")
      .toLowerCase();

    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(provided, "utf8");
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  getDefaultCurrencies(): OxaPayCurrencyOption[] {
    const fromMap = this.parseCurrencyNetworkMap(this.env.OXAPAY_DEFAULT_CURRENCY_NETWORKS);
    if (fromMap.length > 0) {
      return fromMap;
    }

    const fallbackCodes = this.env.OXAPAY_DEFAULT_CURRENCIES.split(",")
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);

    if (fallbackCodes.length === 0) {
      return [
        this.createFallbackCurrency("BTC", ["Bitcoin"]),
        this.createFallbackCurrency("ETH", ["Ethereum"]),
        this.createFallbackCurrency("USDT", ["Tron"]),
      ];
    }

    return fallbackCodes.map((code) => this.createFallbackCurrency(code, [this.defaultNetworkFor(code)]));
  }

  async getAcceptedCurrencies(): Promise<OxaPayCurrencyOption[]> {
    if (!this.isConfigured()) {
      return this.getDefaultCurrencies();
    }

    let piCurrencies: OxaPayCurrencyOption[] = [];
    let allowedCoins: Set<string> | null = null;

    try {
      piCurrencies = await this.getPiSupportedCurrencies();
    } catch {
      // fallback to legacy endpoint
    }

    try {
      allowedCoins = await this.getPiAllowedCoins();
    } catch {
      // if allowed endpoint fails, continue with all supported currencies
    }

    if (piCurrencies.length > 0) {
      const filtered =
        allowedCoins && allowedCoins.size > 0
          ? piCurrencies.filter((currency) => allowedCoins?.has(currency.code))
          : piCurrencies;
      if (filtered.length > 0) {
        return this.applyConfiguredAllowlist(filtered);
      }
    }

    let commonCurrencies: OxaPayCurrencyOption[] = [];
    try {
      const response = await this.requestJson<OxaPayGenericResponse>("/v1/common/currencies", "GET");
      if (!this.isSuccessResponse(response)) {
        throw new AppError("CONFLICT", this.extractError(response, "OxaPay currencies request failed"));
      }
      commonCurrencies = this.parseCommonCurrencies(response.data);
    } catch {
      // common endpoint can be unavailable; continue to accepted matrix fallback
    }
    if (commonCurrencies.length > 0) {
      return this.applyConfiguredAllowlist(commonCurrencies);
    }

    let acceptedMatrix = new Map<string, Set<string>>();
    try {
      acceptedMatrix = await this.getAcceptedCurrencyMatrix();
    } catch {
      // accepted-currencies endpoint can be unavailable too
    }
    if (acceptedMatrix.size > 0) {
      return this.applyConfiguredAllowlist(this.acceptedToFallbackCurrencies(acceptedMatrix));
    }
    return this.applyConfiguredAllowlist(this.getDefaultCurrencies());
  }

  async createStaticAddress(input: {
    network: string;
    toCurrency: string;
    callbackUrl?: string;
    email?: string;
    orderId?: string;
    description?: string;
  }): Promise<OxaPayStaticAddressResult> {
    if (!this.isConfigured()) {
      throw new AppError("CONFLICT", "OxaPay is not configured on server");
    }

    const network = input.network.trim();
    const toCurrency = input.toCurrency.trim().toUpperCase();
    if (!network || !toCurrency) {
      throw new AppError("VALIDATION_ERROR", "network and toCurrency are required");
    }

    const callbackUrl = this.normalizeCallbackUrl(input.callbackUrl ?? this.env.OXAPAY_CALLBACK_URL);
    const body: Record<string, unknown> = {
      merchant: this.env.OXAPAY_MERCHANT_API_KEY.trim(),
      currency: toCurrency,
      network,
    };

    if (callbackUrl) {
      body.callbackUrl = callbackUrl;
    }
    if (input.email?.trim()) {
      body.email = input.email.trim();
    }
    if (input.orderId?.trim()) {
      body.orderId = input.orderId.trim();
    }
    if (input.description?.trim()) {
      body.description = input.description.trim();
    }

    const response = await this.requestJson<OxaPayStaticAddressResponse>(
      "/merchants/request/staticaddress",
      "POST",
      body,
    );
    if (!this.isSuccessResponse(response)) {
      throw new AppError("CONFLICT", this.extractError(response, "Failed to generate static address"));
    }

    const dataRoot = response.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
    const nestedData =
      dataRoot.data && typeof dataRoot.data === "object" ? (dataRoot.data as Record<string, unknown>) : {};
    const data: Record<string, unknown> = {
      ...dataRoot,
      ...nestedData,
    };
    const trackId = this.pickString([
      response.track_id,
      response.trackId,
      data.track_id,
      data.trackId,
      data.track,
      data.id,
    ]);
    const address = this.pickString([
      response.address,
      response.wallet_address,
      response.static_address,
      data.address,
      data.wallet_address,
      data.static_address,
      data.payment_address,
      data.pay_address,
    ]);

    if (!address) {
      throw new AppError("INTERNAL_ERROR", "OxaPay static address response is incomplete");
    }
    const resolvedTrackId = trackId || `addr:${address.toLowerCase()}`;

    const responseNetwork = this.pickString([data.network, data.payNetwork, network]);
    const responseCurrency = this.pickString([data.currency, data.to_currency, toCurrency]).toUpperCase();
    const responseCallbackUrl = this.pickString([data.callbackUrl, data.callback_url, callbackUrl]);

    return {
      trackId: resolvedTrackId,
      address,
      toCurrency: responseCurrency,
      network: responseNetwork,
      callbackUrl: responseCallbackUrl || undefined,
      raw: this.toRecord(response),
    };
  }

  private normalizeCallbackUrl(raw: string): string | undefined {
    const value = raw.trim();
    if (!value) {
      return undefined;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") {
        return undefined;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host.endsWith(".local") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      ) {
        return undefined;
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  private parseCurrencyNetworkMap(raw: string): OxaPayCurrencyOption[] {
    const entries = raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const options: OxaPayCurrencyOption[] = [];
    for (const entry of entries) {
      const pair = entry.split(":");
      const code = (pair[0] ?? "").trim().toUpperCase();
      const networkChunk = (pair[1] ?? "").trim();
      if (!code) {
        continue;
      }
      const networks = networkChunk
        .split("|")
        .map((network) => network.trim())
        .filter((network) => network.length > 0);
      options.push(this.createFallbackCurrency(code, networks.length > 0 ? networks : [this.defaultNetworkFor(code)]));
    }

    return this.mergeCurrencyOptions(options);
  }

  private mergeCurrencyOptions(options: OxaPayCurrencyOption[]): OxaPayCurrencyOption[] {
    const grouped = new Map<string, OxaPayCurrencyOption>();
    for (const option of options) {
      const code = option.code.trim().toUpperCase();
      if (!code) {
        continue;
      }
      const existing =
        grouped.get(code) ??
        ({
          code,
          name: option.name || code,
          status: option.status,
          networks: [],
        } satisfies OxaPayCurrencyOption);

      const networkById = new Map(existing.networks.map((network) => [network.id, network]));
      for (const network of option.networks) {
        const id = network.id.trim();
        if (!id) {
          continue;
        }
        if (!networkById.has(id)) {
          networkById.set(id, network);
          continue;
        }
        const prev = networkById.get(id);
        if (!prev) {
          continue;
        }
        const aliases = new Set<string>([...prev.aliases, ...network.aliases]);
        networkById.set(id, {
          ...prev,
          aliases: Array.from(aliases),
          status: prev.status || network.status,
          requiredConfirmations: prev.requiredConfirmations ?? network.requiredConfirmations,
          withdrawFee: prev.withdrawFee ?? network.withdrawFee,
          withdrawMin: prev.withdrawMin ?? network.withdrawMin,
          withdrawMax: prev.withdrawMax ?? network.withdrawMax,
          depositMin: prev.depositMin ?? network.depositMin,
          depositMax: prev.depositMax ?? network.depositMax,
          staticFixedFee: prev.staticFixedFee ?? network.staticFixedFee,
        });
      }

      const mergedNetworks = Array.from(networkById.values());
      if (mergedNetworks.length === 0) {
        mergedNetworks.push(this.createFallbackNetwork(this.defaultNetworkFor(code)));
      }
      grouped.set(code, {
        code,
        name: existing.name || option.name || code,
        status: existing.status || option.status,
        networks: mergedNetworks,
      });
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, option]) => ({
        ...option,
        networks: option.networks.sort((a, b) => a.id.localeCompare(b.id)),
      }));
  }

  private defaultNetworkFor(code: string): string {
    if (code === "USDT" || code === "USDC") {
      return "Tron";
    }
    if (code === "BNB") {
      return "BSC";
    }
    return code;
  }

  private async getPiSupportedCurrencies(): Promise<OxaPayCurrencyOption[]> {
    const response = await this.requestJson<OxaPayGenericResponse>("/api/currencies", "POST", {});
    if (!this.isSuccessResponse(response)) {
      throw new AppError("CONFLICT", this.extractError(response, "OxaPay supported currencies request failed"));
    }
    const currencies = this.parseCommonCurrencies(response.data);
    await this.getPiSupportedNetworks().catch(() => undefined);
    return currencies;
  }

  private async getPiAllowedCoins(): Promise<Set<string>> {
    const response = await this.requestJson<OxaPayAllowedCoinsResponse>("/merchants/allowedCoins", "POST", {
      merchant: this.env.OXAPAY_MERCHANT_API_KEY.trim(),
    });
    if (!this.isSuccessResponse(response)) {
      throw new AppError("CONFLICT", this.extractError(response, "OxaPay allowed coins request failed"));
    }

    const dataAllowed =
      response.data && typeof response.data === "object"
        ? (response.data as { allowed?: unknown }).allowed
        : undefined;
    const listRaw = response.allowed ?? dataAllowed ?? response.data;
    const list = Array.isArray(listRaw) ? listRaw : [];
    const allowed = new Set<string>();
    for (const item of list) {
      if (typeof item !== "string") {
        continue;
      }
      const code = item.trim().toUpperCase();
      if (code) {
        allowed.add(code);
      }
    }
    return allowed;
  }

  private async getPiSupportedNetworks(): Promise<Set<string>> {
    const response = await this.requestJson<OxaPayGenericResponse>("/api/networks", "POST", {});
    if (!this.isSuccessResponse(response)) {
      throw new AppError("CONFLICT", this.extractError(response, "OxaPay supported networks request failed"));
    }

    const listRaw =
      response.data && typeof response.data === "object" && Array.isArray((response.data as { list?: unknown }).list)
        ? (response.data as { list: unknown[] }).list
        : Array.isArray(response.data)
          ? response.data
          : [];

    const networks = new Set<string>();
    for (const item of listRaw) {
      if (typeof item !== "string") {
        continue;
      }
      const normalized = item.trim().toUpperCase();
      if (normalized) {
        networks.add(normalized);
      }
    }
    return networks;
  }

  private async getAcceptedCurrencyMatrix(): Promise<Map<string, Set<string>>> {
    const response = await this.requestJson<OxaPayGenericResponse>("/v1/payment/accepted-currencies", "GET");
    if (!this.isSuccessResponse(response)) {
      throw new AppError("CONFLICT", this.extractError(response, "OxaPay accepted currencies request failed"));
    }
    return this.parseAcceptedCurrencyMatrix(response.data);
  }

  private parseAcceptedCurrencyMatrix(raw: unknown): Map<string, Set<string>> {
    const matrix = new Map<string, Set<string>>();
    const listRaw = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)
        ? ((raw as { list: unknown[] }).list as unknown[])
      : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: unknown[] }).data as unknown[])
        : raw && typeof raw === "object" && Array.isArray((raw as { currencies?: unknown }).currencies)
          ? ((raw as { currencies: unknown[] }).currencies as unknown[])
          : [];

    for (const itemRaw of listRaw) {
      if (typeof itemRaw === "string") {
        const code = itemRaw.trim().toUpperCase();
        if (code) {
          matrix.set(code, new Set<string>());
        }
        continue;
      }
      if (!itemRaw || typeof itemRaw !== "object") {
        continue;
      }
      const item = itemRaw as OxaPayAcceptedCurrencyRaw;
      const code = this.pickString([item.short_name, item.currency, item.symbol]).toUpperCase();
      if (!code) {
        continue;
      }
      const networksRaw = Array.isArray(item.networks)
        ? item.networks
        : item.network
          ? [item.network]
          : [];
      const networks = new Set<string>();
      for (const networkRaw of networksRaw) {
        if (typeof networkRaw !== "string") {
          continue;
        }
        const normalized = networkRaw.trim().toUpperCase();
        if (normalized) {
          networks.add(normalized);
        }
      }
      matrix.set(code, networks);
    }

    return matrix;
  }

  private mergeAcceptedAndCommon(
    commonCurrencies: OxaPayCurrencyOption[],
    acceptedMatrix: Map<string, Set<string>>,
  ): OxaPayCurrencyOption[] {
    if (acceptedMatrix.size === 0) {
      return commonCurrencies;
    }
    if (commonCurrencies.length === 0) {
      return this.acceptedToFallbackCurrencies(acceptedMatrix);
    }

    const merged: OxaPayCurrencyOption[] = [];
    const seenCodes = new Set<string>();

    for (const currency of commonCurrencies) {
      const acceptedNetworks = acceptedMatrix.get(currency.code);
      if (!acceptedNetworks) {
        continue;
      }

      const filteredNetworks = currency.networks.filter((network) =>
        this.matchesAcceptedNetwork(network, acceptedNetworks),
      );

      let networks = filteredNetworks;
      if (acceptedNetworks.size > 0 && filteredNetworks.length === 0) {
        networks = Array.from(acceptedNetworks.values()).map((networkCode) =>
          this.createFallbackNetwork(networkCode),
        );
      }
      if (acceptedNetworks.size === 0 && networks.length === 0) {
        networks = currency.networks;
      }
      if (networks.length === 0) {
        continue;
      }

      merged.push({
        ...currency,
        networks,
      });
      seenCodes.add(currency.code);
    }

    for (const [code, networks] of acceptedMatrix.entries()) {
      if (seenCodes.has(code)) {
        continue;
      }
      merged.push(
        this.createFallbackCurrency(code, networks.size > 0 ? Array.from(networks.values()) : [this.defaultNetworkFor(code)]),
      );
    }

    return this.mergeCurrencyOptions(merged);
  }

  private applyConfiguredAllowlist(currencies: OxaPayCurrencyOption[]): OxaPayCurrencyOption[] {
    const configured = this.parseCurrencyNetworkMap(this.env.OXAPAY_DEFAULT_CURRENCY_NETWORKS);
    if (configured.length === 0) {
      return currencies;
    }

    const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
    const output: OxaPayCurrencyOption[] = [];

    for (const allowed of configured) {
      const source = byCode.get(allowed.code);
      if (!source) {
        output.push(allowed);
        continue;
      }

      const allowedNetworks = allowed.networks;
      if (allowedNetworks.length === 0) {
        output.push(source);
        continue;
      }

      const filteredNetworks = source.networks.filter((network) =>
        allowedNetworks.some((allowedNetwork) => this.networkMatches(network, allowedNetwork)),
      );

      output.push({
        ...source,
        networks: filteredNetworks.length > 0 ? filteredNetworks : allowedNetworks,
      });
    }

    return this.mergeCurrencyOptions(output);
  }

  private acceptedToFallbackCurrencies(acceptedMatrix: Map<string, Set<string>>): OxaPayCurrencyOption[] {
    const options: OxaPayCurrencyOption[] = [];
    for (const [code, networks] of acceptedMatrix.entries()) {
      options.push(
        this.createFallbackCurrency(code, networks.size > 0 ? Array.from(networks.values()) : [this.defaultNetworkFor(code)]),
      );
    }
    return this.mergeCurrencyOptions(options);
  }

  private matchesAcceptedNetwork(network: OxaPayNetworkOption, acceptedNetworks: Set<string>): boolean {
    if (acceptedNetworks.size === 0) {
      return true;
    }
    const candidates = new Set<string>();
    candidates.add(network.id.trim().toUpperCase());
    candidates.add(network.requestNetwork.trim().toUpperCase());
    for (const alias of network.aliases) {
      const normalizedAlias = alias.trim().toUpperCase();
      if (normalizedAlias) {
        candidates.add(normalizedAlias);
      }
    }
    for (const candidate of candidates) {
      if (acceptedNetworks.has(candidate)) {
        return true;
      }
    }
    return false;
  }

  private networkMatches(a: OxaPayNetworkOption, b: OxaPayNetworkOption): boolean {
    const tokensA = new Set<string>();
    const tokensB = new Set<string>();

    const addTokens = (target: Set<string>, network: OxaPayNetworkOption) => {
      target.add(network.id.trim().toUpperCase());
      target.add(network.requestNetwork.trim().toUpperCase());
      for (const alias of network.aliases) {
        const normalized = alias.trim().toUpperCase();
        if (normalized) {
          target.add(normalized);
        }
      }
    };

    addTokens(tokensA, a);
    addTokens(tokensB, b);

    for (const token of tokensA) {
      if (tokensB.has(token)) {
        return true;
      }
    }
    return false;
  }

  private parseCommonCurrencies(raw: unknown): OxaPayCurrencyOption[] {
    const candidates = this.extractCurrencyMaps(raw);
    if (candidates.length === 0) {
      return [];
    }

    const output: OxaPayCurrencyOption[] = [];
    for (const map of candidates) {
      for (const [key, currencyRaw] of Object.entries(map)) {
        if (!currencyRaw || typeof currencyRaw !== "object") {
          continue;
        }
        const currency = currencyRaw as OxaPayCurrencyRaw;
        const code = this.pickString([currency.symbol, currency.short_name, currency.currency, key]).toUpperCase();
        if (!code) {
          continue;
        }

        const statusRaw = currency.status;
        const status = typeof statusRaw === "boolean" ? statusRaw : true;
        const name = this.pickString([currency.name, code]) || code;

        const networks: OxaPayNetworkOption[] = [];
        const networkListRaw =
          currency.networks && typeof currency.networks === "object"
            ? currency.networks
            : currency.networkList && typeof currency.networkList === "object"
              ? currency.networkList
              : null;
        if (networkListRaw && typeof networkListRaw === "object") {
          const rawNetworks = networkListRaw as Record<string, unknown>;
          for (const [networkKey, networkRaw] of Object.entries(rawNetworks)) {
            if (!networkRaw || typeof networkRaw !== "object") {
              continue;
            }
            const network = networkRaw as OxaPayNetworkRaw;
            const networkId = this.pickString([network.network, networkKey]) || networkKey;
            if (!networkId) {
              continue;
            }
            const aliases = Array.isArray(network.keys)
              ? network.keys
                  .map((item) => (typeof item === "string" ? item.trim() : ""))
                  .filter((item) => item.length > 0)
              : [];
            const networkStatusRaw = network.status;
            const networkStatus =
              (typeof networkStatusRaw === "boolean" ? networkStatusRaw : true) && status;
            const aliasSet = new Set<string>(aliases);
            if (networkKey.trim()) {
              aliasSet.add(networkKey.trim());
            }
            if (typeof network.network === "string" && network.network.trim()) {
              aliasSet.add(network.network.trim());
            }

            networks.push({
              id: networkId,
              name: this.pickString([network.name, `${networkId} Network`]) || `${networkId} Network`,
              requestNetwork: networkId,
              aliases: Array.from(aliasSet.values()),
              status: networkStatus,
              requiredConfirmations:
                this.pickNumber([network.required_confirmations, network.requiredConfirmations, network.minConfirm]) ??
                undefined,
              withdrawFee: this.pickNumber([network.withdraw_fee, network.withdrawFee]) ?? undefined,
              withdrawMin: this.pickNumber([network.withdraw_min, network.withdrawMin]) ?? undefined,
              withdrawMax: this.pickNumber([network.withdraw_max, network.withdrawMax]) ?? undefined,
              depositMin: this.pickNumber([network.deposit_min, network.depositMin]) ?? undefined,
              depositMax: this.pickNumber([network.deposit_max, network.depositMax]) ?? undefined,
              staticFixedFee: this.pickNumber([network.static_fixed_fee, network.staticFixedFee]) ?? undefined,
            });
          }
        }

        output.push({
          code,
          name,
          status,
          networks: networks.length > 0 ? networks : [this.createFallbackNetwork(this.defaultNetworkFor(code))],
        });
      }
    }

    return this.mergeCurrencyOptions(output);
  }

  private extractCurrencyMaps(raw: unknown): Array<Record<string, unknown>> {
    if (!raw) {
      return [];
    }

    if (typeof raw === "object" && !Array.isArray(raw)) {
      const objectRaw = raw as Record<string, unknown>;
      const directLooksLikeMap = Object.values(objectRaw).some((value) => value && typeof value === "object");
      const nestedData = objectRaw.data;
      if (nestedData && typeof nestedData === "object" && !Array.isArray(nestedData)) {
        return [nestedData as Record<string, unknown>];
      }
      if (directLooksLikeMap) {
        return [objectRaw];
      }
      return [];
    }

    if (Array.isArray(raw)) {
      const fromArray: Record<string, unknown> = {};
      raw.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const item = entry as OxaPayCurrencyRaw;
        const code = this.pickString([item.symbol, item.short_name, item.currency]).toUpperCase();
        if (!code) {
          return;
        }
        fromArray[code] = item as unknown as Record<string, unknown>;
      });
      return Object.keys(fromArray).length > 0 ? [fromArray] : [];
    }

    return [];
  }

  private createFallbackCurrency(code: string, networks: string[]): OxaPayCurrencyOption {
    const cleanCode = code.trim().toUpperCase();
    const networkList = networks
      .map((network) => network.trim())
      .filter((network) => network.length > 0);
    const finalNetworks = networkList.length > 0 ? networkList : [this.defaultNetworkFor(cleanCode)];

    return {
      code: cleanCode,
      name: cleanCode,
      status: true,
      networks: finalNetworks.map((network) => this.createFallbackNetwork(network)),
    };
  }

  private createFallbackNetwork(network: string): OxaPayNetworkOption {
    const id = network.trim();
    return {
      id,
      name: `${id} Network`,
      requestNetwork: id,
      aliases: [id],
      status: true,
    };
  }

  private isSuccessResponse(response: OxaPayGenericResponse): boolean {
    const result = Number(response.result);
    if (Number.isFinite(result) && result >= 100 && result < 200) {
      return true;
    }
    const status = Number(response.status);
    if (Number.isFinite(status) && status >= 200 && status < 300) {
      return true;
    }
    return false;
  }

  private async requestJson<T>(
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.env.OXAPAY_API_BASE.replace(/\/+$/, "")}${path}`;

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.isConfigured()) {
      headers.merchant_api_key = this.env.OXAPAY_MERCHANT_API_KEY.trim();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.OXAPAY_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const rawBody = await response.text();
      let json: unknown = null;
      if (rawBody.trim().length > 0) {
        try {
          json = JSON.parse(rawBody) as unknown;
        } catch {
          json = null;
        }
      }

      if (!response.ok) {
        const responseJson = json && typeof json === "object" ? (json as OxaPayGenericResponse) : null;
        const rawMessage = responseJson?.message;
        const errorObject =
          responseJson?.error && typeof responseJson.error === "object"
            ? (responseJson.error as Record<string, unknown>)
            : null;
        const errorMessage =
          errorObject && typeof errorObject.message === "string" ? errorObject.message.trim() : "";
        const errorKey = errorObject && typeof errorObject.key === "string" ? errorObject.key.trim() : "";
        const fromJson = typeof rawMessage === "string" && rawMessage.trim().length > 0 ? rawMessage.trim() : "";
        const normalizedBody = rawBody.toLowerCase();
        const fromHtml =
          response.status === 429 || normalizedBody.includes("cloudflare") || normalizedBody.includes("access denied")
            ? "Payment provider is temporarily unavailable. Please try again shortly."
            : "";
        const fromValidation =
          errorKey === "invalid_to_currency"
            ? "This currency is currently unavailable for static deposit on your merchant account."
            : "";
        const message = fromValidation || errorMessage || fromJson || fromHtml || `OxaPay request failed with status ${response.status}`;
        throw new AppError("CONFLICT", message, {
          details: {
            status: response.status,
            errorKey: errorKey || undefined,
          },
        });
      }

      if (!json || typeof json !== "object") {
        throw new AppError("CONFLICT", "Invalid response from payment provider");
      }

      return json as T;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("CONFLICT", "OxaPay request timeout");
      }
      throw new AppError("CONFLICT", "Failed to reach OxaPay", {
        details: error instanceof Error ? { message: error.message } : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private extractError(input: OxaPayGenericResponse, fallback: string): string {
    if (typeof input.message === "string" && input.message.trim()) {
      return input.message.trim();
    }
    if (input.error && typeof input.error === "object") {
      const message = (input.error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
    return fallback;
  }

  private pickString(candidates: unknown[]): string {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
    return "";
  }

  private pickNumber(candidates: unknown[]): number | null {
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value >= 0) {
        return Number(value);
      }
    }
    return null;
  }

  private toRecord(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object") {
      return {};
    }
    return input as Record<string, unknown>;
  }
}
