import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ─── Types ─── */
type LyricsResult = {
  syncedLyrics?: string;
  plainLyrics?: string;
  wordByWordLyrics?: string;
  source: string;
};

/* ═══════════════════════════════════════════════════════
   Provider: Musixmatch (word-by-word + synced LRC)
   - uses the desktop web-app API, same as BetterLyrics
   ═══════════════════════════════════════════════════════ */

let mxmToken: string | null = null;
let mxmCookies: { key: string; value: string }[] = [];

const MXM_ROOT = "https://apic-desktop.musixmatch.com/ws/1.1/";
const MXM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.musixmatch.com",
  Referer: "https://www.musixmatch.com/",
};

async function mxmFetch(action: string, params: [string, string][]): Promise<any> {
  const url = new URL(MXM_ROOT + action);
  params.push(["app_id", "web-desktop-app-v1.0"]);
  if (mxmToken && action !== "token.get") {
    params.push(["usertoken", mxmToken]);
  }
  params.push(["t", Date.now().toString()]);
  for (const [k, v] of params) url.searchParams.set(k, v);

  const headers: Record<string, string> = { ...MXM_HEADERS };
  if (mxmCookies.length > 0) {
    headers["Cookie"] = mxmCookies.map((c) => `${c.key}=${c.value}`).join("; ");
  }

  let response = await fetch(url.toString(), { headers, redirect: "manual" });

  // Handle redirects (Musixmatch sends 301/302 chains)
  let redirects = 0;
  while ((response.status === 301 || response.status === 302) && redirects < 5) {
    const setCookies = response.headers.get("set-cookie");
    if (setCookies) {
      for (const part of setCookies.split(",")) {
        const idx = part.indexOf("=");
        if (idx > -1) {
          mxmCookies.push({
            key: part.substring(0, idx).trim(),
            value: part.substring(idx + 1).split(";")[0],
          });
        }
      }
    }
    const loc = response.headers.get("location");
    if (!loc) break;
    const nextUrl = loc.startsWith("http") ? loc : `https://apic-desktop.musixmatch.com${loc}`;
    response = await fetch(nextUrl, { headers, redirect: "manual" });
    redirects++;
  }

  return response.json();
}

async function ensureMxmToken(): Promise<boolean> {
  if (mxmToken) return true;
  try {
    const data = await mxmFetch("token.get", [["user_language", "en"]]);
    if (data?.message?.header?.status_code === 200 && data?.message?.body?.user_token) {
      mxmToken = data.message.body.user_token;
      return true;
    }
  } catch (err) {
    console.error("[lyrics] Musixmatch token error:", err);
  }
  return false;
}

function formatMxmTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

async function searchMusixmatch(
  track: string,
  artist: string,
  album?: string
): Promise<LyricsResult | null> {
  if (!(await ensureMxmToken())) return null;

  const query: [string, string][] = [
    ["q_track", track],
    ["q_artist", artist],
    ["page_size", "1"],
    ["page", "1"],
  ];
  if (album) query.push(["q_album", album]);

  try {
    const matchData = await mxmFetch("matcher.track.get", query);
    if (matchData?.message?.header?.status_code === 401) {
      mxmToken = null; // token expired
      return null;
    }
    if (matchData?.message?.header?.status_code !== 200) return null;

    const trackInfo = matchData.message.body.track;
    const trackId = trackInfo.track_id;
    const hasRichSync = trackInfo.has_richsync;
    const hasSubtitles = trackInfo.has_subtitles;

    let syncedLyrics: string | undefined;
    let wordByWordLyrics: string | undefined;

    // Get standard synced LRC
    if (hasSubtitles) {
      try {
        const subData = await mxmFetch("track.subtitle.get", [
          ["track_id", String(trackId)],
          ["subtitle_format", "lrc"],
        ]);
        if (subData?.message?.body?.subtitle?.subtitle_body) {
          syncedLyrics = subData.message.body.subtitle.subtitle_body;
        }
      } catch {}
    }

    // Get word-by-word rich sync
    if (hasRichSync) {
      try {
        const richData = await mxmFetch("track.richsync.get", [["track_id", String(trackId)]]);
        if (
          richData?.message?.header?.status_code === 200 &&
          richData?.message?.body?.richsync?.richsync_body
        ) {
          const richBody = JSON.parse(richData.message.body.richsync.richsync_body);
          let lrc = "";
          for (const item of richBody) {
            lrc += `[${formatMxmTime(item.ts)}] `;
            for (const w of item.l) {
              lrc += `<${formatMxmTime(item.ts + w.o)}> ${w.c} `;
            }
            lrc += `<${formatMxmTime(item.te)}>\n`;
          }
          wordByWordLyrics = lrc;
        }
      } catch {}
    }

    if (syncedLyrics || wordByWordLyrics) {
      return {
        syncedLyrics,
        wordByWordLyrics,
        source: "musixmatch",
      };
    }
  } catch (err) {
    console.error("[lyrics] Musixmatch search error:", err);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════
   Provider: LRCLIB (community synced lyrics)
   ═══════════════════════════════════════════════════════ */

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

async function searchLrclibPlain(track: string): Promise<LyricsResult | null> {
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(track)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "MusicType/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

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

/* ═══════════════════════════════════════════════════════
   Provider: lyrics.ovh (plain lyrics fallback)
   ═══════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════
   GET handler
   ═══════════════════════════════════════════════════════ */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const track = searchParams.get("track_name")?.trim() || "";
  const artist = searchParams.get("artist_name")?.trim() || "";
  const album = searchParams.get("album_name")?.trim() || "";
  const provider = searchParams.get("provider")?.trim() || "auto";

  if (!track) {
    return NextResponse.json({ error: "Missing track_name" }, { status: 400 });
  }

  // ── Specific provider requested ──
  if (provider === "musixmatch") {
    const result = await searchMusixmatch(track, artist, album || undefined);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: "Lyrics not found" }, { status: 404 });
  }

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

  // ── Auto: try all providers in priority order ──
  // 1. Musixmatch first (best quality: word-by-word sync + standard LRC)
  // 2. LRCLIB exact match
  // 3. LRCLIB search
  // 4. LRCLIB broad search
  // 5. lyrics.ovh plain fallback
  const providers = [
    () => searchMusixmatch(track, artist, album || undefined),
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
