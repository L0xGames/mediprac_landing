import { type NextRequest, NextResponse } from "next/server";
import { normalizeQuizVisitMetadata, parseQuizVisitUpdate, recordQuizVisit } from "@/lib/quiz-visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstForwardedIp(request: NextRequest) {
  for (const header of ["x-vercel-forwarded-for", "x-forwarded-for", "cf-connecting-ip", "x-real-ip"]) {
    const value = request.headers.get(header);
    const ip = value?.split(",").map((entry) => entry.trim()).find(Boolean);
    if (ip) return ip;
  }
  return undefined;
}

function parseBrowser(userAgent: string) {
  const matchers = [
    ["Edge", /(?:Edg|EdgiOS|EdgA)\/([\d.]+)/],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ] as const;

  for (const [browser, expression] of matchers) {
    const match = userAgent.match(expression);
    if (match) return { browser, browserVersion: match[1] };
  }

  return {};
}

function parseOperatingSystem(userAgent: string) {
  if (/Windows NT 10\.0/.test(userAgent)) return "Windows 10/11";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Android/.test(userAgent)) return "Android";
  if (/(iPhone|iPad|iPod)/.test(userAgent)) return "iOS/iPadOS";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return undefined;
}

function parseDeviceType(userAgent: string) {
  if (/(iPad|Tablet|Android(?!.*Mobile))/.test(userAgent)) return "tablet";
  if (/(Mobi|iPhone|iPod|Android)/.test(userAgent)) return "phone";
  if (userAgent) return "desktop";
  return undefined;
}

function getRequestMetadata(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const browser = parseBrowser(userAgent);
  const hints = [
    "sec-ch-ua",
    "sec-ch-ua-full-version-list",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-ch-ua-platform-version",
    "sec-ch-ua-model",
    "sec-ch-viewport-width",
    "viewport-width",
    "dpr",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
  ]
    .map((header) => {
      const value = request.headers.get(header);
      return value ? `${header}=${value}` : "";
    })
    .filter(Boolean)
    .join("; ");

  return {
    ip: firstForwardedIp(request),
    userAgent: userAgent || undefined,
    ...browser,
    operatingSystem: parseOperatingSystem(userAgent),
    deviceType: parseDeviceType(userAgent),
    country: request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || undefined,
    countryRegion: request.headers.get("x-vercel-ip-country-region") || undefined,
    city: request.headers.get("x-vercel-ip-city") || undefined,
    latitude: request.headers.get("x-vercel-ip-latitude") || undefined,
    longitude: request.headers.get("x-vercel-ip-longitude") || undefined,
    acceptLanguage: request.headers.get("accept-language") || undefined,
    browserHints: hints || undefined,
  };
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const update = parseQuizVisitUpdate(body);
  if (!update) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const metadata = normalizeQuizVisitMetadata({ ...update.metadata, ...getRequestMetadata(request) });
    await recordQuizVisit({ ...update, metadata });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
