import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-tally text-tally-ink hover:bg-tally/85",
        outline: "border border-line bg-panel text-fg hover:bg-raised",
        ghost: "text-muted hover:bg-raised hover:text-fg",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-4", icon: "size-8" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export function Button({ className, variant, size, loading, children, disabled, ...p }: ComponentProps<"button"> & VariantProps<typeof button> & { loading?: boolean }) {
  return (
    <button className={cn(button({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ className, variant, size, ...p }: ComponentProps<"a"> & VariantProps<typeof button>) {
  return <a className={cn(button({ variant, size }), className)} {...p} />;
}

const badge = cva("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-raised text-muted",
      tally: "bg-tally/15 text-tally",
      good: "bg-good/15 text-good",
      warn: "bg-warn/15 text-warn",
      bad: "bg-bad/15 text-bad",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: ComponentProps<"span"> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid content-start gap-1.5 text-sm", className)}>
      <span className="font-medium text-fg">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const control = "h-10 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg placeholder:text-muted/70 hover:border-muted/50 disabled:opacity-50";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...p} />;
}

export function Select({ className, options, ...p }: ComponentProps<"select"> & { options: readonly (readonly [string, string])[] }) {
  return (
    <select className={cn(control, "pr-8", className)} {...p}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** A 0..1 bar. `tone` picks the fill; the number sits beside it in tabular figures. */
export function Meter({ value, label, tone = "fg", showValue = true }: { value: number; label?: string; tone?: "fg" | "tally"; showValue?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <div className={cn("h-full rounded-full transition-[width] duration-500 ease-(--ease-out-expo)", tone === "tally" ? "bg-tally" : "bg-fg/70")} style={{ width: `${pct}%` }} />
      </div>
      {showValue ? <span className="num w-8 text-right text-xs text-muted">{pct}</span> : null}
    </div>
  );
}

export function Notice({ tone = "bad", children }: { tone?: "bad" | "warn"; children: ReactNode }) {
  return (
    <p role="alert" className={cn("rounded-md border px-3 py-2 text-sm", tone === "bad" ? "border-bad/40 bg-bad/10 text-bad" : "border-warn/40 bg-warn/10 text-warn")}>
      {children}
    </p>
  );
}
