"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type VisitEvent = "page_viewed" | "email_started" | "email_submitted" | "session_ended";

const appPreviewUrl = "/assets/medula-dashboard.png";

function createVisitId() {
  const fallback = `landing2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  return window.crypto?.randomUUID?.() || fallback;
}

function getVisitMetadata() {
  return {
    pageUrl: window.location.href,
    pagePath: window.location.pathname,
    pageSearch: window.location.search,
    referrer: document.referrer || undefined,
    language: navigator.language,
    languages: navigator.languages?.join(", "),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    touchPoints: navigator.maxTouchPoints,
  };
}

export default function LandingTwo() {
  const visit = useRef({ id: "", events: new Set<VisitEvent>(), startedAt: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const recordVisit = useCallback((event: VisitEvent, useBeacon = false) => {
    if (visit.current.events.has(event)) return;
    visit.current.events.add(event);

    if (!visit.current.id) visit.current.id = createVisitId();
    if (!visit.current.startedAt) visit.current.startedAt = Date.now();

    const payload = JSON.stringify({
      visitId: visit.current.id,
      event,
      elapsedDurationMs: Math.max(0, Date.now() - visit.current.startedAt),
      metadata: getVisitMetadata(),
    });

    if (useBeacon && navigator.sendBeacon) {
      const sent = navigator.sendBeacon("/api/quiz-visits", new Blob([payload], { type: "application/json" }));
      if (sent) return;
    }

    void fetch("/api/quiz-visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    recordVisit("page_viewed");
    const handlePageHide = () => recordVisit("session_ended", true);
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [recordVisit]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    if (!email) return;

    setErrorMessage("");
    setIsSubmitting(true);
    recordVisit("email_started");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website: formData.get("website"),
          source: "landing2_direct",
          path: window.location.pathname,
          search: window.location.search,
          referrer: document.referrer,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message || "Das hat gerade nicht geklappt.");

      recordVisit("email_submitted");
      setIsSubmitted(true);
      form.reset();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Das hat gerade nicht geklappt.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="landing2-title">
        <div className={styles.copy}>
          <p className={styles.brand}>medula</p>
          <h1 className={styles.title} id="landing2-title">Medula App</h1>
          <p className={styles.subtitle}>Teste jetzt dein Medizinwissen</p>
        </div>

        <div className={styles.conversionArea}>
          <div className={styles.device} aria-hidden="true">
            <div className={styles.deviceSpeaker} />
            <Image src={appPreviewUrl} alt="" width={1179} height={2556} priority />
          </div>

          {isSubmitted ? (
            <div className={styles.confirmation} role="status">
              <span className={styles.confirmationIcon}>✓</span>
              <p>Du bist auf der Liste.</p>
            </div>
          ) : (
            <form className={styles.signupForm} onSubmit={handleSubmit}>
              <label className={styles.visuallyHidden} htmlFor="landing2-email">E-Mail für den Launch</label>
              <input
                className={styles.emailInput}
                id="landing2-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="deine@email.de"
                required
                onFocus={() => recordVisit("email_started")}
              />
              <input className={styles.honeypot} name="website" type="text" tabIndex={-1} autoComplete="off" />
              {errorMessage ? <p className={styles.error} role="alert">{errorMessage}</p> : null}
              <button className={styles.ctaButton} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Wird gespeichert..." : "3 Monate Premium sichern"}
              </button>
              <p className={styles.availability}>Noch 12 Plätze frei</p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
