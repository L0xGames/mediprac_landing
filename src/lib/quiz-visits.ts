import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const REMOTE_REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REMOTE_REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VISIT_KEY_PREFIX = "medula_quiz:visit:";
const VISIT_INDEX_KEY = "medula_quiz:visits";
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "medula-quiz-visits")
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
const DATA_PATH = path.join(DATA_DIR, "quiz-visits.json");
const VISIT_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const MAX_VISITS_TO_LIST = 200;

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
};

type QuizVisitUpdate = {
  visitId: string;
  event: QuizVisitEvent;
  phase?: string;
  subject?: string;
  score?: number;
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
  if (!isRecord(value) || !isValidVisitId(value.id) || !isTimestamp(value.createdAt)) {
    return null;
  }

  const pageViewedAt = toOptionalTimestamp(value.pageViewedAt) || value.createdAt;
  const score = typeof value.score === "string" ? Number(value.score) : value.score;

  return {
    id: value.id,
    createdAt: value.createdAt,
    lastEventAt: toOptionalTimestamp(value.lastEventAt) || value.createdAt,
    pageViewedAt,
    necessarySelectedAt: toOptionalTimestamp(value.necessarySelectedAt),
    analyticsSelectedAt: toOptionalTimestamp(value.analyticsSelectedAt),
    quizStartedAt: toOptionalTimestamp(value.quizStartedAt),
    phaseSelectedAt: toOptionalTimestamp(value.phaseSelectedAt),
    subjectSelectedAt: toOptionalTimestamp(value.subjectSelectedAt),
    question1AnsweredAt: toOptionalTimestamp(value.question1AnsweredAt),
    question2AnsweredAt: toOptionalTimestamp(value.question2AnsweredAt),
    question3AnsweredAt: toOptionalTimestamp(value.question3AnsweredAt),
    resultViewedAt: toOptionalTimestamp(value.resultViewedAt),
    emailStartedAt: toOptionalTimestamp(value.emailStartedAt),
    emailSubmittedAt: toOptionalTimestamp(value.emailSubmittedAt),
    consentChoice: value.consentChoice === "necessary" || value.consentChoice === "analytics" ? value.consentChoice : undefined,
    phase: typeof value.phase === "string" && VALID_PHASES.has(value.phase) ? value.phase : undefined,
    subject: typeof value.subject === "string" && VALID_SUBJECTS.has(value.subject) ? value.subject : undefined,
    score: typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 3 ? score : undefined,
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

    await Promise.all([
      runRedisCommand(["HSETNX", key, "id", update.visitId]),
      runRedisCommand(["HSETNX", key, "createdAt", now]),
      runRedisCommand(["HSETNX", key, "pageViewedAt", now]),
      runRedisCommand(["HSETNX", key, eventField, now]),
      runRedisCommand(["HSET", key, ...values]),
      runRedisCommand(["ZADD", VISIT_INDEX_KEY, Date.now(), update.visitId]),
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
    const ids = await runRedisCommand<string[]>(["ZREVRANGE", VISIT_INDEX_KEY, 0, safeLimit - 1]);
    const visits = await Promise.all(
      (ids || []).map(async (id) => {
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
