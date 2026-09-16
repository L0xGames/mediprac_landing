import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const REMOTE_REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REMOTE_REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VISIT_KEY_PREFIX = "medula_quiz:visit:";
const MAX_VISITS_TO_LIST = 200;
// Keep a lightweight list of visit IDs. The production store already uses Redis
// lists for the waitlist; using the same primitive makes the visit overview work
// consistently there as well.
const VISIT_INDEX_KEY = "medula_quiz:visit-index";
const MAX_INDEX_ENTRIES = MAX_VISITS_TO_LIST * 16;
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "medula-quiz-visits")
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
const DATA_PATH = path.join(DATA_DIR, "quiz-visits.json");
const VISIT_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;

const VALID_PHASES = new Set(["Vorklinik", "Physikum", "Klinik", "M2 / M3", "Neugierig"]);
const VALID_SUBJECTS = new Set(["Anatomie", "Physiologie", "Biochemie", "Pharmakologie", "Klinische Fälle"]);

export const quizVisitEvents = [
  "page_viewed",
  "necessary_selected",
  "analytics_selected",
  "quiz_started",
  "phase_selected",
  "subject_selected",
  "question_1_answered",
  "question_2_answered",
  "question_3_answered",
  "result_viewed",
  "email_started",
  "email_submitted",
] as const;

export type QuizVisitEvent = (typeof quizVisitEvents)[number];

export type QuizVisitMetadata = {
  ip?: string;
  userAgent?: string;
  browser?: string;
  browserVersion?: string;
  operatingSystem?: string;
  deviceType?: string;
  country?: string;
  countryRegion?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  acceptLanguage?: string;
  browserHints?: string;
  pageUrl?: string;
  pagePath?: string;
  pageSearch?: string;
  referrer?: string;
  language?: string;
  languages?: string;
  timeZone?: string;
  platform?: string;
  vendor?: string;
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  devicePixelRatio?: number;
  colorDepth?: number;
  pixelDepth?: number;
  screenOrientation?: string;
  touchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: string;
  cookiesEnabled?: boolean;
  doNotTrack?: string;
  globalPrivacyControl?: boolean;
  webdriver?: boolean;
};

export type QuizVisit = {
  id: string;
  createdAt: string;
  lastEventAt: string;
  pageViewedAt: string;
  necessarySelectedAt?: string;
  analyticsSelectedAt?: string;
  quizStartedAt?: string;
  phaseSelectedAt?: string;
  subjectSelectedAt?: string;
  question1AnsweredAt?: string;
  question2AnsweredAt?: string;
  question3AnsweredAt?: string;
  resultViewedAt?: string;
  emailStartedAt?: string;
  emailSubmittedAt?: string;
  consentChoice?: "necessary" | "analytics";
  phase?: string;
  subject?: string;
  score?: number;
  metadata?: QuizVisitMetadata;
};

type QuizVisitUpdate = {
  visitId: string;
  event: QuizVisitEvent;
  phase?: string;
  subject?: string;
  score?: number;
  metadata?: QuizVisitMetadata;
};

type TimestampVisitField = "pageViewedAt" | "necessarySelectedAt" | "analyticsSelectedAt" | "quizStartedAt" | "phaseSelectedAt" | "subjectSelectedAt" | "question1AnsweredAt" | "question2AnsweredAt" | "question3AnsweredAt" | "resultViewedAt" | "emailStartedAt" | "emailSubmittedAt";

const eventFields: Record<QuizVisitEvent, TimestampVisitField> = {
  page_viewed: "pageViewedAt",
  necessary_selected: "necessarySelectedAt",
  analytics_selected: "analyticsSelectedAt",
  quiz_started: "quizStartedAt",
  phase_selected: "phaseSelectedAt",
  subject_selected: "subjectSelectedAt",
  question_1_answered: "question1AnsweredAt",
  question_2_answered: "question2AnsweredAt",
  question_3_answered: "question3AnsweredAt",
  result_viewed: "resultViewedAt",
  email_started: "emailStartedAt",
  email_submitted: "emailSubmittedAt",
};

function hasRemoteStore() {
  return Boolean(REMOTE_REDIS_URL && REMOTE_REDIS_TOKEN);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) || undefined : undefined;
}

function optionalNumber(value: unknown, maximumValue: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximumValue ? value : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeQuizVisitMetadata(value: unknown): QuizVisitMetadata | undefined {
  if (!isRecord(value)) return undefined;

  const metadata: QuizVisitMetadata = {
    ip: optionalString(value.ip, 120),
    userAgent: optionalString(value.userAgent, 2_000),
    browser: optionalString(value.browser, 120),
    browserVersion: optionalString(value.browserVersion, 120),
    operatingSystem: optionalString(value.operatingSystem, 120),
    deviceType: optionalString(value.deviceType, 32),
    country: optionalString(value.country, 80),
    countryRegion: optionalString(value.countryRegion, 120),
    city: optionalString(value.city, 160),
    latitude: optionalString(value.latitude, 80),
    longitude: optionalString(value.longitude, 80),
    acceptLanguage: optionalString(value.acceptLanguage, 500),
    browserHints: optionalString(value.browserHints, 2_000),
    pageUrl: optionalString(value.pageUrl, 2_000),
    pagePath: optionalString(value.pagePath, 500),
    pageSearch: optionalString(value.pageSearch, 2_000),
    referrer: optionalString(value.referrer, 2_000),
    language: optionalString(value.language, 80),
    languages: optionalString(value.languages, 500),
    timeZone: optionalString(value.timeZone, 120),
    platform: optionalString(value.platform, 120),
    vendor: optionalString(value.vendor, 120),
    screenWidth: optionalNumber(value.screenWidth, 20_000),
    screenHeight: optionalNumber(value.screenHeight, 20_000),
    viewportWidth: optionalNumber(value.viewportWidth, 20_000),
    viewportHeight: optionalNumber(value.viewportHeight, 20_000),
    devicePixelRatio: optionalNumber(value.devicePixelRatio, 100),
    colorDepth: optionalNumber(value.colorDepth, 128),
    pixelDepth: optionalNumber(value.pixelDepth, 128),
    screenOrientation: optionalString(value.screenOrientation, 120),
    touchPoints: optionalNumber(value.touchPoints, 100),
    hardwareConcurrency: optionalNumber(value.hardwareConcurrency, 1_024),
    deviceMemory: optionalNumber(value.deviceMemory, 1_024),
    connection: optionalString(value.connection, 500),
    cookiesEnabled: optionalBoolean(value.cookiesEnabled),
    doNotTrack: optionalString(value.doNotTrack, 32),
    globalPrivacyControl: optionalBoolean(value.globalPrivacyControl),
    webdriver: optionalBoolean(value.webdriver),
  };

  return Object.values(metadata).some((entry) => entry !== undefined) ? metadata : undefined;
}

function parseStoredQuizVisitMetadata(value: unknown) {
  if (typeof value !== "string") return normalizeQuizVisitMetadata(value);

  try {
    return normalizeQuizVisitMetadata(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;

  // Some Redis REST clients serialize HGETALL as alternating field/value pairs.
  // Accept both response shapes so stored visits remain visible across providers.
  if (Array.isArray(value) && value.length % 2 === 0) {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < value.length; index += 2) {
      const key = value[index];
      if (typeof key !== "string") return null;
      record[key] = value[index + 1];
    }
    return record;
  }

  return null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function toOptionalTimestamp(value: unknown) {
  return isTimestamp(value) ? value : undefined;
}

function isValidVisitId(value: unknown): value is string {
  return typeof value === "string" && VISIT_ID_PATTERN.test(value);
}

export function isQuizVisitEvent(value: unknown): value is QuizVisitEvent {
  return typeof value === "string" && quizVisitEvents.includes(value as QuizVisitEvent);
}

function normalizeQuizVisit(value: unknown): QuizVisit | null {
  const record = toRecord(value);
  if (!record || !isValidVisitId(record.id) || !isTimestamp(record.createdAt)) {
    return null;
  }

  const pageViewedAt = toOptionalTimestamp(record.pageViewedAt) || record.createdAt;
  const score = typeof record.score === "string" ? Number(record.score) : record.score;
  const metadata = parseStoredQuizVisitMetadata(record.metadata);

  return {
    id: record.id,
    createdAt: record.createdAt,
    lastEventAt: toOptionalTimestamp(record.lastEventAt) || record.createdAt,
    pageViewedAt,
    necessarySelectedAt: toOptionalTimestamp(record.necessarySelectedAt),
    analyticsSelectedAt: toOptionalTimestamp(record.analyticsSelectedAt),
    quizStartedAt: toOptionalTimestamp(record.quizStartedAt),
    phaseSelectedAt: toOptionalTimestamp(record.phaseSelectedAt),
    subjectSelectedAt: toOptionalTimestamp(record.subjectSelectedAt),
    question1AnsweredAt: toOptionalTimestamp(record.question1AnsweredAt),
    question2AnsweredAt: toOptionalTimestamp(record.question2AnsweredAt),
    question3AnsweredAt: toOptionalTimestamp(record.question3AnsweredAt),
    resultViewedAt: toOptionalTimestamp(record.resultViewedAt),
    emailStartedAt: toOptionalTimestamp(record.emailStartedAt),
    emailSubmittedAt: toOptionalTimestamp(record.emailSubmittedAt),
    consentChoice: record.consentChoice === "necessary" || record.consentChoice === "analytics" ? record.consentChoice : undefined,
    phase: typeof record.phase === "string" && VALID_PHASES.has(record.phase) ? record.phase : undefined,
    subject: typeof record.subject === "string" && VALID_SUBJECTS.has(record.subject) ? record.subject : undefined,
    score: typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 3 ? score : undefined,
    metadata,
  };
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
    throw new Error(payload?.error || "Quiz visit storage request failed.");
  }

  return payload?.result as T;
}

async function readLocalVisits(): Promise<Record<string, QuizVisit>> {
  const content = await readFile(DATA_PATH, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return {} as Record<string, QuizVisit>;

    const visits: Record<string, QuizVisit> = {};
    for (const [id, visit] of Object.entries(parsed)) {
      const normalized = normalizeQuizVisit(visit);
      if (normalized) visits[id] = normalized;
    }
    return visits;
  } catch {
    return {} as Record<string, QuizVisit>;
  }
}

async function writeLocalVisits(visits: Record<string, QuizVisit>) {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(visits, null, 2), "utf8");
}

function toVisitUpdate(value: unknown): QuizVisitUpdate | null {
  if (!isRecord(value) || !isValidVisitId(value.visitId) || !isQuizVisitEvent(value.event)) {
    return null;
  }

  return {
    visitId: value.visitId,
    event: value.event,
    phase: typeof value.phase === "string" && VALID_PHASES.has(value.phase) ? value.phase : undefined,
    subject: typeof value.subject === "string" && VALID_SUBJECTS.has(value.subject) ? value.subject : undefined,
    score: typeof value.score === "number" && Number.isInteger(value.score) && value.score >= 0 && value.score <= 3 ? value.score : undefined,
    metadata: normalizeQuizVisitMetadata(value.metadata),
  };
}

export function parseQuizVisitUpdate(value: unknown) {
  return toVisitUpdate(value);
}

function applyVisitUpdate(existing: QuizVisit | undefined, update: QuizVisitUpdate, now: string): QuizVisit {
  const eventField = eventFields[update.event];
  const visit: QuizVisit = existing || {
    id: update.visitId,
    createdAt: now,
    lastEventAt: now,
    pageViewedAt: now,
  };

  return {
    ...visit,
    [eventField]: visit[eventField] || now,
    lastEventAt: now,
    ...(update.event === "necessary_selected" ? { consentChoice: "necessary" as const } : {}),
    ...(update.event === "analytics_selected" ? { consentChoice: "analytics" as const } : {}),
    ...(update.phase ? { phase: update.phase } : {}),
    ...(update.subject ? { subject: update.subject } : {}),
    ...(update.score !== undefined ? { score: update.score } : {}),
    ...(update.metadata ? { metadata: update.metadata } : {}),
  };
}

export async function recordQuizVisit(update: QuizVisitUpdate) {
  const now = new Date().toISOString();

  if (hasRemoteStore()) {
    const key = `${VISIT_KEY_PREFIX}${update.visitId}`;
    const eventField = eventFields[update.event];
    const values: string[] = ["lastEventAt", now];

    if (update.event === "necessary_selected") values.push("consentChoice", "necessary");
    if (update.event === "analytics_selected") values.push("consentChoice", "analytics");
    if (update.phase) values.push("phase", update.phase);
    if (update.subject) values.push("subject", update.subject);
    if (update.score !== undefined) values.push("score", String(update.score));
    if (update.metadata) values.push("metadata", JSON.stringify(update.metadata));

    await Promise.all([
      runRedisCommand(["HSETNX", key, "id", update.visitId]),
      runRedisCommand(["HSETNX", key, "createdAt", now]),
      runRedisCommand(["HSETNX", key, "pageViewedAt", now]),
      runRedisCommand(["HSETNX", key, eventField, now]),
      runRedisCommand(["HSET", key, ...values]),
      runRedisCommand(["LPUSH", VISIT_INDEX_KEY, update.visitId]),
      runRedisCommand(["LTRIM", VISIT_INDEX_KEY, 0, MAX_INDEX_ENTRIES - 1]),
    ]);
    return;
  }

  if (process.env.VERCEL) {
    throw new Error("Quiz visit storage is not configured.");
  }

  const visits = await readLocalVisits();
  visits[update.visitId] = applyVisitUpdate(visits[update.visitId], update, now);
  await writeLocalVisits(visits);
}

export async function listQuizVisits(limit = MAX_VISITS_TO_LIST) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), MAX_VISITS_TO_LIST));

  if (hasRemoteStore()) {
    const indexedIds = await runRedisCommand<string[]>(["LRANGE", VISIT_INDEX_KEY, 0, MAX_INDEX_ENTRIES - 1]);
    const ids = Array.from(new Set((indexedIds || []).filter(isValidVisitId))).slice(0, safeLimit);
    const visits = await Promise.all(
      ids.map(async (id) => {
        const visit = await runRedisCommand<Record<string, unknown>>(["HGETALL", `${VISIT_KEY_PREFIX}${id}`]);
        return normalizeQuizVisit(visit);
      }),
    );

    return visits.filter((visit): visit is QuizVisit => Boolean(visit));
  }

  if (process.env.VERCEL) return [];

  const visits = await readLocalVisits();
  return Object.values(visits)
    .sort((left, right) => right.lastEventAt.localeCompare(left.lastEventAt))
    .slice(0, safeLimit);
}
