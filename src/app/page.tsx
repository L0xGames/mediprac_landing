"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useState } from "react";
import styles from "./page.module.css";

const logoUrl = "/assets/medula-logo-horizontal.svg";
const appPreviewUrl = "/assets/medula-topic-selection-current.png";

export default function Home() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [referralLink, setReferralLink] = useState("");
  const [referralCount, setReferralCount] = useState(0);
  const [referralGoal, setReferralGoal] = useState(3);
  const [rewardUnlocked, setRewardUnlocked] = useState(false);
  const [hasCopiedReferralLink, setHasCopiedReferralLink] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();

    if (!email) {
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const params = new URLSearchParams(window.location.search);
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          website: formData.get("website"),
          source: "landing",
          path: window.location.pathname,
          search: window.location.search,
          referrer: document.referrer,
          ref: params.get("ref"),
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        position?: number;
        referralLink?: string;
        referralCount?: number;
        referralGoal?: number;
        rewardUnlocked?: boolean;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.message || "Das hat gerade nicht geklappt.");
      }

      setPosition(payload?.position ?? null);
      setReferralLink(payload?.referralLink || "");
      setReferralCount(payload?.referralCount ?? 0);
      setReferralGoal(payload?.referralGoal ?? 3);
      setRewardUnlocked(Boolean(payload?.rewardUnlocked));
      setHasCopiedReferralLink(false);
      setIsSubmitted(true);
      form.reset();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Das hat gerade nicht geklappt.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyReferralLink() {
    if (!referralLink) {
      return;
    }

    await navigator.clipboard.writeText(referralLink);
    setHasCopiedReferralLink(true);
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Hauptnavigation">
        <a className={styles.brand} href="#" aria-label="Medula Startseite">
          <Image
            className={styles.brandLogo}
            src={logoUrl}
            alt="Medula"
            width={1800}
            height={520}
            priority
          />
        </a>
        <a className={styles.navPill} href="#warteliste">
          Early access sichern
        </a>
      </nav>

      <section className={styles.hero} aria-labelledby="headline">
        <div className={styles.copy}>
          <h1 id="headline">Quizduell fürs Medizinstudium</h1>
          <p className={styles.lead}>
            Miss dich in kurzen Medizin-Duellen mit Kommiliton:innen aus ganz
            Deutschland. Anatomie, Physio, Biochemie, Pharmakologie und
            klinische Fälle - spielerisch wiederholen statt nur kreuzen.
          </p>

          <div
            className={styles.mobileAppPreview}
            aria-label="Medula App Vorschau"
          >
            <Image
              src={appPreviewUrl}
              alt="Medula App-Screen zur Auswahl des Fachgebiets in Runde 3"
              width={1179}
              height={2556}
              priority
            />
          </div>

          <div className={styles.offerCallout} aria-label="Launch-Angebot">
            <span>Launch-Angebot</span>
            <strong>3 Monate Premium kostenlos</strong>
          </div>

          <section
            className={`${styles.signupCard} ${isSubmitted ? styles.isSent : ""}`}
            id="warteliste"
            aria-label="Warteliste"
          >
            <form className={styles.signupForm} onSubmit={handleSubmit}>
              <label className={styles.srOnly} htmlFor="email">
                E-Mail-Adresse
              </label>
              <input
                className={styles.emailInput}
                id="email"
                name="email"
                type="email"
                placeholder="Deine E-Mail-Adresse"
                autoComplete="email"
                required
              />
              <input
                className={styles.honeypot}
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
              <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Wird gespeichert..." : "Early access sichern"}
              </button>
            </form>
            <p className={styles.microcopy}>Kostenloser Zugang beim Launch.</p>
            {errorMessage ? (
              <p className={styles.error} role="alert">
                {errorMessage}
              </p>
            ) : null}
            <div className={styles.success} role="status">
              <strong className={styles.placementLine}>
                Du bist auf Platz #{position ?? 248}.
              </strong>
              <span>
                {rewardUnlocked
                  ? "Lifetime Premium ist freigeschaltet."
                  : `Lade ${referralGoal} Kommiliton:innen ein und sichere dir Lifetime Premium.`}
              </span>
              {referralLink ? (
                <div className={styles.referralBox}>
                  <div className={styles.referralProgress}>
                    <span>
                      {Math.min(referralCount, referralGoal)}/{referralGoal} erfolgreiche Einladungen
                    </span>
                    <span>{rewardUnlocked ? "Freigeschaltet" : "Offen"}</span>
                  </div>
                  <div className={styles.referralLinkRow}>
                    <input
                      className={styles.referralLinkInput}
                      value={referralLink}
                      readOnly
                      aria-label="Persönlicher Einladungslink"
                    />
                    <button
                      className={styles.copyButton}
                      type="button"
                      onClick={handleCopyReferralLink}
                    >
                      {hasCopiedReferralLink ? "Kopiert" : "Kopieren"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className={styles.visual} aria-label="Medula App Vorschau">
          <div className={styles.visualCard} aria-hidden="true" />
          <div className={styles.phone}>
            <Image
              className={styles.phoneScreen}
              src={appPreviewUrl}
              alt="Medula App-Screen zur Auswahl des Fachgebiets in Runde 3"
              width={1179}
              height={2556}
              priority
            />
          </div>
          <aside
            className={`${styles.floating} ${styles.premiumBadge}`}
            aria-label="Premium Bonus"
          >
            <span>Wartelisten-Bonus</span>
            <strong>3 Monate Premium</strong>
          </aside>
          <aside
            className={`${styles.floating} ${styles.duelBadge}`}
            aria-label="Duell Hinweis"
          >
            <div className={styles.duelIcon} aria-hidden="true">
              -&gt;
            </div>
            <div>
              <strong>Neues Duell</strong>
              <span>Kardiologie, Pharma, Anatomie</span>
            </div>
          </aside>
          <div className={styles.topicChips} aria-hidden="true">
            <span className={styles.chip} />
            <span className={styles.chip} />
            <span className={styles.chip} />
          </div>
        </div>
      </section>

      <footer className={styles.launchStrip}>
        <span>
          <strong>Medula</strong> startet bald in Deutschland.
        </span>
        <span>
          Gemacht für schnelle Wiederholung zwischen Uni, Station und
          Klausurphase.
        </span>
      </footer>
    </main>
  );
}
