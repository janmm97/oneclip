import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "OneClip",
  description: "Local AI video clipper: finds the strongest hooks in your video and renders vertical clips on your machine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <header className="border-b border-line">
          <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 text-sm">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="size-2.5 rounded-full bg-tally" aria-hidden />
              OneClip
            </Link>
            <Link href="/" className="text-muted hover:text-fg">
              New clip
            </Link>
            <Link href="/setup" className="text-muted hover:text-fg">
              Setup
            </Link>
            <span className="ml-auto hidden text-xs text-muted sm:block">Runs on this machine · nothing uploaded but clip text to Jev</span>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
