"use client";

/* eslint-disable @next/next/no-img-element */

import Image from "next/image";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTikTokEventId,
  grantTikTokConsentAndLoadPixel,
  trackTikTokCompleteRegistration,
} from "@/lib/tiktok-browser";
import styles from "./page.module.css";

type Subject = "Anatomie" | "Physiologie" | "Biochemie" | "Pharmakologie" | "Klinische Fälle";
type Screen = "intro" | "subject" | "quiz" | "result";
type Consent = "granted" | "denied";
type Question = { question: string; options: string[]; correctIndex: number; explanation: string; topic: string };
type QuizVisitEvent = "page_viewed" | "necessary_selected" | "analytics_selected" | "quiz_started" | "phase_selected" | "subject_selected" | "question_1_answered" | "question_2_answered" | "question_3_answered" | "result_viewed" | "email_started" | "email_submitted" | "session_heartbeat" | "session_ended";
type QuizVisitProperties = { subject?: Subject; score?: number; elapsedDurationMs?: number; activeDurationMs?: number };
type QuizVisitRecordOptions = { deduplicate?: boolean; beacon?: boolean };

const questionAnsweredEvents: readonly QuizVisitEvent[] = ["question_1_answered", "question_2_answered", "question_3_answered"];
const quizQuestionCount = 1;

const logoUrl = "/assets/medula-logo-horizontal.svg";
const appPreviewUrl = "/assets/medula-dashboard.png";
const consentStorageKey = "medula_analytics_consent";
const sessionHeartbeatIntervalMs = 10_000;

const subjectOptions: { label: Subject; icon: string }[] = [
  { label: "Anatomie", icon: "◌" },
  { label: "Physiologie", icon: "⌇" },
  { label: "Biochemie", icon: "⌬" },
  { label: "Pharmakologie", icon: "▣" },
  { label: "Klinische Fälle", icon: "✚" },
];

const questionBank: Record<Subject, Question[]> = {
  Anatomie: [
    { question: "Welche Struktur verläuft durch das Foramen ovale?", options: ["A. meningea media", "N. mandibularis", "N. opticus", "V. jugularis interna"], correctIndex: 1, explanation: "Richtig ist der N. mandibularis (V3). Die A. meningea media zieht typischerweise durch das Foramen spinosum.", topic: "Schädelbasis" },
    { question: "Welcher Muskel wird vom N. facialis innerviert?", options: ["M. masseter", "M. temporalis", "M. orbicularis oculi", "M. pterygoideus lateralis"], correctIndex: 2, explanation: "Der N. facialis innerviert die mimische Muskulatur, darunter den M. orbicularis oculi.", topic: "Hirnnerven" },
    { question: "Welcher Knochen gehört zum Neurocranium?", options: ["Os zygomaticum", "Os sphenoidale", "Maxilla", "Os palatinum"], correctIndex: 1, explanation: "Das Os sphenoidale (Keilbein) gehört zum Neurocranium.", topic: "Neurocranium" },
  ],
  Physiologie: [
    { question: "Woraus ergibt sich das Herzzeitvolumen?", options: ["Blutdruck × Herzfrequenz", "Herzfrequenz × Schlagvolumen", "Schlagvolumen ÷ Herzfrequenz", "Herzfrequenz + Blutdruck"], correctIndex: 1, explanation: "Herzzeitvolumen = Herzfrequenz × Schlagvolumen.", topic: "Herz-Kreislauf" },
    { question: "Wo liegt im Kreislauf der größte Strömungswiderstand?", options: ["Aorta", "Vena cava", "Arteriolen", "Kapillaren"], correctIndex: 2, explanation: "Die Arteriolen sind die wichtigsten Widerstandsgefäße.", topic: "Gefäßregulation" },
    { question: "In welcher Phase dominiert der Ca²⁺-Einstrom im kardialen Aktionspotenzial?", options: ["Phase 0", "Phase 1", "Phase 2", "Phase 4"], correctIndex: 2, explanation: "In der Plateauphase (Phase 2) strömt Calcium über L-Typ-Calciumkanäle ein.", topic: "Kardiales Aktionspotenzial" },
  ],
  Biochemie: [
    { question: "In welchem Organ werden Ketonkörper hauptsächlich gebildet?", options: ["Gehirn", "Leber", "Skelettmuskel", "Niere"], correctIndex: 1, explanation: "Die Ketogenese findet vor allem in den Mitochondrien der Leber statt.", topic: "Energiestoffwechsel" },
    { question: "Welches Molekül ist die direkte Energiequelle für die meisten Zellprozesse?", options: ["ATP", "DNA", "Glykogen", "NAD⁺"], correctIndex: 0, explanation: "ATP ist die direkt nutzbare Energiewährung der Zelle.", topic: "ATP & Energie" },
    { question: "Welcher Weg baut Glucose zu Pyruvat ab?", options: ["Gluconeogenese", "Glykolyse", "β-Oxidation", "Harnstoffzyklus"], correctIndex: 1, explanation: "Die Glykolyse wandelt Glucose im Cytosol in Pyruvat um.", topic: "Glykolyse" },
  ],
  Pharmakologie: [
    { question: "Welche typische Nebenwirkung können ACE-Hemmer verursachen?", options: ["Trockener Husten", "Mydriasis", "Obstipation", "Hyperthyreose"], correctIndex: 0, explanation: "Ein trockener Husten kann durch erhöhte Bradykinin-Konzentration entstehen.", topic: "Herz-Kreislauf-Pharmaka" },
    { question: "Was bewirkt eine β₁-Rezeptorblockade am Herzen?", options: ["Herzfrequenz steigt", "Herzfrequenz sinkt", "Bronchien erweitern sich", "Insulinfreisetzung steigt"], correctIndex: 1, explanation: "Eine β₁-Blockade wirkt negativ chronotrop: Die Herzfrequenz sinkt.", topic: "Autonomes Nervensystem" },
    { question: "Welche Applikationsform umgeht den First-Pass-Effekt?", options: ["Oral", "Sublingual", "Rektal", "Enteral über Sonde"], correctIndex: 1, explanation: "Sublingual aufgenommene Wirkstoffe gelangen direkt in den systemischen Kreislauf.", topic: "Pharmakokinetik" },
  ],
  "Klinische Fälle": [
    { question: "Welche Untersuchung ist bei Verdacht auf akuten Schlaganfall zentral, um eine Blutung auszuschließen?", options: ["EEG", "Röntgen-Thorax", "CCT", "EKG"], correctIndex: 2, explanation: "Die kraniale Computertomografie hilft akut vor allem, eine Blutung auszuschließen.", topic: "Neurologie" },
    { question: "Welcher Laborwert wird bei Verdacht auf Myokardinfarkt besonders genutzt?", options: ["Troponin", "Bilirubin", "TSH", "HbA1c"], correctIndex: 0, explanation: "Kardiales Troponin ist ein zentraler Marker für Myokardschaden im passenden klinischen Kontext.", topic: "Kardiologie" },
    { question: "Welcher Befund passt klassisch zu einer bakteriellen Infektion?", options: ["Leukozytose mit Neutrophilie", "Isolierte Eosinopenie", "Niedriger HbA1c", "Hypokalzämie"], correctIndex: 0, explanation: "Eine Leukozytose mit Neutrophilie kann zu einer bakteriellen Infektion passen.", topic: "Innere Medizin" },
  ],
};

function readConsent(): Consent | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(consentStorageKey) || "null") as { value?: Consent; expiresAt?: number } | null;
    if (!stored?.value || !stored.expiresAt || Date.now() > stored.expiresAt) {
      window.localStorage.removeItem(consentStorageKey);
      return null;
    }
    return stored.value;
  } catch { return null; }
}

function getAcquisitionProperties() {
  if (typeof window === "undefined") return { quiz_version: "shortcheck_v1", landing_path: "/" };
  const parameters = new URLSearchParams(window.location.search);
  const properties: Record<string, string> = { quiz_version: "shortcheck_v1", landing_path: window.location.pathname };
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => {
    const value = parameters.get(key);
    if (value) properties[key] = value.slice(0, 120);
  });
  return properties;
}

function getQuizVisitMetadata() {
  const navigation = navigator as Navigator & {
    connection?: { effectiveType?: string; type?: string; downlink?: number; rtt?: number; saveData?: boolean };
    deviceMemory?: number;
    globalPrivacyControl?: boolean;
  };
  const connection = navigation.connection;
  const connectionDetails = connection
    ? [
        connection.effectiveType && `effectiveType=${connection.effectiveType}`,
        connection.type && `type=${connection.type}`,
        typeof connection.downlink === "number" && `downlinkMbps=${connection.downlink}`,
        typeof connection.rtt === "number" && `rttMs=${connection.rtt}`,
        typeof connection.saveData === "boolean" && `saveData=${connection.saveData}`,
      ]
        .filter(Boolean)
        .join("; ")
    : undefined;

  return {
    pageUrl: window.location.href,
    pagePath: window.location.pathname,
    pageSearch: window.location.search,
    referrer: document.referrer || undefined,
    language: navigation.language,
    languages: navigation.languages?.join(", "),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigation.platform,
    vendor: navigation.vendor,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    colorDepth: window.screen.colorDepth,
    pixelDepth: window.screen.pixelDepth,
    screenOrientation: window.screen.orientation?.type,
    touchPoints: navigation.maxTouchPoints,
    hardwareConcurrency: navigation.hardwareConcurrency,
    deviceMemory: navigation.deviceMemory,
    connection: connectionDetails,
    cookiesEnabled: navigation.cookieEnabled,
    doNotTrack: navigation.doNotTrack || undefined,
    globalPrivacyControl: navigation.globalPrivacyControl,
    webdriver: navigation.webdriver,
  };
}

export default function Home() {
  const analytics = useRef({ landingTracked: false, distinctId: "" });
  const quizVisit = useRef({ id: "", recordedEvents: new Set<QuizVisitEvent>() });
  const quizVisitTiming = useRef({ startedAt: 0, activeStartedAt: 0, completedActiveDurationMs: 0 });
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const acquisitionProperties = useMemo(() => getAcquisitionProperties(), []);
  const [screen, setScreen] = useState<Screen>("intro");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [position, setPosition] = useState<number | null>(null);
  const [referralLink, setReferralLink] = useState("");
  const [referralCount, setReferralCount] = useState(0);
  const [referralGoal, setReferralGoal] = useState(3);
  const [rewardUnlocked, setRewardUnlocked] = useState(false);
  const [hasCopiedReferralLink, setHasCopiedReferralLink] = useState(false);

  const getAnalyticsDistinctId = useCallback(() => {
    if (analytics.current.distinctId) return analytics.current.distinctId;
    const fallback = `quiz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    analytics.current.distinctId = window.crypto?.randomUUID?.() || fallback;
    return analytics.current.distinctId;
  }, []);

  const track = useCallback((name: string, properties: Record<string, unknown> = {}) => {
    if (readConsent() !== "granted") return;
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: name, distinctId: getAnalyticsDistinctId(), properties: { ...acquisitionProperties, ...properties } }),
      keepalive: true,
    }).catch(() => undefined);
  }, [acquisitionProperties, getAnalyticsDistinctId]);

  const getQuizVisitId = useCallback(() => {
    if (quizVisit.current.id) return quizVisit.current.id;
    const fallback = `visit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    quizVisit.current.id = window.crypto?.randomUUID?.() || fallback;
    return quizVisit.current.id;
  }, []);

  const getQuizVisitTiming = useCallback(() => {
    const now = Date.now();
    const timing = quizVisitTiming.current;
    if (!timing.startedAt) {
      timing.startedAt = now;
      timing.activeStartedAt = document.visibilityState === "visible" ? now : 0;
    }

    return {
      elapsedDurationMs: Math.max(0, now - timing.startedAt),
      activeDurationMs: Math.max(0, timing.completedActiveDurationMs + (timing.activeStartedAt ? now - timing.activeStartedAt : 0)),
    };
  }, []);

  const recordQuizVisit = useCallback((event: QuizVisitEvent, properties: QuizVisitProperties = {}, options: QuizVisitRecordOptions = {}) => {
    const deduplicate = options.deduplicate ?? true;
    if (deduplicate && quizVisit.current.recordedEvents.has(event)) return;
    if (deduplicate) quizVisit.current.recordedEvents.add(event);
    const payload = JSON.stringify({ visitId: getQuizVisitId(), event, ...getQuizVisitTiming(), ...properties, metadata: getQuizVisitMetadata() });

    if (options.beacon && navigator.sendBeacon) {
      const sent = navigator.sendBeacon("/api/quiz-visits", new Blob([payload], { type: "application/json" }));
      if (sent) return;
    }

    void fetch("/api/quiz-visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  }, [getQuizVisitId, getQuizVisitTiming]);

  const trackLanding = useCallback(() => {
    if (analytics.current.landingTracked || readConsent() !== "granted") return;
    analytics.current.landingTracked = true;
    track("quiz_landing_viewed");
  }, [track]);

  useEffect(() => {
    if (readConsent() === "granted") { grantTikTokConsentAndLoadPixel(); trackLanding(); return; }
  }, [trackLanding]);

  useEffect(() => {
    recordQuizVisit("page_viewed");
  }, [recordQuizVisit]);

  useEffect(() => {
    function stopActiveTime() {
      const timing = quizVisitTiming.current;
      if (!timing.activeStartedAt) return;
      timing.completedActiveDurationMs += Math.max(0, Date.now() - timing.activeStartedAt);
      timing.activeStartedAt = 0;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stopActiveTime();
        recordQuizVisit("session_heartbeat", getQuizVisitTiming(), { deduplicate: false, beacon: true });
        return;
      }

      const timing = quizVisitTiming.current;
      if (timing.startedAt && !timing.activeStartedAt) timing.activeStartedAt = Date.now();
    }

    function handlePageHide() {
      stopActiveTime();
      recordQuizVisit("session_ended", getQuizVisitTiming(), { beacon: true });
    }

    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        recordQuizVisit("session_heartbeat", getQuizVisitTiming(), { deduplicate: false });
      }
    }, sessionHeartbeatIntervalMs);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [getQuizVisitTiming, recordQuizVisit]);

  useEffect(() => {
    if (screen === "quiz" && subject) track("question_viewed", { subject, question_number: questionIndex + 1 });
  }, [questionIndex, screen, subject, track]);

  const score = subject
    ? selectedAnswers.slice(0, quizQuestionCount).reduce((total, answer, index) => total + Number(answer === questionBank[subject][index]?.correctIndex), 0)
    : 0;

  useEffect(() => {
    if (screen === "result" && subject) {
      track("result_viewed", { subject, score });
      track("waitlist_form_viewed", { subject, score, placement: "result_inline" });
    }
  }, [score, screen, subject, track]);

  const activeQuestion = subject ? questionBank[subject][questionIndex] : null;
  const selectedAnswer = selectedAnswers[questionIndex];
  const hasAnswered = selectedAnswer !== undefined;
  const resultCopy = score === quizQuestionCount ? "Starker Start. Mit kurzen Duellen bleibt dein Wissen auch unter Prüfungsdruck abrufbar." : "Jede Antwort zeigt dir, wo eine kurze Wiederholung am meisten bringt. Genau dafür ist Medula da.";

  useEffect(() => {
    if (screen !== "quiz" || !hasAnswered) return;
    const frame = window.requestAnimationFrame(() => continueButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [hasAnswered, screen]);

  function showScreen(next: Screen) { setScreen(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function startQuiz() {
    recordQuizVisit("quiz_started");
    track("quiz_started");
    showScreen("subject");
  }
  function chooseSubject(nextSubject: Subject) { setSubject(nextSubject); setQuestionIndex(0); setSelectedAnswers([]); setIsSubmitted(false); setErrorMessage(""); recordQuizVisit("subject_selected", { subject: nextSubject }); track("subject_selected", { subject: nextSubject }); showScreen("quiz"); }
  function chooseAnswer(answerIndex: number) {
    if (!activeQuestion || !subject || hasAnswered) return;
    const correct = answerIndex === activeQuestion.correctIndex;
    setSelectedAnswers((answers) => [...answers, answerIndex]);
    recordQuizVisit(questionAnsweredEvents[questionIndex], { subject });
    track("answer_submitted", { subject, question_number: questionIndex + 1, is_correct: correct });
  }
  function nextQuestion() {
    if (!hasAnswered) return;
    if (questionIndex < quizQuestionCount - 1) { setQuestionIndex((index) => index + 1); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    recordQuizVisit("result_viewed", { subject: subject || undefined, score });
    showScreen("result");
  }
  async function handleWaitlistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    if (!email) return;
    const tiktokEventId = readConsent() === "granted" ? createTikTokEventId() : undefined;
    setErrorMessage(""); setIsSubmitting(true);
    recordQuizVisit("email_started", { subject, score });
    track("waitlist_submit_started", { subject, score, placement: "result_inline" });
    try {
      const parameters = new URLSearchParams(window.location.search);
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, website: formData.get("website"), source: "quiz_result", path: window.location.pathname, search: window.location.search, referrer: document.referrer, ref: parameters.get("ref"), subject, score, analyticsDistinctId: readConsent() === "granted" ? getAnalyticsDistinctId() : undefined, tiktokEventId }) });
      const payload = (await response.json().catch(() => null)) as { message?: string; duplicate?: boolean; position?: number; referralLink?: string; referralCount?: number; referralGoal?: number; rewardUnlocked?: boolean } | null;
      if (!response.ok) throw new Error(payload?.message || "Das hat gerade nicht geklappt.");
      recordQuizVisit("email_submitted", { subject, score });
      if (tiktokEventId && !payload?.duplicate) void trackTikTokCompleteRegistration(tiktokEventId, email);
      setPosition(payload?.position ?? null); setReferralLink(payload?.referralLink || ""); setReferralCount(payload?.referralCount ?? 0); setReferralGoal(payload?.referralGoal ?? 3); setRewardUnlocked(Boolean(payload?.rewardUnlocked)); setHasCopiedReferralLink(false); setIsSubmitted(true); form.reset();
    } catch (error) {
      track("waitlist_submit_failed", { subject, score, placement: "result_inline" });
      setErrorMessage(error instanceof Error ? error.message : "Das hat gerade nicht geklappt.");
    } finally { setIsSubmitting(false); }
  }
  async function copyReferralLink() {
    if (!referralLink) return;
    try { await navigator.clipboard.writeText(referralLink); setHasCopiedReferralLink(true); track("waitlist_referral_link_copied", { subject }); }
    catch { setErrorMessage("Der Link konnte nicht kopiert werden. Bitte versuche es noch einmal."); }
  }
  async function shareReferralLink() {
    if (!referralLink) return;
    track("waitlist_referral_share_started", { subject });
    if (navigator.share) {
      try { await navigator.share({ title: "Medula – Quizduell fürs Medizinstudium", text: "Komm auf die Medula-Warteliste und sichere dir 3 Monate Premium zum Launch.", url: referralLink }); track("waitlist_referral_shared", { subject }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    await copyReferralLink();
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Medula Navigation"><Image className={styles.brandLogo} src={logoUrl} alt="Medula" width={1800} height={520} priority /></nav>
      <main className={styles.main} aria-live="polite">
        {screen === "intro" ? <section className={`${styles.screen} ${styles.centerScreen}`} aria-labelledby="intro-title"><h1 id="intro-title">Teste dein Medizinwissen.</h1><p className={styles.lead}>Wähle dein Fach, beantworte eine Frage und erhalte sofort eine kurze Erklärung.</p><div className={styles.heroCard} aria-hidden="true"><div className={styles.heroCardTop}><span>ANATOMIE</span><span>1 / 1</span></div><div className={styles.heroCardQuestion}>Welche Struktur verläuft durch das Foramen ovale?</div><div className={styles.heroCardOptions}><span>A</span><span>B</span><span>C</span><span>D</span></div></div><button className={styles.primaryButton} type="button" onClick={startQuiz}>Kurzcheck starten</button><div className={styles.trustRow}><div className={styles.avatars} aria-hidden="true"><img className={styles.avatar} src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&h=160&q=80" alt="" /><img className={styles.avatar} src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&h=160&q=80" alt="" /><img className={styles.avatar} src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&h=160&q=80" alt="" /></div><span>Für Medizinstudierende in Deutschland</span></div></section> : null}

        {screen === "subject" ? <section className={`${styles.screen} ${styles.centerScreen}`} aria-labelledby="subject-title"><p className={styles.eyebrow}>Dein Fach</p><h2 id="subject-title">Wähle dein Fach.</h2><p className={styles.lead}>Wir geben dir eine passende Frage mit kurzer Erklärung.</p><div className={`${styles.choiceGrid} ${styles.subjectGrid}`} role="group" aria-label="Fach auswählen">{subjectOptions.map((option) => <button className={styles.choice} type="button" key={option.label} onClick={() => chooseSubject(option.label)}><span className={styles.choiceIcon}>{option.icon}</span><span className={styles.choiceLabel}>{option.label}</span></button>)}</div><button className={styles.backButton} type="button" onClick={() => showScreen("intro")}>← Zurück</button></section> : null}

        {screen === "quiz" && activeQuestion && subject ? <section className={`${styles.screen} ${styles.quizScreen}`} aria-labelledby="quiz-question"><div className={styles.quizTop}><span className={styles.subjectPill}>{subject}</span><div className={styles.quizProgress} aria-label="Quizfortschritt"><span style={{ width: `${((questionIndex + 1) / quizQuestionCount) * 100}%` }} /></div><span className={styles.quizCount}>{questionIndex + 1} / {quizQuestionCount}</span></div><p className={styles.questionHint}>Dein {subject}-Kurzcheck</p><h2 className={styles.question} id="quiz-question">{activeQuestion.question}</h2><div className={styles.answers}>{activeQuestion.options.map((option, index) => { const isCorrect = hasAnswered && index === activeQuestion.correctIndex; const isIncorrect = hasAnswered && index === selectedAnswer && !isCorrect; return <button className={`${styles.answer} ${isCorrect ? styles.answerCorrect : ""} ${isIncorrect ? styles.answerIncorrect : ""}`} type="button" key={option} disabled={hasAnswered} onClick={() => chooseAnswer(index)}><span className={styles.answerLetter}>{String.fromCharCode(65 + index)}</span><span>{option}</span></button>; })}</div>{hasAnswered ? <div className={styles.feedback}><p>{selectedAnswer === activeQuestion.correctIndex ? "Richtig." : `Fast – richtig ist: ${activeQuestion.options[activeQuestion.correctIndex]}.`}</p><span>{activeQuestion.explanation}</span></div> : null}{hasAnswered ? <button ref={continueButtonRef} className={`${styles.primaryButton} ${styles.quizNext}`} type="button" onClick={nextQuestion}>Zu deinem Ergebnis</button> : null}<button className={styles.backButton} type="button" onClick={() => showScreen("subject")}>← Fach ändern</button></section> : null}

        {screen === "result" && subject ? <section className={`${styles.screen} ${styles.centerScreen}`} aria-labelledby="result-title"><p className={styles.eyebrow}>Dein Ergebnis</p><div className={styles.resultHeader}><div className={styles.scoreRing}><div><strong>{score}/{quizQuestionCount}</strong><span>RICHTIG</span></div></div><h2 className={styles.resultTitle} id="result-title">Dein {subject}-Kurzcheck</h2></div><p className={styles.resultCopy}>{resultCopy}</p><div className={styles.resultList}>{questionBank[subject].slice(0, quizQuestionCount).map((question, index) => { const correct = selectedAnswers[index] === question.correctIndex; return <div className={`${styles.resultRow} ${correct ? styles.resultRowCorrect : ""}`} key={question.topic}><span>{correct ? "✓" : "→"}</span><p>{question.topic}: {correct ? "sicher beantwortet" : "kurz wiederholen"}</p></div>; })}</div><div className={`${styles.resultOptin} ${isSubmitted ? styles.resultOptinSent : ""}`}>{isSubmitted ? <div className={styles.confirmation} role="status"><div className={styles.confirmationIcon}>✓</div><h2>{position ? `Du bist auf Platz #${position}.` : "Du bist auf der Liste."}</h2><p>{rewardUnlocked ? "Lifetime Premium ist freigeschaltet." : `Lade ${referralGoal} Kommiliton:innen ein und sichere dir Lifetime Premium.`}</p>{referralLink ? <><p className={styles.referralProgress}>{Math.min(referralCount, referralGoal)}/{referralGoal} erfolgreiche Einladungen</p><div className={styles.referralRow}><input value={referralLink} readOnly aria-label="Persönlicher Einladungslink" /><button type="button" onClick={copyReferralLink}>{hasCopiedReferralLink ? "Kopiert" : "Kopieren"}</button></div><button className={styles.shareButton} type="button" onClick={shareReferralLink}>Mit Kommiliton:innen teilen</button></> : null}</div> : <><div className={styles.optinHeader}><div><p className={styles.optinKicker}>Medula App</p><strong>Bereit für mehr als eine Frage?</strong><p>Sichere dir 3 Monate Medula Premium gratis zum Launch.</p></div><div className={styles.miniAppDevice}><Image src={appPreviewUrl} alt="Vorschau der Medula App" width={1179} height={2556} /></div></div><form onSubmit={handleWaitlistSubmit}><label className={styles.formLabel} htmlFor="email">E-Mail für den Launch</label><input className={styles.emailInput} id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="deine@email.de" required onChange={() => recordQuizVisit("email_started", { subject, score })} /><input className={styles.honeypot} name="website" type="text" tabIndex={-1} autoComplete="off" /><button className={`${styles.primaryButton} ${styles.optinButton}`} type="submit" disabled={isSubmitting}>{isSubmitting ? "Wird gespeichert..." : "3 Monate Premium sichern"}</button><p className={styles.formNote}>Wir schreiben dir zum Launch. Kein Spam.</p>{errorMessage ? <p className={styles.formError} role="alert">{errorMessage}</p> : null}</form></>}</div><button className={styles.backButton} type="button" onClick={() => showScreen("quiz")}>← Antwort ansehen</button></section> : null}
      </main>
      <footer className={styles.footer}><strong>Medula</strong> · Schnelle Wiederholung zwischen Uni, Station und Klausurphase</footer>
    </div>
  );
}
