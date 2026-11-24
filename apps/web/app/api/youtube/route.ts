import { fetchYouTubeMeta } from "@oneclip/core";
import { errorText, guard, json } from "@/lib/server";

/** Title, channel and thumbnail preview via YouTube's public oEmbed endpoint (the download itself runs in the analyze job). */
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
