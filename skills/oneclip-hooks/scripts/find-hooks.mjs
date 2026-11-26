#!/usr/bin/env node
// Finds spoken hook lines in a OneClip transcript. No dependencies, reads only local files.
// Usage: node find-hooks.mjs <project-folder or transcript.json> [--top 15] [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Each pattern tags a line with a hook family; the family maps to Jev's hook type.
const PATTERNS = [
  ["contrarian", "contrarian", 3, /\b(everyone|everybody|most people|they)\b.{0,40}\b(wrong|lie|lying|myth)\b|\b(actually|overrated|stop doing|don't|never) (do|use|buy|believe|listen)\b|\bunpopular opinion\b|\bthe truth is\b|\bis (dead|a scam|a lie|a myth)\b/i],
  ["curiosity", "curiosity", 3, /\b(nobody|no one) (talks|knows|tells)\b|\bhere'?s (why|what|how|the thing)\b|\bthe (real )?reason\b|\bsecret\b|\bwhat (happened|nobody)\b|\byou won'?t believe\b|\bturns out\b/i],
  ["revelation", "unexpected_revelation", 3, /\b(i|we) (never told|admit|confess|got fired|almost quit|lost everything|was wrong)\b|\bbehind the scenes\b|\bthe first time i\b|\bhonestly\b/i],
  ["stakes", "emotional_stakes", 2, /\b(cost|lose|lost|risk|broke|bankrupt|die|died|fired|quit|scared|terrified|last chance|or else)\b/i],
  ["identity", "curiosity", 2, /^(if you('| a)re|if you (run|own|have|want|make)|for (anyone|everyone) who)\b/i],
  ["practical", "practical_value", 2, /\b(how to|the (one|best|easiest|fastest) way|step (one|1)|tip|trick|hack|do this|try this)\b/i],
  ["problem", "problem_solution", 2, /\b(the (biggest|number one|#1) (mistake|problem)|the problem (is|with)|why (your|most)|mistake)\b/i],
  ["story", "storytelling", 2, /^(so )?(i was|we were|there was|one (day|time|night)|picture this|imagine)\b|\b(years ago|last (week|month|year))\b/i],
  ["proof", "surprising", 2, /\b(\d[\d,.]*\s?(k|m|million|billion|thousand|percent|%|x|times|followers|views|subscribers|dollars))\b|\$\d/i],
  ["number", "surprising", 1, /\b\d[\d,.]*\b|\b(two|three|four|five|seven|ten|hundred|thousand|million|billion)\b/i],
  ["emotion", "emotional_stakes", 1, /\b(insane|crazy|unbelievable|shocking|terrible|incredible|cried|love|hate|furious|wow|holy)\b/i],
];
// Lines that fail as openers: filler, callbacks, greetings, sponsor reads.
const WEAK = [
  [/^(so|um+|uh+|like|and|but|anyway|okay|ok|yeah|right|well)\b/i, "starts with filler: open on the next strong word"],
  [/\b(as i (was saying|said)|like i said|going back to|earlier)\b/i, "callback to earlier context: needs a cold-open rewrite"],
  [/^(it|that|this|he|she|they|those|these)\b/i, "opens on a pronoun: the viewer won't know what it refers to"],
  [/\b(welcome (back|to)|hey (guys|everyone)|what'?s up|subscribe|sponsor|brought to you|link in)\b/i, "greeting, sponsor or CTA: never a hook"],
];

// Files saved by Windows tools often start with a byte-order mark, which JSON.parse rejects.
const read = (file) => fs.readFileSync(file, "utf8").replace(/^﻿/, "");

export function sentences(words, gap = 0.7) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map((w) => w.text.trim()).join(" ").replace(/\s+([,.?!])/g, "$1"), words: cur.length });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && w.start - cur.at(-1).end > gap) flush();
    cur.push(w);
    if (/[.?!]["')\]]*$/.test(w.text.trim())) flush();
  }
  flush();
  return out;
}

export function scoreLine(s) {
  const tags = [];
  const notes = [];
  let score = 0;
  const types = {};
  for (const [tag, type, weight, re] of PATTERNS) {
    if (!re.test(s.text)) continue;
    if (tag === "number" && tags.includes("proof")) continue;
    tags.push(tag);
    score += weight;
    types[type] = (types[type] ?? 0) + weight;
  }
  if (/\?\s*$/.test(s.text)) {
    // Specific questions hook; generic ones ("you know what?") don't.
    const specific = s.words >= 5 && /\b(why|how|what if|would you|can|did you|have you|which)\b/i.test(s.text);
    tags.push(specific ? "question" : "weak-question");
    if (specific) { score += 2; types.curiosity = (types.curiosity ?? 0) + 2; }
  }
  for (const [re, note] of WEAK) if (re.test(s.text)) { score -= 2; notes.push(note); }
  if (s.words < 4) { score -= 1; notes.push("too short to carry a hook alone"); }
  if (s.words > 15) { score -= 1; notes.push(`${s.words} words: a spoken hook should be 15 or fewer, trim or start mid-line`); }
  const hookType = Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
  return { ...s, score, tags, hookType, notes };
}

export function readJev(file) {
  if (!fs.existsSync(file)) return [];
  return read(file).split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

export function findHooks(words, jev = [], top = 15) {
  const lines = sentences(words).map(scoreLine);
  for (const l of lines) {
    const span = jev.filter((h) => l.start >= h.start - 0.5 && l.start < h.end).sort((a, b) => b.score - a.score)[0];
    if (!span) continue;
    l.jev = { start: span.start, score: span.score, hookType: span.hookType };
    l.score += Math.round(span.score * 4 * 10) / 10;
    const late = l.start - span.start;
    if (late > 3 && l.score >= 3) l.notes.push(`hook lands ${late.toFixed(1)} s into Jev's span: cut the first ${late.toFixed(1)} s and open here`);
  }
  return lines.filter((l) => l.score > 0).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, top);
}

const time = (t) => {
  const tenths = Math.round(t * 10); // round first so 59.96 s prints 1:00.0, not 0:60.0
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

function main(argv) {
  const args = argv.slice(2);
  const target = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--top");
  if (!target) {
    console.error("Usage: node find-hooks.mjs <project-folder or transcript.json> [--top 15] [--json]");
    process.exit(2);
  }
  const file = fs.statSync(target).isDirectory() ? path.join(target, "transcript.json") : target;
  const transcript = JSON.parse(read(file));
  const jev = readJev(path.join(path.dirname(file), "hooks.live.jsonl"));
  const topArg = args.indexOf("--top");
  const top = topArg >= 0 ? Number(args[topArg + 1]) || 15 : 15;
  const hooks = findHooks(transcript.words ?? [], jev, top);
  if (args.includes("--json")) {
    console.log(JSON.stringify(hooks, null, 2));
    return;
  }
  if (!hooks.length) console.log("No spoken hook lines found. For music, streams or visual sources use hooks.live.jsonl and the contact sheets.");
  for (const h of hooks) {
    console.log(`${time(h.start)}–${time(h.end)}  score ${h.score}  ${h.hookType}  [${h.tags.join(", ")}]${h.jev ? `  Jev ${h.jev.score}` : ""}`);
    console.log(`  "${h.text}"`);
    for (const n of h.notes) console.log(`  ! ${n}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
