import { createHash } from "crypto";
import { appendFile, mkdir, readFile } from "fs/promises";
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
  path?: string;
  search?: string;
  referrer?: string;
  ref?: string;
};

const MAX_FIELD_LENGTH = 500;
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

async function appendSignup(signup: WaitlistSignup) {
  const logPath = getLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(signup)}\n`, "utf8");
}

async function readSignups() {
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

function buildCsv(signups: WaitlistSignup[]) {
  const headers = ["position", "email", "createdAt", "source", "ref", "referrer", "path", "search"];
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

  const signups = await readSignups();
  const existingIndex = signups.findIndex((signup) => signup.email === email);

  if (existingIndex >= 0) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      email,
      position: signups[existingIndex].position || existingIndex + 1,
      total: signups.length,
    });
  }

  const createdAt = new Date().toISOString();
  const signup: WaitlistSignup = {
    id: createSignupId(email, createdAt),
    email,
    createdAt,
    day: createdAt.slice(0, 10),
    position: signups.length + 1,
    source: sanitizeField(body.source, "landing"),
    path: sanitizeOptionalField(body.path),
    search: sanitizeOptionalField(body.search),
    referrer: sanitizeOptionalField(body.referrer) || sanitizeOptionalField(request.headers.get("referer")),
    ref: sanitizeOptionalField(body.ref),
  };

  await appendSignup(signup);

  return NextResponse.json({
    ok: true,
    duplicate: false,
    email,
    position: signup.position,
    total: signups.length + 1,
  });
}

export async function GET(request: NextRequest) {
  const signups = await readSignups();

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
