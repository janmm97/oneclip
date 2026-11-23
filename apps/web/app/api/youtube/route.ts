import { fetchYouTubeMeta } from "@oneclip/core";
import { errorText, guard, json } from "@/lib/server";

/** Title, channel and thumbnail via YouTube's public oEmbed endpoint. Never downloads the video. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    const { url } = (await req.json()) as { url?: unknown };
    return json(await fetchYouTubeMeta(String(url ?? "")));
  } catch (e) {
    return json({ error: errorText(e) }, 400);
  }
}
