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
  title: "mediprac - Quizduell fürs Medizinstudium",
  description:
    "mediprac kommt bald: Quizduell fürs Medizinstudium. Sichere dir 3 Monate Premium kostenlos zum Launch.",
  icons: {
    icon: "https://raw.githubusercontent.com/L0xGames/mediprac_landing/main/public/assets/favicon-32x32.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
