import { NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/posthog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_NAMES = new Set([
  "analytics_consent_granted",
  "quiz_landing_viewed",
  "quiz_started",
  "study_phase_selected",
  "subject_selected",
  "question_viewed",
  "answer_submitted",
  "result_viewed",
  "waitlist_form_viewed",
  "waitlist_submit_started",
  "waitlist_submit_failed",
  "waitlist_referral_link_copied",
  "waitlist_referral_share_started",
  "waitlist_referral_shared",
]);

const PROPERTY_NAMES = new Set([
  "quiz_version",
  "landing_path",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "phase",
  "subject",
  "question_number",
  "is_correct",
  "score",
  "placement",
  "referred",
]);

const DISTINCT_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const MAX_PROPERTY_LENGTH = 120;

type AnalyticsRequestBody = {
  distinctId?: unknown;
  event?: unknown;
  properties?: unknown;
};

function sanitizeProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, property]) => {
        return PROPERTY_NAMES.has(key) && (typeof property === "boolean" || typeof property === "number" || typeof property === "string");
      })
      .map(([key, property]) => [key, typeof property === "string" ? property.trim().slice(0, MAX_PROPERTY_LENGTH) : property]),
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as AnalyticsRequestBody;
  const event = typeof body.event === "string" ? body.event : "";
  const distinctId = typeof body.distinctId === "string" ? body.distinctId : "";

  if (!EVENT_NAMES.has(event) || !DISTINCT_ID_PATTERN.test(distinctId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  await captureServerEvent({
    distinctId,
    event,
    properties: sanitizeProperties(body.properties),
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
