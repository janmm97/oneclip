/**
 * YouTube links are used for metadata only (title, channel, thumbnail via
 * oEmbed). OneClip never downloads from YouTube: the user supplies a local
 * copy they are authorised to use.
 */

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);
const ID = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!HOSTS.has(url.hostname.toLowerCase())) return undefined;
  let id: string | undefined;
  if (url.hostname.toLowerCase() === "youtu.be") id = url.pathname.split("/")[1];
  else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? undefined;
  else {
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    id = m?.[1];
  }
  return id && ID.test(id) ? id : undefined;
}

export interface YouTubeMeta {
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnailUrl: string;
}

export async function fetchYouTubeMeta(input: string, fetchImpl: typeof fetch = fetch): Promise<YouTubeMeta> {
  const videoId = extractYouTubeId(input);
  if (!videoId) throw new Error("That doesn't look like a YouTube video link.");
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error("This video is private or embedding is disabled, so its details can't be read.");
  if (res.status === 404 || res.status === 400) throw new Error("YouTube couldn't find this video.");
  if (!res.ok) throw new Error(`YouTube oEmbed returned ${res.status}.`);
  const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  return { videoId, url, title: String(j.title ?? "Untitled"), author: String(j.author_name ?? ""), thumbnailUrl: String(j.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`) };
}
