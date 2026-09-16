This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## TikTok Pixel and Events API

The landing page uses TikTok Pixel code `DAKTULRC77UDHLL43EMG`. It loads only after a visitor accepts marketing measurement. A new waitlist signup then sends the `CompleteRegistration` event through both the browser Pixel and TikTok's Events API with the same event ID, so TikTok can deduplicate it.

To enable the server-side Events API, add the following environment variable to your local environment and production deployment:

```bash
TIKTOK_EVENTS_API_ACCESS_TOKEN=your_tiktok_events_api_access_token
```

Generate this token in TikTok Events Manager under the Pixel's settings. Do not expose it in browser code. Optionally set `TIKTOK_TEST_EVENT_CODE` while verifying server events in TikTok Events Manager, then remove it to send live events. `TIKTOK_PIXEL_CODE` can override the built-in Pixel code on the server and `NEXT_PUBLIC_TIKTOK_PIXEL_CODE` can override it in both browser and server builds.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Production environment variables

- `POSTHOG_PROJECT_TOKEN` (optional) — overrides the PostHog EU project token used by the server-side quiz analytics.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or matching Upstash variables) — persistent waitlist storage on Vercel.

## Quiz visit records

Every landing-page view creates a separate quiz-visit record in the same KV store. The record is updated as the visitor starts the quiz, selects a learning phase and subject, answers each question, reaches the result, begins the email field, and submits the waitlist form. It also keeps request and device context for that individual visit: IP address, Vercel IP-based location headers when present, user agent, parsed browser/OS/device type, browser client hints, language and timezone, referrer and URL, screen/viewport/display values, hardware/touch data, connection details, and browser privacy signals. The email address itself remains in the separate waitlist entry.

Open `/api/waitlist` to view the latest records in the **Quiz-Verlauf** table, or use `/api/waitlist?format=quiz-visits-csv` to export them.
