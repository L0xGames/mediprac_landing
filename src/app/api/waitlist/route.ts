import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { after, type NextRequest, NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/posthog";
import { listQuizVisits, type QuizVisit } from "@/lib/quiz-visits";
import { captureTikTokCompleteRegistration } from "@/lib/tiktok-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaitlistRequestBody = {
  email?: unknown;
  source?: unknown;
  path?: unknown;
  search?: unknown;
  referrer?: unknown;
  ref?: unknown;
  website?: unknown;
  phase?: unknown;
  subject?: unknown;
  score?: unknown;
  analyticsDistinctId?: unknown;
  tiktokEventId?: unknown;
};

type WaitlistSignup = {
  id: string;
  email: string;
  createdAt: string;
  day: string;
  position: number;
  source: string;
  referralCode: string;
  referredBy?: string;
  referralCount: number;
  rewardUnlocked: boolean;
  path?: string;
  search?: string;
  referrer?: string;
  ref?: string;
};

const MAX_FIELD_LENGTH = 500;
const REFERRAL_GOAL = 3;
const REMOTE_REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REMOTE_REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const WAITLIST_LIST_KEY = "medula_waitlist:entries";
const WAITLIST_EMAIL_PREFIX = "medula_waitlist:email:";
const WAITLIST_REFERRAL_PREFIX = "medula_waitlist:referral:";
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "medula-waitlist")
  : path.join(/*turbopackIgnore: true*/ process.cwd(), ".data");
const LOG_PATH = path.join(DATA_DIR, "waitlist.jsonl");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ANALYTICS_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const TIKTOK_EVENT_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const VALID_ANALYTICS_PHASES = new Set(["Vorklinik", "Physikum", "Klinik", "M2 / M3", "Neugierig"]);
const VALID_ANALYTICS_SUBJECTS = new Set(["Anatomie", "Physiologie", "Biochemie", "Pharmakologie", "Klinische Fälle"]);

function getLogPath() {
  return LOG_PATH;
}

function sanitizeField(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().slice(0, MAX_FIELD_LENGTH) || fallback;
}

function sanitizeOptionalField(value: unknown) {
  const sanitized = sanitizeField(value);
  return sanitized || undefined;
}

function normalizeEmail(value: unknown) {
  return sanitizeField(value).toLowerCase();
}

function createSignupId(email: string, createdAt: string) {
  return createHash("sha256").update(`${email}|${createdAt}`).digest("hex").slice(0, 16);
}

function createReferralCode(email: string, createdAt: string, usedCodes: Set<string>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = createHash("sha256")
      .update(`${email}|${createdAt}|${attempt}`)
      .digest("base64url")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 8)
      .toLowerCase();

    if (code && !usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }

  const fallback = createHash("sha256")
    .update(`${email}|${createdAt}|${Date.now()}`)
    .digest("hex")
    .slice(0, 10);
  usedCodes.add(fallback);
  return fallback;
}

function createEmailKey(email: string) {
  return `${WAITLIST_EMAIL_PREFIX}${createHash("sha256").update(email).digest("hex")}`;
}

function hasRemoteStore() {
  return Boolean(REMOTE_REDIS_URL && REMOTE_REDIS_TOKEN);
}

function getAnalyticsDistinctId(value: unknown) {
  const distinctId = sanitizeField(value, "");
  return ANALYTICS_ID_PATTERN.test(distinctId) ? distinctId : undefined;
}

function getTikTokEventId(value: unknown) {
  const eventId = sanitizeField(value, "");
  return TIKTOK_EVENT_ID_PATTERN.test(eventId) ? eventId : undefined;
}

function buildTikTokPageUrl(request: NextRequest, body: WaitlistRequestBody) {
  const requestedPath = sanitizeField(body.path, "/").slice(0, 120);
  const path = requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/";
  const pageUrl = new URL(path, request.nextUrl.origin);
  const searchParameters = new URLSearchParams(sanitizeField(body.search, "").slice(0, MAX_FIELD_LENGTH));

  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ttclid"]) {
    const value = searchParameters.get(key);
    if (value) pageUrl.searchParams.set(key, value.slice(0, 120));
  }

  return pageUrl.toString();
}

function getUtmProperties(search: string | undefined) {
  const parameters = new URLSearchParams(search || "");
  return Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
      .map((key) => [key, sanitizeField(parameters.get(key), "").slice(0, 120)] as const)
      .filter(([, value]) => Boolean(value)),
  );
}

function getWaitlistAnalyticsProperties(body: WaitlistRequestBody, signup: WaitlistSignup) {
  const phase = sanitizeField(body.phase, "");
  const subject = sanitizeField(body.subject, "");
  const score = typeof body.score === "number" && Number.isInteger(body.score) && body.score >= 0 && body.score <= 3 ? body.score : undefined;

  return {
    quiz_version: "shortcheck_v1",
    landing_path: sanitizeField(body.path, "/").slice(0, 120),
    source: signup.source,
    ...(VALID_ANALYTICS_PHASES.has(phase) ? { phase } : {}),
    ...(VALID_ANALYTICS_SUBJECTS.has(subject) ? { subject } : {}),
    ...(score !== undefined ? { score } : {}),
    placement: "result_inline",
    referred: Boolean(signup.referredBy),
    ...getUtmProperties(signup.search),
  };
}

function normalizeReferralCode(value: unknown) {
  return sanitizeField(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 32);
}

async function runRedisCommand<T>(command: unknown[]) {
  const response = await fetch(REMOTE_REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REMOTE_REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as { result?: T; error?: string } | null;

  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || "Waitlist storage request failed.");
  }

  return payload?.result as T;
}

async function parseRequestBody(request: NextRequest): Promise<WaitlistRequestBody> {
  const text = await request.text().catch(() => "");
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as WaitlistRequestBody;
  } catch {
    return {};
  }
}

async function writeSignups(signups: WaitlistSignup[]) {
  if (hasRemoteStore()) {
    await runRedisCommand(["DEL", WAITLIST_LIST_KEY]);

    for (const signup of signups) {
      await runRedisCommand(["SET", createEmailKey(signup.email), JSON.stringify(signup)]);
      await runRedisCommand(["SET", `${WAITLIST_REFERRAL_PREFIX}${signup.referralCode}`, signup.email]);
    }

    if (signups.length > 0) {
      await runRedisCommand(["RPUSH", WAITLIST_LIST_KEY, ...signups.map((signup) => JSON.stringify(signup))]);
    }

    return;
  }

  const logPath = getLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, signups.map((signup) => JSON.stringify(signup)).join("\n") + "\n", "utf8");
}

async function readSignups() {
  if (hasRemoteStore()) {
    const rows = await runRedisCommand<string[]>(["LRANGE", WAITLIST_LIST_KEY, 0, -1]);
    return (rows || [])
      .map((line) => {
        try {
          return JSON.parse(line) as WaitlistSignup;
        } catch {
          return null;
        }
      })
      .filter((signup): signup is WaitlistSignup => Boolean(signup));
  }

  const content = await readFile(getLogPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as WaitlistSignup;
      } catch {
        return null;
      }
    })
    .filter((signup): signup is WaitlistSignup => Boolean(signup));
}

function ensureReferralFields(signups: WaitlistSignup[]) {
  let changed = false;
  const usedCodes = new Set(
    signups
      .map((signup) => normalizeReferralCode(signup.referralCode))
      .filter(Boolean),
  );

  const normalized = signups.map((signup, index) => {
    const existingCode = normalizeReferralCode(signup.referralCode);
    const referralCode = existingCode || createReferralCode(signup.email, signup.createdAt, usedCodes);

    const nextSignup: WaitlistSignup = {
      ...signup,
      position: signup.position || index + 1,
      referralCode,
      referredBy: normalizeReferralCode(signup.referredBy || signup.ref),
      referralCount: Number.isFinite(signup.referralCount) ? signup.referralCount : 0,
      rewardUnlocked: Boolean(signup.rewardUnlocked || signup.referralCount >= REFERRAL_GOAL),
    };

    if (
      nextSignup.position !== signup.position ||
      nextSignup.referralCode !== signup.referralCode ||
      nextSignup.referredBy !== signup.referredBy ||
      nextSignup.referralCount !== signup.referralCount ||
      nextSignup.rewardUnlocked !== signup.rewardUnlocked
    ) {
      changed = true;
    }

    return nextSignup;
  });

  return { signups: normalized, changed };
}

function buildReferralLink(request: NextRequest, referralCode: string) {
  return `${request.nextUrl.origin}/?ref=${encodeURIComponent(referralCode)}`;
}

function buildCsv(signups: WaitlistSignup[]) {
  const headers = [
    "position",
    "email",
    "createdAt",
    "referralCode",
    "referralCount",
    "rewardUnlocked",
    "referredBy",
    "source",
    "ref",
    "referrer",
    "path",
    "search",
  ];
  const rows = signups.map((signup) =>
    headers
      .map((header) => {
        const value = String(signup[header as keyof WaitlistSignup] ?? "");
        return `"${value.replace(/"/g, '""')}"`;
      })
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function buildQuizVisitsCsv(visits: QuizVisit[]) {
  const headers: (keyof QuizVisit)[] = [
    "id",
    "pageViewedAt",
    "necessarySelectedAt",
    "analyticsSelectedAt",
    "quizStartedAt",
    "phase",
    "phaseSelectedAt",
    "subject",
    "subjectSelectedAt",
    "question1AnsweredAt",
    "question2AnsweredAt",
    "question3AnsweredAt",
    "resultViewedAt",
    "score",
    "emailStartedAt",
    "emailSubmittedAt",
    "lastEventAt",
  ];
  const rows = visits.map((visit) =>
    headers
      .map((header) => `"${String(visit[header] ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function buildWaitlistHtml(signups: WaitlistSignup[], quizVisits: QuizVisit[], request: NextRequest) {
  const total = signups.length;
  const today = new Date().toISOString().slice(0, 10);
  const signupsToday = signups.filter((signup) => signup.day === today).length;
  const rewardsUnlocked = signups.filter((signup) => signup.rewardUnlocked).length;
  const referralInvites = signups.reduce((sum, signup) => sum + (signup.referralCount || 0), 0);
  const latestSignups = signups.slice().reverse();
  const csvUrl = new URL(request.nextUrl);
  csvUrl.searchParams.set("format", "csv");
  const quizVisitsCsvUrl = new URL(request.nextUrl);
  quizVisitsCsvUrl.searchParams.set("format", "quiz-visits-csv");

  const rows = latestSignups
    .map(
      (signup) => `
        <tr>
          <td class="rank">#${escapeHtml(signup.position)}</td>
          <td>
            <span class="email">${escapeHtml(signup.email)}</span>
            ${
              signup.rewardUnlocked
                ? '<span class="status success">Lifetime freigeschaltet</span>'
                : '<span class="status">Warteliste</span>'
            }
          </td>
          <td>${escapeHtml(formatDateTime(signup.createdAt))}</td>
          <td>${escapeHtml(signup.referralCode)}</td>
          <td>${escapeHtml(signup.referralCount)}</td>
          <td>${escapeHtml(signup.referredBy || "-")}</td>
        </tr>`,
    )
    .join("");

  const quizVisitRows = quizVisits
    .map(
      (visit) => `
        <tr>
          <td class="session-id">${escapeHtml(visit.id)}</td>
          <td>${escapeHtml(formatDateTime(visit.pageViewedAt))}</td>
          <td>${escapeHtml(visit.consentChoice === "necessary" ? "Nur notwendige" : visit.consentChoice === "analytics" ? "Zustimmung" : "-")}</td>
          <td>${escapeHtml(formatDateTime(visit.quizStartedAt || ""))}</td>
          <td>${escapeHtml(visit.phase || "-")}</td>
          <td>${escapeHtml(visit.subject || "-")}</td>
          <td>${escapeHtml(formatDateTime(visit.question1AnsweredAt || ""))}</td>
          <td>${escapeHtml(formatDateTime(visit.question2AnsweredAt || ""))}</td>
          <td>${escapeHtml(formatDateTime(visit.question3AnsweredAt || ""))}</td>
          <td>${escapeHtml(formatDateTime(visit.resultViewedAt || ""))}</td>
          <td>${escapeHtml(visit.score ?? "-")}</td>
          <td>${escapeHtml(formatDateTime(visit.emailStartedAt || ""))}</td>
          <td>${escapeHtml(formatDateTime(visit.emailSubmittedAt || ""))}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Medula Warteliste</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --ink: #172026;
        --muted: #65727f;
        --line: #dde5ec;
        --surface: #ffffff;
        --brand: #117c7c;
        --brand-dark: #075e60;
        --soft: #eaf7f5;
        --shadow: 0 18px 55px rgba(24, 44, 58, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 12% 12%, rgba(17, 124, 124, 0.15), transparent 30%),
          linear-gradient(135deg, #f9fbfc 0%, var(--bg) 46%, #eef3f7 100%);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 32px 0;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 28px;
        align-items: stretch;
        margin-bottom: 24px;
      }

      .headline,
      .counter,
      .panel,
      .table-shell {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(221, 229, 236, 0.95);
        box-shadow: var(--shadow);
      }

      .headline {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-height: 280px;
        padding: 30px;
        border-radius: 22px;
      }

      .eyebrow {
        margin: 0 0 18px;
        color: var(--brand-dark);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        max-width: 760px;
        margin: 0;
        font-size: clamp(38px, 7vw, 86px);
        line-height: 0.95;
        letter-spacing: 0;
      }

      .subline {
        max-width: 690px;
        margin: 24px 0 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.55;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 28px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--ink);
        font-weight: 800;
        text-decoration: none;
        background: var(--surface);
      }

      .button.primary {
        border-color: var(--brand);
        color: #ffffff;
        background: var(--brand);
      }

      .counter {
        display: grid;
        min-width: min(380px, 100%);
        padding: 30px;
        border-radius: 22px;
        background: linear-gradient(160deg, #ffffff 0%, #effaf8 100%);
      }

      .counter-label {
        color: var(--muted);
        font-size: 15px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .counter-number {
        margin: auto 0;
        color: var(--brand-dark);
        font-size: clamp(86px, 14vw, 172px);
        font-weight: 900;
        line-height: 0.88;
        letter-spacing: 0;
      }

      .counter-note {
        color: var(--muted);
        font-size: 16px;
        line-height: 1.45;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }

      .panel {
        padding: 22px;
        border-radius: 16px;
      }

      .panel span {
        display: block;
        color: var(--muted);
        font-size: 13px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .panel strong {
        display: block;
        margin-top: 10px;
        font-size: 38px;
        line-height: 1;
      }

      .table-shell {
        overflow: hidden;
        border-radius: 18px;
      }

      .table-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 22px 24px;
        border-bottom: 1px solid var(--line);
      }

      .table-title {
        margin: 0;
        font-size: 22px;
      }

      .table-meta {
        margin: 6px 0 0;
        color: var(--muted);
      }

      .table-wrap {
        max-height: 68vh;
        overflow: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      th,
      td {
        padding: 15px 18px;
        text-align: left;
        border-bottom: 1px solid #edf1f4;
        white-space: nowrap;
      }

      th {
        position: sticky;
        top: 0;
        z-index: 1;
        color: var(--muted);
        background: #fbfcfd;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }

      tr:hover td {
        background: var(--soft);
      }

      .rank {
        color: var(--brand-dark);
        font-weight: 900;
      }

      .email {
        display: block;
        color: var(--ink);
        font-weight: 800;
      }

      .session-id {
        max-width: 150px;
        overflow: hidden;
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        text-overflow: ellipsis;
      }

      .status {
        display: inline-flex;
        margin-top: 6px;
        padding: 4px 9px;
        border-radius: 999px;
        color: var(--brand-dark);
        background: var(--soft);
        font-size: 12px;
        font-weight: 800;
      }

      .status.success {
        color: #8f2e25;
        background: #fff0ec;
      }

      .empty {
        padding: 56px 24px;
        color: var(--muted);
        text-align: center;
      }

      @media (max-width: 860px) {
        main {
          width: min(100% - 20px, 1180px);
          padding: 10px 0 20px;
        }

        .hero,
        .stats {
          grid-template-columns: 1fr;
        }

        .headline,
        .counter {
          min-height: auto;
          padding: 22px;
          border-radius: 18px;
        }

        .counter-number {
          margin: 22px 0;
        }

        .table-head {
          align-items: flex-start;
          flex-direction: column;
        }

        th,
        td {
          padding: 13px 14px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero" aria-labelledby="title">
        <div class="headline">
          <div>
            <p class="eyebrow">Medula Warteliste</p>
            <h1 id="title">Aktuelle Signups auf einen Blick.</h1>
            <p class="subline">Live aus der Produktionsdatenbank. Die CSV-Version bleibt unverändert für Export und Weiterverarbeitung.</p>
          </div>
          <div class="actions">
            <a class="button primary" href="${escapeHtml(csvUrl.toString())}">CSV herunterladen</a>
            <a class="button" href="/">Landing Page öffnen</a>
          </div>
        </div>
        <aside class="counter" aria-label="Gesamtzahl der Warteliste">
          <span class="counter-label">Warteliste gesamt</span>
          <strong class="counter-number">${escapeHtml(total.toLocaleString("de-DE"))}</strong>
          <span class="counter-note">Personen haben sich aktuell für Early Access eingetragen.</span>
        </aside>
      </section>

      <section class="stats" aria-label="Kennzahlen">
        <div class="panel">
          <span>Heute neu</span>
          <strong>${escapeHtml(signupsToday.toLocaleString("de-DE"))}</strong>
        </div>
        <div class="panel">
          <span>Referral Einladungen</span>
          <strong>${escapeHtml(referralInvites.toLocaleString("de-DE"))}</strong>
        </div>
        <div class="panel">
          <span>Lifetime freigeschaltet</span>
          <strong>${escapeHtml(rewardsUnlocked.toLocaleString("de-DE"))}</strong>
        </div>
      </section>

      <section class="table-shell" aria-labelledby="entries-title">
        <div class="table-head">
          <div>
            <h2 class="table-title" id="entries-title">Einträge</h2>
            <p class="table-meta">Neueste Signups zuerst</p>
          </div>
          <a class="button" href="${escapeHtml(csvUrl.toString())}">CSV</a>
        </div>
        ${
          rows
            ? `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Platz</th>
                      <th>E-Mail</th>
                      <th>Zeitpunkt</th>
                      <th>Referral Code</th>
                      <th>Refs</th>
                      <th>Eingeladen durch</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>`
            : '<div class="empty">Noch keine Wartelisten-Einträge vorhanden.</div>'
        }
      </section>

      <section class="table-shell" aria-labelledby="quiz-visits-title" style="margin-top: 24px">
        <div class="table-head">
          <div>
            <h2 class="table-title" id="quiz-visits-title">Quiz-Verlauf</h2>
            <p class="table-meta">Jeder Seitenaufruf erhält eine eigene Zeile. Die E-Mail selbst bleibt ausschließlich im Wartelisten-Eintrag.</p>
          </div>
          <a class="button" href="${escapeHtml(quizVisitsCsvUrl.toString())}">Quiz CSV</a>
        </div>
        ${
          quizVisitRows
            ? `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Seitenaufruf</th>
                      <th>Datenschutzwahl</th>
                      <th>Quiz gestartet</th>
                      <th>Lernphase</th>
                      <th>Fach</th>
                      <th>Frage 1</th>
                      <th>Frage 2</th>
                      <th>Frage 3</th>
                      <th>Ergebnis</th>
                      <th>Score</th>
                      <th>E-Mail begonnen</th>
                      <th>E-Mail gesendet</th>
                    </tr>
                  </thead>
                  <tbody>${quizVisitRows}</tbody>
                </table>
              </div>`
            : '<div class="empty">Noch keine Quiz-Seitenaufrufe vorhanden.</div>'
        }
      </section>
    </main>
  </body>
</html>`;
}

export async function POST(request: NextRequest) {
  const body = await parseRequestBody(request);

  if (sanitizeField(body.website)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const email = normalizeEmail(body.email);
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ message: "Bitte gib eine gültige E-Mail-Adresse ein." }, { status: 400 });
  }

  if (process.env.VERCEL && !hasRemoteStore()) {
    return NextResponse.json(
      { message: "Waitlist storage is not configured yet." },
      { status: 503 },
    );
  }

  const loadedSignups = await readSignups();
  const normalizedResult = ensureReferralFields(loadedSignups);
  const signups = normalizedResult.signups;

  if (normalizedResult.changed) {
    await writeSignups(signups);
  }

  const existingIndex = signups.findIndex((signup) => signup.email === email);

  if (existingIndex >= 0) {
    const existingSignup = signups[existingIndex];

    return NextResponse.json({
      ok: true,
      duplicate: true,
      email,
      position: existingSignup.position || existingIndex + 1,
      referralCode: existingSignup.referralCode,
      referralLink: buildReferralLink(request, existingSignup.referralCode),
      referralCount: existingSignup.referralCount,
      referralGoal: REFERRAL_GOAL,
      rewardUnlocked: existingSignup.rewardUnlocked,
      total: signups.length,
    });
  }

  const createdAt = new Date().toISOString();
  const referralCode = createReferralCode(
    email,
    createdAt,
    new Set(signups.map((signup) => signup.referralCode).filter(Boolean)),
  );
  const requestedRef = normalizeReferralCode(body.ref);
  const referrerIndex = requestedRef
    ? signups.findIndex((signup) => signup.referralCode === requestedRef && signup.email !== email)
    : -1;
  const referredBy = referrerIndex >= 0 ? requestedRef : undefined;

  const signup: WaitlistSignup = {
    id: createSignupId(email, createdAt),
    email,
    createdAt,
    day: createdAt.slice(0, 10),
    position: signups.length + 1,
    source: sanitizeField(body.source, "landing"),
    referralCode,
    referredBy,
    referralCount: 0,
    rewardUnlocked: false,
    path: sanitizeOptionalField(body.path),
    search: sanitizeOptionalField(body.search),
    referrer: sanitizeOptionalField(body.referrer) || sanitizeOptionalField(request.headers.get("referer")),
    ref: requestedRef || undefined,
  };

  const updatedSignups = [...signups];

  if (referrerIndex >= 0) {
    const referrer = updatedSignups[referrerIndex];
    const referralCount = (referrer.referralCount || 0) + 1;
    updatedSignups[referrerIndex] = {
      ...referrer,
      referralCount,
      rewardUnlocked: referralCount >= REFERRAL_GOAL,
    };
  }

  updatedSignups.push(signup);
  await writeSignups(updatedSignups);

  const analyticsDistinctId = getAnalyticsDistinctId(body.analyticsDistinctId);
  if (analyticsDistinctId) {
    await captureServerEvent({
      distinctId: analyticsDistinctId,
      event: "waitlist_submitted",
      properties: getWaitlistAnalyticsProperties(body, signup),
    });
  }

  const tiktokEventId = getTikTokEventId(body.tiktokEventId);
  if (tiktokEventId) {
    const pageUrl = buildTikTokPageUrl(request, body);
    after(async () => {
      await captureTikTokCompleteRegistration({ email, eventId: tiktokEventId, pageUrl, request });
    });
  }

  return NextResponse.json({
    ok: true,
    duplicate: false,
    email,
    position: signup.position,
    referralCode: signup.referralCode,
    referralLink: buildReferralLink(request, signup.referralCode),
    referralCount: signup.referralCount,
    referralGoal: REFERRAL_GOAL,
    rewardUnlocked: signup.rewardUnlocked,
    referredBy: signup.referredBy,
    total: signups.length + 1,
  });
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL && !hasRemoteStore()) {
    return NextResponse.json(
      {
        message: "Waitlist storage is not configured yet.",
        requiredEnv: ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [loadedSignups, quizVisits] = await Promise.all([readSignups(), listQuizVisits()]);
  const normalizedResult = ensureReferralFields(loadedSignups);
  const signups = normalizedResult.signups;

  if (normalizedResult.changed) {
    await writeSignups(signups);
  }

  const format = request.nextUrl.searchParams.get("format");

  if (format === "csv") {
    return new NextResponse(buildCsv(signups), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="medula-waitlist.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "quiz-visits-csv") {
    return new NextResponse(buildQuizVisitsCsv(quizVisits), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="medula-quiz-visits.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "json") {
    return NextResponse.json(
      {
        total: signups.length,
        signups: signups.slice().reverse(),
        quizVisits,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return new NextResponse(buildWaitlistHtml(signups, quizVisits, request), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
