"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useState } from "react";
import styles from "./page.module.css";

const waitlistStorageKey = "mediprac_waitlist_email";
const assetBaseUrl =
  "https://raw.githubusercontent.com/L0xGames/mediprac_landing/main/public/assets";
const logoUrl = `${assetBaseUrl}/mediprac-logo-horizontal.svg`;
const appPreviewUrl = `${assetBaseUrl}/mediprac-topic-selection-current.png`;

export default function Home() {
  const [isSubmitted, setIsSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email");

    if (email) {
      window.localStorage.setItem(waitlistStorageKey, String(email));
      setIsSubmitted(true);
      form.reset();
    }
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Hauptnavigation">
        <a className={styles.brand} href="#" aria-label="mediprac Startseite">
          <Image
            className={styles.brandLogo}
            src={logoUrl}
            alt="mediprac"
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
            aria-label="mediprac App Vorschau"
          >
            <Image
              src={appPreviewUrl}
              alt="mediprac App-Screen zur Auswahl des Fachgebiets in Runde 3"
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
              <button className={styles.submitButton} type="submit">
                Early access sichern
              </button>
            </form>
            <p className={styles.microcopy}>Kostenloser Zugang beim Launch.</p>
            <p className={styles.success} role="status">
              <strong>Du bist auf Platz #248.</strong>
              Lade 3 Kommiliton:innen ein und sichere dir Lifetime Premium.
            </p>
          </section>
        </div>

        <div className={styles.visual} aria-label="mediprac App Vorschau">
          <div className={styles.visualCard} aria-hidden="true" />
          <div className={styles.phone}>
            <Image
              className={styles.phoneScreen}
              src={appPreviewUrl}
              alt="mediprac App-Screen zur Auswahl des Fachgebiets in Runde 3"
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
          <strong>mediprac</strong> startet bald in Deutschland.
        </span>
        <span>
          Gemacht für schnelle Wiederholung zwischen Uni, Station und
          Klausurphase.
        </span>
      </footer>
    </main>
  );
}
