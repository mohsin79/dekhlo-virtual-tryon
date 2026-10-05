import type { PaymentEnvironment } from "@/lib/payments/types";

export type SafepayConfig = {
  environment: PaymentEnvironment;
  apiKey: string;
  secretKey: string;
  webhookSecret: string;
  intent: "CYBERSOURCE" | "MPGS";
  apiHost: string;
  checkoutBaseUrl: string;
};

type SafepayEnv = {
  SAFEPAY_ENVIRONMENT?: string;
  SAFEPAY_API_KEY?: string;
  SAFEPAY_SECRET_KEY?: string;
  SAFEPAY_WEBHOOK_SECRET?: string;
  SAFEPAY_PAYMENT_INTENT?: string;
};

const HOSTS: Record<PaymentEnvironment, { apiHost: string; checkoutBaseUrl: string }> = {
  sandbox: {
    apiHost: "https://sandbox.api.getsafepay.com",
    checkoutBaseUrl: "https://sandbox.api.getsafepay.com/embedded/",
  },
  production: {
    apiHost: "https://api.getsafepay.com",
    checkoutBaseUrl: "https://getsafepay.com/embedded/",
  },
};

export class SafepayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafepayConfigError";
  }
}

export function safepayEnvFromProcess(env: NodeJS.ProcessEnv = process.env): SafepayEnv {
  return {
    SAFEPAY_ENVIRONMENT: env.SAFEPAY_ENVIRONMENT,
    SAFEPAY_API_KEY: env.SAFEPAY_API_KEY,
    SAFEPAY_SECRET_KEY: env.SAFEPAY_SECRET_KEY,
    SAFEPAY_WEBHOOK_SECRET: env.SAFEPAY_WEBHOOK_SECRET,
    SAFEPAY_PAYMENT_INTENT: env.SAFEPAY_PAYMENT_INTENT,
  };
}

export function resolveSafepayConfig(env: SafepayEnv): SafepayConfig {
  const environment = env.SAFEPAY_ENVIRONMENT?.trim();

  if (environment !== "sandbox" && environment !== "production") {
    throw new SafepayConfigError("SAFEPAY_ENVIRONMENT must be sandbox or production.");
  }

  const apiKey = env.SAFEPAY_API_KEY?.trim() ?? "";
  const secretKey = env.SAFEPAY_SECRET_KEY?.trim() ?? "";
  const webhookSecret = env.SAFEPAY_WEBHOOK_SECRET?.trim() ?? "";

  if (!apiKey || !secretKey || !webhookSecret) {
    throw new SafepayConfigError(
      "SAFEPAY_API_KEY, SAFEPAY_SECRET_KEY, and SAFEPAY_WEBHOOK_SECRET are required.",
    );
  }

  const intentRaw = env.SAFEPAY_PAYMENT_INTENT?.trim() || "CYBERSOURCE";

  if (intentRaw !== "CYBERSOURCE" && intentRaw !== "MPGS") {
    throw new SafepayConfigError("SAFEPAY_PAYMENT_INTENT must be CYBERSOURCE or MPGS.");
  }

  return {
    environment,
    apiKey,
    secretKey,
    webhookSecret,
    intent: intentRaw,
    ...HOSTS[environment],
  };
}
