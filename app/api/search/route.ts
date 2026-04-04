import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchSong = {
  videoId: string;
  name: string;
  artistName: string;
  duration: number;
  thumbnail: string;
  source: "ytmusic" | "youtube";
};

/* ─── ytmusic-api (primary) ─── */

let ytmusicInstance: any = null;
let ytmusicInitPromise: Promise<any> | null = null;

async function getYtMusicApi() {
  if (ytmusicInstance) return ytmusicInstance;

  if (!ytmusicInitPromise) {
    ytmusicInitPromise = (async () => {
      try {
        const YTMusic = (await import("ytmusic-api")).default;
        const api = new YTMusic();
        await api.initialize();
        ytmusicInstance = api;
        return api;
      } catch (err) {
        ytmusicInitPromise = null; // allow retry
        throw err;
      }
    })();
  }

  return ytmusicInitPromise;
}

async function searchWithYtMusic(q: string): Promise<SearchSong[]> {
  const api = await getYtMusicApi();
  const results = await api.searchSongs(q);

  return results
    .filter((song: any) => song.videoId)
    .slice(0, 20)
    .map((song: any) => ({
      videoId: song.videoId,
      name: song.name || "Unknown Title",
      artistName:
        song.artist?.name ||
        (Array.isArray(song.artists) ? song.artists[0]?.name : null) ||
        "Unknown Artist",
      duration: song.duration || 0,
      thumbnail: song.thumbnails?.[0]?.url || "",
      source: "ytmusic" as const,
    }));
}

/* ─── play-dl (fallback) ─── */

async function searchWithPlayDl(q: string): Promise<SearchSong[]> {
  const play = (await import("play-dl")).default;

  const videos = await play.search(q, {
    source: { youtube: "video" },
    limit: 20,
  });

  return videos
    .filter((v: any) => v.id && v.title)
    .map((v: any) => ({
      videoId: v.id!,
      name: v.title!,
      artistName: v.channel?.name || "Unknown Artist",
      duration: v.durationInSec || 0,
      thumbnail: v.thumbnails?.[0]?.url || "",
      source: "youtube" as const,
    }));
}

/* ─── GET handler ─── */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  // Try ytmusic-api first
  try {
    const primary = await searchWithYtMusic(q);
    if (primary.length > 0) {
      return NextResponse.json({ results: primary, provider: "ytmusic" });
    }
  } catch (err) {
    console.error("[search] ytmusic-api failed, falling back:", err instanceof Error ? err.message : err);
  }

  // Fallback to play-dl YouTube search
  try {
    const fallback = await searchWithPlayDl(q);
    return NextResponse.json({ results: fallback, provider: "youtube" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Search failed";
    console.error("[search] All providers failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
