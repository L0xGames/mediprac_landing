const defaultTikTokPixelCode = "DAKTULRC77UDHLL43EMG";

type TikTokPixel = Array<unknown> & {
  _i?: Record<string, TikTokPixel>;
  _o?: Record<string, unknown>;
  _t?: Record<string, number>;
  _u?: string;
  instance?: (pixelCode: string) => TikTokPixel;
  load?: (pixelCode: string, options?: Record<string, unknown>) => void;
  page?: () => void;
  track?: (event: string, properties?: Record<string, unknown>, options?: { event_id?: string }) => void;
  identify?: (properties: Record<string, string>) => void;
  grantConsent?: () => void;
  revokeConsent?: () => void;
};

declare global {
  interface Window {
    TiktokAnalyticsObject?: string;
    ttq?: TikTokPixel;
  }
}

export function getTikTokPixelCode() {
  return process.env.NEXT_PUBLIC_TIKTOK_PIXEL_CODE || defaultTikTokPixelCode;
}

function getOrCreateTikTokQueue() {
  if (window.ttq) return window.ttq;

  const ttq = [] as unknown as TikTokPixel;
  const methods = [
    "page",
    "track",
    "identify",
    "instances",
    "debug",
    "on",
    "off",
    "once",
    "ready",
    "alias",
    "group",
    "enableCookie",
    "disableCookie",
    "holdConsent",
    "revokeConsent",
    "grantConsent",
  ];

  const setAndDefer = (target: TikTokPixel, method: string) => {
    (target as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };

  for (const method of methods) setAndDefer(ttq, method);

  ttq.instance = (pixelCode: string) => {
    const instance = ttq._i?.[pixelCode] || ([] as unknown as TikTokPixel);
    for (const method of methods) setAndDefer(instance, method);
    return instance;
  };

  ttq.load = (pixelCode: string, options?: Record<string, unknown>) => {
    const source = "https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i ||= {};
    ttq._i[pixelCode] ||= [] as unknown as TikTokPixel;
    ttq._i[pixelCode]._u = source;
    ttq._t ||= {};
    ttq._t[pixelCode] = Date.now();
    ttq._o ||= {};
    ttq._o[pixelCode] = options || {};

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = `${source}?sdkid=${pixelCode}&lib=ttq`;
    document.head.append(script);
  };

  window.TiktokAnalyticsObject = "ttq";
  window.ttq = ttq;
  return ttq;
}

/** Loads TikTok only after the visitor has agreed to marketing measurement. */
export function grantTikTokConsentAndLoadPixel() {
  const ttq = getOrCreateTikTokQueue();
  const pixelCode = getTikTokPixelCode();

  ttq.grantConsent?.();
  if (!ttq._i?.[pixelCode]) {
    ttq.load?.(pixelCode);
    ttq.page?.();
  }
}

export function revokeTikTokConsent() {
  window.ttq?.revokeConsent?.();
}

export function createTikTokEventId() {
  const randomId = window.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `medula_${randomId}`;
}

async function hashEmailForTikTok(email: string) {
  if (!window.crypto?.subtle) return undefined;

  const hash = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function trackTikTokCompleteRegistration(eventId: string, email: string) {
  const emailHash = await hashEmailForTikTok(email).catch(() => undefined);
  if (emailHash) window.ttq?.identify?.({ email: emailHash });

  window.ttq?.track?.(
    "CompleteRegistration",
    {
      contents: [
        {
          content_id: "medula_waitlist",
          content_type: "product",
          content_name: "Medula App Waitlist",
        },
      ],
    },
    { event_id: eventId },
  );
}
