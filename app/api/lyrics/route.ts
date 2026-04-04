import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ─── Types ─── */
type LyricsResult = {
  syncedLyrics?: string;
  plainLyrics?: string;
  source: string;
};

/* ─── Provider 1: LRCLIB (best for synced lyrics) ─── */
async function searchLrclib(track: string, artist: string): Promise<LyricsResult | null> {
  const strategies = [
    artist
      ? `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`
      : null,
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent(`${track} ${artist}`.trim())}`,
  ].filter(Boolean) as string[];

  for (const url of strategies) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "MusicType/1.0 (https://github.com/musictype)" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const synced = data.find((d: any) => d.syncedLyrics);
      const best = synced || data[0];
      if (best.syncedLyrics || best.plainLyrics) {
        return {
          syncedLyrics: best.syncedLyrics || undefined,
          plainLyrics: best.plainLyrics || undefined,
          source: "lrclib",
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/* ─── Provider 2: lyrics.ovh (plain lyrics fallback) ─── */
async function searchLyricsOvh(track: string, artist: string): Promise<LyricsResult | null> {
  if (!artist) return null;
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.lyrics) {
      return { plainLyrics: data.lyrics, source: "lyrics.ovh" };
    }
  } catch {}
  return null;
}

/* ─── Provider 3: LRCLIB get endpoint (exact match) ─── */
async function getLrclibExact(track: string, artist: string): Promise<LyricsResult | null> {
  if (!artist) return null;
  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "MusicType/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.syncedLyrics || data.plainLyrics) {
      return {
        syncedLyrics: data.syncedLyrics || undefined,
        plainLyrics: data.plainLyrics || undefined,
        source: "lrclib-exact",
      };
    }
  } catch {}
  return null;
}

/* ─── Provider 4: Netease / plain search fallback ─── */
async function searchLrclibPlain(track: string): Promise<LyricsResult | null> {
  // A broader search using only the track title, returning any match
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(track)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "MusicType/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // Score results by track name similarity
    const scored = data
      .filter((d: any) => d.syncedLyrics || d.plainLyrics)
      .map((d: any) => {
        const nameSim = d.trackName?.toLowerCase().includes(track.toLowerCase()) ? 2 : 0;
        const hasSynced = d.syncedLyrics ? 3 : 0;
        return { ...d, score: nameSim + hasSynced };
      })
      .sort((a: any, b: any) => b.score - a.score);

    if (scored.length > 0) {
      return {
        syncedLyrics: scored[0].syncedLyrics || undefined,
        plainLyrics: scored[0].plainLyrics || undefined,
        source: "lrclib-broad",
      };
    }
  } catch {}
  return null;
}

/* ─── GET handler ─── */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const track = searchParams.get("track_name")?.trim() || "";
  const artist = searchParams.get("artist_name")?.trim() || "";
  const provider = searchParams.get("provider")?.trim() || "auto";

  if (!track) {
    return NextResponse.json({ error: "Missing track_name" }, { status: 400 });
  }

  // If a specific provider is requested, use only that one
  if (provider === "lrclib-exact") {
    const result = await getLrclibExact(track, artist);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: "Lyrics not found" }, { status: 404 });
  }

  if (provider === "lrclib") {
    const result = await searchLrclib(track, artist);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: "Lyrics not found" }, { status: 404 });
  }

  if (provider === "lyrics.ovh") {
    const result = await searchLyricsOvh(track, artist);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: "Lyrics not found" }, { status: 404 });
  }

  // Auto: try all providers in order of preference
  const providers = [
    () => getLrclibExact(track, artist),
    () => searchLrclib(track, artist),
    () => searchLrclibPlain(track),
    () => searchLyricsOvh(track, artist),
  ];

  for (const p of providers) {
    const result = await p();
    if (result) return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Lyrics not found" }, { status: 404 });
}
