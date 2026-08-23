import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aloud — find out what you actually understand",
  description:
    "Pick something you are studying, explain it out loud from memory, and watch a map of the topic light up where your explanation held and stay dark where it did not.",
  openGraph: {
    title: "Aloud",
    description:
      "Explain a topic out loud. Watch the map of it light up where you were right and stay dark where you were not.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#100e0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="relative min-h-dvh">{children}</body>
    </html>
  );
}
