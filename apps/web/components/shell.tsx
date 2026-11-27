"use client";

import { Moon, Plus, Stethoscope } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo, BrandMark } from "@/components/brand";
import { Switch } from "@/components/ui";
import { THEME_KEY, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "New clip", icon: Plus, match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/setup", label: "Check my computer", icon: Stethoscope, match: (p: string) => p.startsWith("/setup") },
] as const;

function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"), []);
  const set = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  };
  return [theme, set] as const;
}

function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <Link href="/" className="flex items-center text-fg" aria-label="OneClip home">
      {withName ? <BrandLogo className="h-7 w-auto" /> : <BrandMark className="size-8" />}
    </Link>
  );
}

/**
 * App frame. Desktop (≥1280px): glass sidebar. Tablet: the sidebar folds to an icon rail.
 * Phone (<768px): compact top bar and an iOS bottom tab bar.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[4.75rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="glass-thick sticky top-0 z-20 hidden h-dvh flex-col gap-6 rounded-none border-y-0 border-l-0 p-3 md:flex xl:p-4">
        <div className="flex justify-center pt-1 xl:justify-start xl:px-2">
          <span className="xl:hidden">
            <Logo withName={false} />
          </span>
          <span className="hidden xl:block">
            <Logo />
          </span>
        </div>
        <nav aria-label="Main" className="grid gap-1">
          {NAV.map(({ href, label, icon: Icon, match }) => {
            const on = match(path);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                title={label}
                className={cn(
                  "press flex h-10 items-center justify-center gap-3 rounded-md text-sm font-medium xl:justify-start xl:px-3",
                  on ? "bg-tally/15 text-tally-fg" : "text-muted hover:bg-raised hover:text-fg",
                )}
              >
                <Icon className="size-[1.1rem] shrink-0" aria-hidden />
                <span className="sr-only xl:not-sr-only">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-3">
          <p className="hidden px-2 text-xs leading-relaxed text-muted xl:block">Your videos stay on this computer. Only the words go to the AI.</p>
          <div className="flex items-center justify-center gap-3 rounded-md bg-raised p-2 xl:justify-between xl:px-3">
            <span className="hidden items-center gap-2 whitespace-nowrap text-sm xl:flex">
              <Moon className="size-4 text-muted" aria-hidden />
              Dark mode
            </span>
            <Switch checked={dark} onChange={(on) => setTheme(on ? "dark" : "light")} label="Dark appearance" />
          </div>
        </div>
      </aside>

      <header className="glass-thick sticky top-0 z-20 flex h-14 items-center gap-3 rounded-none border-x-0 border-t-0 px-4 md:hidden">
        <Logo />
        <Switch checked={dark} onChange={(on) => setTheme(on ? "dark" : "light")} label="Dark appearance" className="ml-auto" />
      </header>

      {/* Full width: the editor uses the whole screen; pages that read better narrow cap themselves. */}
      <main className="min-w-0 px-[clamp(1rem,2.2vw,3rem)] pt-6 pb-28 md:pb-8">{children}</main>

      <nav aria-label="Tabs" className="glass-thick fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const on = match(path);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined} className={cn("press grid justify-items-center gap-0.5 py-2 text-[0.6875rem] font-medium", on ? "text-tally-fg" : "text-muted")}>
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
