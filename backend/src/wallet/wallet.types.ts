export type WalletBalance = {
  main: string;
  bonus: string;
  stateVersion: number;
};

export type WalletMutationResult = WalletBalance & {
  ledgerId: string;
};

export type WalletExchangeInput = {
  from: "main" | "bonus";
  to: "main" | "bonus";
  amount: number;
};

export type WalletDepositProvider = {
  id: "oxapay";
  title: string;
  enabled: boolean;
  reason?: string;
  currencies: Array<{
    code: string;
    name: string;
    status: boolean;
    usdRate?: number | null;
    networks: Array<{
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
    }>;
  }>;
};
