import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { type NextRequest, NextResponse } from "next/server";

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

  const loadedSignups = await readSignups();
  const normalizedResult = ensureReferralFields(loadedSignups);
  const signups = normalizedResult.signups;

  if (normalizedResult.changed) {
    await writeSignups(signups);
  }

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(buildCsv(signups), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="medula-waitlist.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      total: signups.length,
      signups: signups.slice().reverse(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
