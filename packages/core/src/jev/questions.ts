import type { JevQuestion } from "../one/client.ts";

/** Weights from the OneClip spec. Context integrity is a gate, not a weight. They sum to 1. */
export const WEIGHTS = {
  hookStrength: 0.25,
  standaloneClarity: 0.2,
  narrativePayoff: 0.2,
  novelty: 0.15,
  emotionalEngagement: 0.1,
  editingSuitability: 0.1,
} as const;

export type Dimension = keyof typeof WEIGHTS;

export const HOOK_TYPES = {
  curiosity: "Opens a question or gap the viewer wants closed",
  contrarian: "Challenges a common belief or says the opposite of what people expect",
  surprising: "Leads with a surprising fact, number or result",
  emotional_stakes: "Puts something the speaker or viewer cares about at risk",
  storytelling: "Drops the viewer into a story or scene",
  practical_value: "Promises a concrete tip, method or takeaway",
  problem_solution: "Names a problem and signals a fix is coming",
  unexpected_revelation: "Reveals a hidden truth, confession or behind-the-scenes fact",
  sonic_drop: "The sound grabs you: a beat drop, chorus, hit, riff or sudden change in the music or audio",
  visual_spectacle: "The picture grabs you: a striking image, reveal, fast cuts, motion or a scene that demands a look",
  none: "No clear hook: starts mid-thought, with filler or with setup, and nothing in the sound or picture stands out",
} as const;

export type HookType = keyof typeof HOOK_TYPES;

const five = (low: string, mid: string, high: string) => [low, `Between: ${low.toLowerCase()} / ${mid.toLowerCase()}`, mid, `Between: ${mid.toLowerCase()} / ${high.toLowerCase()}`, high];

/** One request per candidate carries all questions, so Jev reads the transcript once. */
export const QUESTIONS: Record<Dimension | "contextIntegrity" | "hookType", JevQuestion> = {
  hookStrength: {
    type: "score",
    instructions:
      "You are judging a short-form video clip (TikTok/Shorts/Reels). How strongly does the OPENING (first ~3 seconds) make a scrolling viewer stop and keep watching? Count everything that hooks: the words, the sound (a drop, a chorus, a hit, a sudden change) and the picture (a striking image, a reveal, a cut). Clips with no words can score high on sound or picture alone.",
    criteria: five(
      "Weak: filler, greeting, setup, mid-sentence start, or a flat sound and still picture; nothing makes you stop",
      "Moderate: somewhat interesting opening but easy to scroll past",
      "Strong: the first words, sound or picture create an immediate reason to keep watching",
    ),
  },
  standaloneClarity: {
    type: "score",
    instructions: "Can a viewer who has never seen the full source understand or enjoy this clip on its own?",
    criteria: five(
      "Confusing: depends on earlier context, unexplained references or pronouns",
      "Mostly clear with some gaps",
      "Fully self-contained and clear",
    ),
  },
  narrativePayoff: {
    type: "score",
    instructions: "Does the clip deliver on what its opening sets up (an answer, a point, a punchline, a resolution, a musical peak, a visual reveal) before it ends?",
    criteria: five("No payoff: it ends before the point lands", "Partial payoff", "Complete, satisfying payoff"),
  },
  novelty: {
    type: "score",
    instructions: "How fresh or non-obvious is the idea, fact, angle, sound or image in this clip for a general audience?",
    criteria: five("Generic or obvious", "Somewhat fresh", "Genuinely new or surprising"),
  },
  emotionalEngagement: {
    type: "score",
    instructions: "How much emotion (surprise, humour, tension, inspiration, empathy) does the clip evoke?",
    criteria: five("Flat, no emotion", "Some emotional pull", "Strong emotional pull"),
  },
  editingSuitability: {
    type: "score",
    instructions:
      "How well does this clip suit a vertical short: for speech, one speaker thread and quotable lines; for music, sound and footage, a clean phrase or scene with strong sound or picture?",
    criteria: five("Poor fit for a short", "Workable", "Ideal for a captioned vertical short"),
  },
  contextIntegrity: {
    type: "noul",
    instructions:
      "Does the clip start at the beginning of a thought and end at the end of a thought, without cutting a sentence, idea, musical phrase or scene in half, and without needing the preceding context to make sense?",
    criteria: { true: "Starts and ends cleanly with complete thoughts, phrases or scenes", false: "Cuts a thought or needs missing context" },
  },
  hookType: {
    type: "choice",
    instructions: "Which kind of hook does the clip's opening use (words, sound or picture)?",
    criteria: { ...HOOK_TYPES },
  },
};
