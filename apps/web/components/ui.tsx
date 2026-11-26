import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "press inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-tally text-tally-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] hover:bg-tally-fg",
        outline: "border border-line bg-raised text-fg backdrop-blur-md hover:bg-line",
        ghost: "text-muted hover:bg-raised hover:text-fg",
      },
      size: { sm: "h-8 px-3.5", md: "h-10 px-5", icon: "size-9" },
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

const badge = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-raised text-muted",
      tally: "bg-tally/15 text-tally-fg",
      good: "bg-good/15 text-good",
      warn: "bg-warn/15 text-warn",
      bad: "bg-bad/15 text-bad",
      info: "bg-info/15 text-info",
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

const control = "h-10 w-full rounded-md border border-line bg-raised px-3.5 text-sm text-fg placeholder:text-muted/70 hover:border-muted/50 disabled:opacity-50";

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
    <p role="alert" className={cn("rounded-md border px-3.5 py-2.5 text-sm", tone === "bad" ? "border-bad/40 bg-bad/10 text-bad" : "border-warn/40 bg-warn/10 text-warn")}>
      {children}
    </p>
  );
}

/** iOS segmented control: one choice out of a few, as a radio group. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, ReactNode])[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-md bg-raised p-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "press min-h-8 rounded-[0.6rem] px-2 text-[0.8125rem] font-medium",
            v === value ? "bg-panel-strong text-fg shadow-[0_1px_3px_rgb(0_0_0/0.25)]" : "text-muted hover:text-fg",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** iOS-style on/off switch. */
export function Switch({ checked, onChange, label, className }: { checked: boolean; onChange: (on: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("press relative h-[1.9rem] w-[3.15rem] shrink-0 rounded-full transition-colors", checked ? "bg-good" : "bg-line", className)}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-[1.65rem] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.3)] transition-transform duration-300 ease-(--ease-spring)",
          checked && "translate-x-[1.25rem]",
        )}
        aria-hidden
      />
    </button>
  );
}
