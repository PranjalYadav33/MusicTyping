import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Uses yt-dlp (Python module) to extract a direct audio URL from YouTube,
 * then proxies the audio stream back to the browser to avoid CORS issues.
 *
 * Simplified: no more `missing_pot`, no multi-format retry loop that hangs on Windows.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let binaryDlpPath = "";

async function ensureYtDlp(): Promise<string> {
  if (binaryDlpPath && fs.existsSync(binaryDlpPath)) return binaryDlpPath;

  const binDir = path.join(process.cwd(), ".bin");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const platform = os.platform();
  let binaryName = "yt-dlp";
  let downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

  if (platform === "win32") {
    binaryName = "yt-dlp.exe";
    downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  } else if (platform === "darwin") {
    binaryName = "yt-dlp_macos";
    downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }

  const binaryPath = path.join(binDir, binaryName);

  if (fs.existsSync(binaryPath)) {
    binaryDlpPath = binaryPath;
    return binaryPath;
  }

  console.log(`Downloading yt-dlp from ${downloadUrl}...`);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error("Failed to download yt-dlp: " + res.statusText);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(binaryPath, buffer);
  if (platform !== "win32") fs.chmodSync(binaryPath, 0o755);
  
  console.log("yt-dlp downloaded to", binaryPath);
  binaryDlpPath = binaryPath;
  return binaryPath;
}

type ExtractResult = {
  url: string;
  ext: string;
  format_id: string;
  headers: Record<string, string>;
};

async function extractAudioUrl(videoId: string): Promise<ExtractResult> {
  const binaryPath = await ensureYtDlp();

  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
      "-J",
      "--no-warnings",
      "--skip-download",
      "--no-playlist",
      "--format", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
      ytUrl
    ];

    const proc = spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c: string) => (stdout += c));
    proc.stderr.on("data", (c: string) => (stderr += c));

    proc.on("error", (err) => reject(new Error(`Failed to spawn python: ${err.message}`)));

    proc.on("close", (code) => {
      if (code !== 0) {
        let msg = "yt-dlp extraction failed";
        try {
          const parsed = JSON.parse(stderr);
          msg = parsed.error || msg;
        } catch {
          msg = stderr.trim() || msg;
        }
        reject(new Error(msg));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const data: ExtractResult = {
          url: parsed.url,
          ext: parsed.ext || "webm",
          format_id: parsed.format_id,
          headers: parsed.http_headers || {},
        };
        if (!data.url) {
          reject(new Error("No audio URL returned by yt-dlp"));
          return;
        }
        resolve(data);
      } catch {
        reject(new Error(`Failed to parse yt-dlp output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

function getContentType(ext?: string): string {
  switch (ext) {
    case "webm":
    case "opus":
      return "audio/webm";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    default:
      return "audio/webm";
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("id");

  if (!videoId) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }

  try {
    const extracted = await extractAudioUrl(videoId);

    // Build headers for the upstream fetch
    const upstreamHeaders = new Headers();

    // Forward extractor headers (User-Agent, etc.) but skip host/content-length
    for (const [key, value] of Object.entries(extracted.headers)) {
      const lower = key.toLowerCase();
      if (lower !== "host" && lower !== "content-length") {
        upstreamHeaders.set(key, value);
      }
    }

    // Forward range header from client if present
    const clientRange = req.headers.get("range");
    if (clientRange) {
      upstreamHeaders.set("Range", clientRange);
    }

    const upstream = await fetch(extracted.url, {
      headers: upstreamHeaders,
      redirect: "follow",
      cache: "no-store",
    });

    if (!upstream.ok && upstream.status !== 206) {
      const body = await upstream.text().catch(() => "");
      throw new Error(`Upstream returned ${upstream.status}: ${body.slice(0, 200)}`);
    }

    // Build response headers
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") || getContentType(extracted.ext),
      "Access-Control-Allow-Origin": "*",
    });

    // Pass through useful headers
    for (const h of ["accept-ranges", "content-length", "content-range", "etag"]) {
      const val = upstream.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to stream audio";
    console.error("[stream] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
