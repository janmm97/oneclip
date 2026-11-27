"use client";

import type { Ratio } from "@oneclip/core/browser";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PLACES, placesLabel, toggleRatio } from "@/lib/form";
import { cn } from "@/lib/utils";

/** "Where will you post?": a disclosure button over a checkbox list. Esc or a click outside closes it and puts focus back on the button. */
export function PlacesPicker({ value, onChange }: { value: Ratio[]; onChange: (v: Ratio[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      button.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // A click outside closes it; focus goes back to the button unless the click landed on another control.
    const onDown = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      setOpen(false);
      setTimeout(() => (document.activeElement === document.body || !document.activeElement) && button.current?.focus());
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative grid gap-1.5 text-sm">
      <span id={`${id}-label`} className="font-medium">
        Where will you post?
      </span>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen(!open)}
        className="press flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-raised px-3.5 text-left hover:border-tally/60"
      >
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">
          {placesLabel(value)}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      <fieldset id={`${id}-list`} hidden={!open} className="absolute top-full z-20 border border-line bg-bg shadow-xl mt-1 grid w-full min-w-64 gap-0.5 rounded-lg p-1.5">
        <legend className="sr-only">Where will you post?</legend>
        {PLACES.map(([r, name, shape]) => {
          const on = value.includes(r);
          return (
            <label key={r} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-2.5 hover:bg-raised has-focus-visible:bg-raised">
              <input type="checkbox" checked={on} onChange={() => onChange(toggleRatio(value, r))} className="peer sr-only" />
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-tally",
                  on ? "border-tally bg-tally text-tally-ink" : "border-line",
                )}
                aria-hidden
              >
                {on ? <Check className="size-3.5" /> : null}
              </span>
              <span className="flex-1">{name}</span>
              <span className="num text-xs text-muted">{shape}</span>
            </label>
          );
        })}
        <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted">Keep at least one.</p>
      </fieldset>
    </div>
  );
}
