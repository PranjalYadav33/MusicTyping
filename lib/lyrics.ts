export interface WordToken {
  word: string;         // the word text (no timestamp)
  startTime: number;   // seconds when this word starts
  endTime: number;     // seconds when this word ends (= next word start)
  charStart: number;   // index in the full line string
  charEnd: number;
}

export interface LyricLine {
  time: number;           // line start in seconds
  endTime: number;        // line end in seconds (= next line start, or Infinity)
  words: string;          // full line text
  wordTokens: WordToken[]; // word-level timing (estimated or precise)
}

/* ────────────────────────────────────────────────────────
   Parse Enhanced LRC / A2 extension (word-level timestamps)
   Format:  [mm:ss.xx] <word1> [mm:ss.xx] <word2> ...
   OR plain: [mm:ss.xx] full line text
   ───────────────────────────────────────────────────────── */
const TIME_RE = /\[(\d+):(\d+\.\d+)\]/g;
const WORD_TS_RE = /\[(\d+):(\d+\.\d+)\]\s*([^\[]*)/g;

function toSeconds(m: string, s: string) {
  return parseInt(m, 10) * 60 + parseFloat(s);
}

function hasWordTimestamps(text: string): boolean {
  // A2-style: multiple timestamps in one line
  const matches = text.match(TIME_RE);
  return !!(matches && matches.length > 1);
}

function parseWordTimestamps(rawLine: string, lineStart: number): WordToken[] {
  const tokens: WordToken[] = [];
  let match: RegExpExecArray | null;
  WORD_TS_RE.lastIndex = 0;

  while ((match = WORD_TS_RE.exec(rawLine)) !== null) {
    const t = toSeconds(match[1], match[2]);
    const word = match[3].trim();
    if (word) {
      tokens.push({
        word,
        startTime: t,
        endTime: Infinity,   // filled in below
        charStart: 0,
        charEnd: 0,
      });
    }
  }

  // Fill endTime = next word's startTime
  for (let i = 0; i < tokens.length - 1; i++) {
    tokens[i].endTime = tokens[i + 1].startTime;
  }

  // Rebuild charStart/charEnd from the joined text
  let cursor = 0;
  const joined = tokens.map((t) => t.word).join(" ");
  for (const tok of tokens) {
    tok.charStart = cursor;
    tok.charEnd = cursor + tok.word.length;
    cursor += tok.word.length + 1; // +1 for space
  }

  return tokens;
}

/**
 * Given a plain line & its duration, distribute word timings proportionally
 * to word length (longer words get more time). This is the best heuristic
 * when no per-word timestamps are available.
 */
function estimateWordTimings(
  words: string,
  lineStart: number,
  lineDuration: number
): WordToken[] {
  const wordList = words.split(/\s+/).filter(Boolean);
  if (wordList.length === 0) return [];

  // Weight by char count (proxy for syllable count)
  const totalChars = wordList.reduce((s, w) => s + w.length, 0) || 1;
  const tokens: WordToken[] = [];
  let t = lineStart;
  let cursor = 0;

  for (const w of wordList) {
    const frac = w.length / totalChars;
    const dur = lineDuration * frac;
    const start = t;
    const end = t + dur;
    t = end;

    tokens.push({
      word: w,
      startTime: start,
      endTime: end,
      charStart: cursor,
      charEnd: cursor + w.length,
    });
    cursor += w.length + 1;
  }

  // Fix last token end
  if (tokens.length > 0) {
    tokens[tokens.length - 1].endTime = lineStart + lineDuration;
  }

  return tokens;
}

/* ────────────────────────────────────────────────────────
   Main parser
   ───────────────────────────────────────────────────────── */
export function parseSyncedLyrics(lrc: string): LyricLine[] {
  if (!lrc) return [];

  const rawLines = lrc.split("\n");
  const parsed: LyricLine[] = [];
  const lineTimeRe = /^\[(\d+):(\d+\.\d+)\](.*)/;

  for (const raw of rawLines) {
    const m = lineTimeRe.exec(raw.trim());
    if (!m) continue;

    const t = toSeconds(m[1], m[2]);
    const rest = m[3].trim();
    if (!rest) continue; // skip empty timestamp lines

    const useWordTs = hasWordTimestamps(rest);

    parsed.push({
      time: t,
      endTime: Infinity,   // filled below
      words: useWordTs
        ? rest.replace(TIME_RE, "").replace(/\s+/g, " ").trim()
        : rest,
      wordTokens: useWordTs ? parseWordTimestamps(rest, t) : [],
    });
  }

  parsed.sort((a, b) => a.time - b.time);

  // Fill endTime and estimate word timings for lines without word timestamps
  for (let i = 0; i < parsed.length; i++) {
    const line = parsed[i];
    const nextTime = parsed[i + 1]?.time ?? line.time + 8; // 8s fallback
    line.endTime = nextTime;

    if (line.wordTokens.length === 0) {
      line.wordTokens = estimateWordTimings(
        line.words,
        line.time,
        nextTime - line.time
      );
    } else {
      // Fix last word endTime using line endTime
      const last = line.wordTokens[line.wordTokens.length - 1];
      if (!isFinite(last.endTime)) last.endTime = nextTime;
    }
  }

  return parsed;
}
