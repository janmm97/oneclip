/** Browser-safe: the content types and what the best clip is for each. */
/**
 * What kind of source this is, and what "the best part" means for it. Jev
 * gets the guide with every candidate, so a music video's skit isn't judged
 * like a podcast's story.
 */
export const CONTENT_TYPES = {
  music_video: {
    label: "Music video",
    share: 0.6,
    guide:
      "A music video. The best clip is the song at its peak: the chorus or hook line, the drop or the most memorable sung line, ideally with striking footage. Spoken skits, intros, outros, credits and dialogue before or after the song are not the song: score them low on hook strength and editing suitability unless they are exceptional on their own.",
  },
  song: {
    label: "Song",
    share: 0.6,
    guide:
      "A song (audio, lyric or visualizer video). The best clip is the chorus, the hook line or the drop; verses, long instrumental intros and fade-outs are weaker. Judge mostly by the sound and the lyric.",
  },
  podcast: {
    label: "Podcast or interview",
    share: 0.15,
    guide:
      "A podcast or interview. The best clip is a complete, quotable exchange: a strong opinion, a story with a payoff, a surprising fact or a funny moment. Intros, greetings, sponsor reads, housekeeping and outros are never the best clip.",
  },
  talk: {
    label: "Talk, lecture or tutorial",
    share: 0.1,
    guide:
      "A talk, lecture, sermon or tutorial. The best clip is one self-contained idea with a clear point: a bold claim, a vivid example or a practical tip. Greetings, agendas, thank-yous and logistics are weak.",
  },
  stream: {
    label: "Live stream",
    share: 0.5,
    guide:
      "A live stream or VOD. The best clip is a peak moment: a big reaction (shouting, laughter), a clutch play, a funny exchange, a surprise. Waiting, setup, reading chat and 'starting soon' screens are weak.",
  },
  gameplay: {
    label: "Gameplay",
    share: 0.6,
    guide:
      "Gameplay footage. The best clip is the action peak: a clutch play, a big win or fail, a boss kill or a surprise, ideally with a reaction. Menus, loading screens, tutorials and walking around are weak.",
  },
  film: {
    label: "Film, TV or sketch",
    share: 0.5,
    guide:
      "A film, TV, trailer or sketch scene. The best clip is a complete scene beat: a punchline, a reveal, a confrontation or a striking shot. Credits, logos and slow establishing shots are weak.",
  },
  vlog: {
    label: "Vlog",
    share: 0.3,
    guide:
      "A vlog. The best clip is a moment with a story or a reaction: something surprising, funny or emotional, or a clear tip. Greetings, 'subscribe' asks and transitions are weak.",
  },
  sports: {
    label: "Sports",
    share: 0.6,
    guide:
      "Sports footage. The best clip is the play itself: a goal, a knockout, a clutch shot, with the crowd or commentary peaking. Pre-game talk, stoppages and repeated replays are weak.",
  },
  footage: {
    label: "Footage",
    share: 1,
    guide: "Footage carried by the picture (b-roll, timelapse, drone, nature, product). The best clip is the most striking, fastest-changing or most beautiful stretch.",
  },
} as const;

export type ContentType = keyof typeof CONTENT_TYPES;
export const CONTENT_TYPE_KEYS = Object.keys(CONTENT_TYPES) as [ContentType, ...ContentType[]];
