import { createHash } from "crypto";

const defaultTikTokPixelCode = "DAKTULRC77UDHLL43EMG";
const tiktokEventsApiUrl = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

type TikTokRegistrationEvent = {
  email: string;
  eventId: string;
  pageUrl: string;
  request: Request;
};

function getCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
}

function getTikTokPixelCode() {
  return process.env.TIKTOK_PIXEL_CODE || process.env.NEXT_PUBLIC_TIKTOK_PIXEL_CODE || defaultTikTokPixelCode;
}

/**
 * Sends the server copy of a successful waitlist conversion. It is deliberately
 * a best-effort call: a TikTok outage must never prevent a signup from succeeding.
 */
export async function captureTikTokCompleteRegistration({ email, eventId, pageUrl, request }: TikTokRegistrationEvent) {
  const accessToken = process.env.TIKTOK_EVENTS_API_ACCESS_TOKEN;
  if (!accessToken) return false;

  const ttp = getCookie(request, "_ttp");
  const userAgent = request.headers.get("user-agent") || undefined;
  const clientIp = getClientIp(request);
  const emailHash = createHash("sha256").update(email.toLowerCase()).digest("hex");
  const ttclid = new URL(pageUrl).searchParams.get("ttclid") || undefined;
  const context = {
    page: { url: pageUrl },
    ...(ttclid ? { ad: { callback: ttclid } } : {}),
    user: {
      email: emailHash,
      ...(ttp ? { ttp } : {}),
    },
    ...(userAgent ? { user_agent: userAgent } : {}),
    ...(clientIp ? { ip: clientIp } : {}),
  };

  try {
    const response = await fetch(tiktokEventsApiUrl, {
      method: "POST",
      headers: {
        "Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pixel_code: getTikTokPixelCode(),
        event: "CompleteRegistration",
        event_id: eventId,
        timestamp: new Date().toISOString(),
        context,
        properties: {
          contents: [
            {
              content_id: "medula_waitlist",
              content_type: "product",
              content_name: "Medula App Waitlist",
            },
          ],
        },
        ...(process.env.TIKTOK_TEST_EVENT_CODE ? { test_event_code: process.env.TIKTOK_TEST_EVENT_CODE } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });

    const payload = (await response.json().catch(() => null)) as { code?: number } | null;
    return response.ok && (payload?.code === undefined || payload.code === 0);
  } catch {
    return false;
  }
}
