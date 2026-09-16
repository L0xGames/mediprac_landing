import { PostHog } from "posthog-node";

type PostHogProperties = Record<string, boolean | number | string | undefined>;

type CaptureServerEventOptions = {
  distinctId: string;
  event: string;
  properties?: PostHogProperties;
};

const posthogHost = process.env.POSTHOG_HOST || "https://eu.i.posthog.com";
// PostHog project tokens are public by design: the previous browser integration
// already shipped this value. An environment variable can override it per deploy.
const posthogProjectToken = process.env.POSTHOG_PROJECT_TOKEN || "phc_vXsxsCdYqPmkfgpe7ubtxnqGrknu5TxFqVGS2sqqdGLa";

/**
 * Sends a small, consented product-analytics event from a Route Handler.
 * Analytics must never prevent a user action such as joining the waitlist.
 */
export async function captureServerEvent({ distinctId, event, properties = {} }: CaptureServerEventOptions) {
  const posthog = new PostHog(posthogProjectToken, {
    host: posthogHost,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 2_500,
  });

  try {
    posthog.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        $process_person_profile: false,
      },
    });
    await posthog.shutdown();
    return true;
  } catch {
    return false;
  }
}
