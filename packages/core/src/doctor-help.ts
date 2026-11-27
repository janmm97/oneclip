/** Plain-words help for each setup check: why it matters, one command for this OS, and what success looks like. */
export interface CheckHelp {
  why: string;
  /** One command to paste in a terminal; missing when the fix isn't a command. */
  command?: string;
  done: string;
}

type Os = "win" | "mac" | "linux";
const osOf = (platform: string): Os => (platform === "win32" ? "win" : platform === "darwin" ? "mac" : "linux");

export function checkHelp(id: string, platform: string, python = "python"): CheckHelp | undefined {
  const os = osOf(platform);
  const pick = (c: Record<Os, string>) => c[os];
  switch (id) {
    case "node":
      return { why: "OneClip runs on Node.js. It needs version 22.13 or newer.", command: pick({ win: "winget install OpenJS.NodeJS.LTS", mac: "brew install node", linux: "sudo apt install nodejs" }), done: "Open a new terminal: node -v shows v22.13 or higher." };
    case "ffmpeg":
      return { why: "FFmpeg cuts and resizes the video. Nothing can be made without it.", command: pick({ win: "winget install Gyan.FFmpeg", mac: "brew install ffmpeg", linux: "sudo apt install ffmpeg" }), done: "Open a new terminal: ffmpeg -version prints a version." };
    case "libass":
      return { why: "Lets the Simple caption style burn subtitles into the video. The Animated style works without it.", command: pick({ win: "winget install Gyan.FFmpeg", mac: "brew reinstall ffmpeg", linux: "sudo apt install ffmpeg" }), done: "Check again shows this line in All good." };
    case "one-cli":
      return { why: "OneClip talks to Jev, the clip judge, through the One CLI.", command: "npm install -g @withone/cli", done: "Open a new terminal: one --version prints a version." };
    case "one-auth":
      return { why: "The One CLI needs your account to reach Jev.", command: "one init", done: "one whoami shows your name." };
    case "typesafe":
      return { why: "Jev lives in TypeSafe. Connect it once to your One account.", command: "one add typesafe", done: "one list shows a typesafe connection." };
    case "jev-action":
    case "jev-call":
      return { why: "OneClip asks Jev which moments are worth posting.", command: "npm install -g @withone/cli", done: "Check again (or Test the clip judge) shows this line in All good." };
    case "yt-dlp":
      return { why: "Needed to fetch YouTube and other links. Videos already on this computer work without it.", command: `${python} -m pip install -U "yt-dlp[default]"`, done: "yt-dlp --version prints a date." };
    case "transcriber":
      return { why: "Turns the speech into words so OneClip can find the good parts and write subtitles.", command: "pnpm run setup", done: "Check again shows this line in All good." };
    case "planner":
      return { why: "An AI helper plans smarter edits. Without one, OneClip uses its basic plan.", command: "one add open-router", done: "Check again shows a name other than template." };
    case "remotion":
      return { why: "Draws the Animated caption style. The Simple style works without it.", command: "pnpm install", done: "Check again shows this line in All good." };
    default:
      return undefined;
  }
}
