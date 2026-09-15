import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Medula – Quizduelle fürs Medizinstudium",
  description:
    "Kurze Quizduelle für Anatomie, Physio, Pharma und klinische Fälle. Sichere dir 3 Monate Medula Premium kostenlos zum Launch.",
  icons: {
    icon: "/assets/medula-favicon-32x32.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
