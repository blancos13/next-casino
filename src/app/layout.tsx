import type { Metadata } from "next";
import { headers } from "next/headers";
import { Exo_2, Open_Sans } from "next/font/google";
import "./globals.css";

const exo = Exo_2({
  variable: "--font-exo",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

type PublicSiteSettings = {
  domain: string;
  sitename: string;
  title: string;
  description: string;
  keywords: string;
};

const DEFAULT_SITE_SETTINGS: PublicSiteSettings = {
  domain: "localhost:3000",
  sitename: "win2x",
  title: "win2x - crypto casino",
  description: "Win2x crypto casino platform.",
  keywords: "win2x, crypto casino",
};

const resolveBackendHttpBase = (): string => {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsUrl) {
    try {
      const parsed = new URL(wsUrl);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      parsed.pathname = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      // fallback below
    }
  }
  return "http://localhost:8080";
};

const normalizeDomain = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const firstHost = trimmed.split(",")[0]?.trim() ?? "";
  return firstHost.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
};

const toSiteUrl = (domain: string): string => {
  if (/^https?:\/\//i.test(domain)) {
    return domain;
  }
  const normalizedDomain = normalizeDomain(domain) || DEFAULT_SITE_SETTINGS.domain;
  const lower = normalizedDomain.toLowerCase();
  const protocol = lower.startsWith("localhost") || lower.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${normalizedDomain}`;
};

const resolveRequestHost = async (): Promise<string> => {
  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    return normalizeDomain(host ?? "");
  } catch {
    return "";
  }
};

const fetchPublicSiteSettings = async (): Promise<PublicSiteSettings> => {
  const requestHost = await resolveRequestHost();

  try {
    const response = await fetch(`${resolveBackendHttpBase()}/site/settings`, {
      method: "GET",
      cache: "no-store",
      headers: requestHost ? { "x-site-host": requestHost } : undefined,
    });
    if (!response.ok) {
      throw new Error(`site-settings:${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: Partial<PublicSiteSettings>;
    };
    const data = payload?.data ?? {};

    return {
      domain: normalizeDomain(data.domain ?? "") || requestHost || DEFAULT_SITE_SETTINGS.domain,
      sitename: (data.sitename ?? "").trim() || DEFAULT_SITE_SETTINGS.sitename,
      title: (data.title ?? "").trim() || DEFAULT_SITE_SETTINGS.title,
      description: (data.description ?? "").trim() || DEFAULT_SITE_SETTINGS.description,
      keywords: (data.keywords ?? "").trim() || DEFAULT_SITE_SETTINGS.keywords,
    };
  } catch {
    return {
      ...DEFAULT_SITE_SETTINGS,
      domain: requestHost || DEFAULT_SITE_SETTINGS.domain,
    };
  }
};

export async function generateMetadata(): Promise<Metadata> {
  const settings = await fetchPublicSiteSettings();
  let metadataBase: URL | undefined;
  try {
    metadataBase = new URL(toSiteUrl(settings.domain));
  } catch {
    metadataBase = undefined;
  }

  return {
    title: settings.title,
    description: settings.description,
    keywords: settings.keywords
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    applicationName: settings.sitename,
    metadataBase,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="/css/main.css" rel="stylesheet" />
        <link href="/css/icon.css" rel="stylesheet" />
        <link href="/css/animation.css" rel="stylesheet" />
        <link href="/css/notify.css" rel="stylesheet" />
        <link href="/css/media.css" rel="stylesheet" />
        <link href="/css/affiliate.css" rel="stylesheet" />
        <link href="/css/free.css" rel="stylesheet" />
        <link href="/css/crash.css" rel="stylesheet" />
        <link href="/css/jackpot.css" rel="stylesheet" />
        <link href="/css/wheel.css" rel="stylesheet" />
        <link href="/css/coinflip.css" rel="stylesheet" />
        <link href="/css/battle.css" rel="stylesheet" />
        <link href="/css/dice.css" rel="stylesheet" />
      </head>
      <body className={`${exo.variable} ${openSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
