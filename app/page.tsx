"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { parseSyncedLyrics, LyricLine, WordToken } from "@/lib/lyrics";
import {
  Search, Keyboard, Music2, Loader2, Play, Pause,
  SkipForward, RotateCcw, ChevronDown, BarChart3, RefreshCw,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";

/* ─────────────────────────────────────────
   TYPES
───────────────────────────────────────── */
type SearchSong = {
  videoId: string;
  name: string;
  artistName: string;
  duration: number;
  thumbnail: string;
  source: "ytmusic" | "youtube";
};

type LyricsProvider = "auto" | "lrclib" | "lrclib-exact" | "lyrics.ovh";

type WordResult = {
  word: string;
  typed: string;
  correct: boolean;
  wpm: number;        // WPM at the moment this word was completed
  time: number;       // audio time when completed
  lineIdx: number;
};

/* Per-second typing metrics for graph */
type SecondMetric = {
  second: number;
  wpm: number;
  accuracy: number;
  errors: number;
};

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const PROVIDERS: { id: LyricsProvider; label: string }[] = [
  { id: "auto", label: "auto" },
  { id: "lrclib", label: "lrclib" },
  { id: "lrclib-exact", label: "lrclib exact" },
  { id: "lyrics.ovh", label: "lyrics.ovh" },
];

/* ─────────────────────────────────────────
   RESULTS SCREEN (ENHANCED UI/UX)
───────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1e1e1e]/90 backdrop-blur-md border border-[#3a3c3f] p-4 rounded-xl shadow-2xl">
        <p className="text-[#646669] text-xs font-semibold mb-3 tracking-widest uppercase">{label}</p>
        <div className="flex flex-col gap-2">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-6 text-sm font-medium">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: entry.color, boxShadow: `0 0 8px ${entry.color}` }} />
                <span style={{ color: entry.color }} className="capitalize">{entry.name}:</span>
              </div>
              <span className="text-[#d1d0c5] tabular-nums text-right">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const DistTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-[#1e1e1e]/90 backdrop-blur border border-[#3a3c3f] px-3 py-2 rounded-lg shadow-xl">
        <div className="text-[#d1d0c5] text-xs font-medium">
          <span style={{ color: data.fill }}>{data.wpmAt}</span> wpm
        </div>
        <div className="text-[#646669] text-xs">
          Hit <span className="text-[#d1d0c5] font-semibold">{data.count}</span> times
        </div>
      </div>
    );
  }
  return null;
};

function ResultsScreen({
  song,
  wordResults,
  metrics,
  usedAutoPilot,
  onRetry,
  onNew,
}: {
  song: SearchSong;
  wordResults: WordResult[];
  metrics: SecondMetric[];
  usedAutoPilot: boolean;
  onRetry: () => void;
  onNew: () => void;
}) {
  const totalWords = wordResults.length;
  const correctWords = wordResults.filter((w) => w.correct).length;
  const totalChars = wordResults.reduce((s, w) => s + w.word.length, 0);
  const correctChars = wordResults.filter((w) => w.correct).reduce((s, w) => s + w.word.length, 0);
  const accuracy = totalChars > 0 ? Math.round((correctChars / totalChars) * 100) : 0;
  
  const wpmData = metrics.map((m) => m.wpm);
  const avgWpm = wordResults.length > 0
    ? Math.round(wordResults.reduce((s, w) => s + w.wpm, 0) / wordResults.length)
    : 0;
  const peakWpm = Math.max(...wordResults.map((w) => w.wpm), 0);

  // Consistency = 1 - (std_dev / mean) clamped
  const mean = avgWpm || 1;
  const variance = wpmData.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (wpmData.length || 1);
  const stdDev = Math.sqrt(variance);
  const consistency = Math.max(0, Math.round((1 - stdDev / mean) * 100));

  // Graph Data Formatter
  const chartData = metrics.map((m) => ({
    time: `${m.second}s`,
    wpm: m.wpm,
    accuracy: m.accuracy,
    errors: m.errors
  }));

  // WPM Distribution Data
  const buckets = 20;
  const minWpm = Math.min(...wpmData, 0);
  const maxWpm = Math.max(...wpmData, 60);
  const range = (maxWpm - minWpm) || 1;
  const distCounts = new Array(buckets).fill(0);
  wpmData.forEach(v => {
    const b = Math.min(Math.floor(((v - minWpm) / range) * buckets), buckets - 1);
    distCounts[b]++;
  });
  
  const distData = distCounts.map((c, i) => ({
    wpmAt: Math.round(minWpm + (i / buckets) * range),
    count: c,
    fill: `hsla(${43 + i * 2}, 80%, ${45 + i}%, 0.85)`
  }));

  const accColor = accuracy >= 90 ? "#7ec984" : accuracy >= 70 ? "#e2b714" : "#ca4343";

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-8 animate-in slide-in-from-bottom-8 fade-in duration-700 px-4 pb-20">
      
      {/* ── Header Card ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#2c2e31]/80 backdrop-blur-xl border border-[#3a3c3f]/50 p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-stretch gap-6 shadow-2xl">
        {song.thumbnail && (
          <div className="absolute top-0 right-0 bottom-0 w-1/2 opacity-10 pointer-events-none fade-mask-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        
        {song.thumbnail && (
          <div className="relative w-24 h-24 sm:w-32 sm:h-32 shrink-0 rounded-2xl overflow-hidden shadow-xl ring-1 ring-white/10 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={song.thumbnail} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
          </div>
        )}
        <div className="flex flex-col justify-center text-center sm:text-left z-10 flex-1">
          <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
            <div className="text-sm font-semibold tracking-widest uppercase" style={{ color: "#e2b714" }}>Result Summary</div>
            {usedAutoPilot && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#e2b714]/20 text-[#e2b714] border border-[#e2b714]/30 uppercase tracking-wider">
                Auto Pilot
              </span>
            )}
          </div>
          <div className="text-3xl sm:text-4xl font-black tracking-tight text-white mb-2 line-clamp-1">{song.name}</div>
          <div className="text-lg font-medium" style={{ color: "#a0a09b" }}>{song.artistName}</div>
        </div>
        <div className="flex sm:flex-col justify-center gap-3 z-10 w-full sm:w-auto mt-4 sm:mt-0">
          <button onClick={onRetry}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-xl font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "#2c2e31", color: "#d1d0c5", border: "1px solid #4a4c4f" }}>
            <RotateCcw size={16} /> Retry
          </button>
          <button onClick={onNew}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-sm px-6 py-3 rounded-xl font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-[#e2b714]/20"
            style={{ background: "#e2b714", color: "#1e1e1e" }}>
            <Search size={16} /> Next Song
          </button>
        </div>
      </div>

      {/* ── Main Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "WPM", value: avgWpm, color: "#e2b714" },
          { label: "Peak WPM", value: peakWpm, color: "#7ec984" },
          { label: "Accuracy", value: `${accuracy}%`, color: accColor },
          { label: "Consistency", value: `${consistency}%`, color: "#58c4f5" },
          { label: "Words Typed", value: `${correctWords}/${totalWords}`, color: "#d1d0c5" },
        ].map((s) => (
          <div key={s.label} className="relative rounded-2xl p-6 flex flex-col justify-center items-center text-center bg-[#2c2e31]/60 border border-[#3a3c3f]/50 backdrop-blur hover:bg-[#2c2e31] transition-colors group overflow-hidden">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500" style={{ background: `radial-gradient(circle at center, ${s.color} 0%, transparent 70%)` }} />
            <div className="text-4xl font-black mb-2 DropShadow-lg transition-transform duration-300 group-hover:scale-110" style={{ color: s.color, filter: `drop-shadow(0 0 12px ${s.color}40)` }}>
              {s.value}
            </div>
            <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#646669" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Performance Chart ── */}
      <div className="rounded-2xl p-6 sm:p-8 bg-[#2c2e31]/60 border border-[#3a3c3f]/50 backdrop-blur">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 pb-4 border-b border-[#3a3c3f]/30">
          <div className="flex items-center gap-3 text-lg font-bold" style={{ color: "#d1d0c5" }}>
            <BarChart3 className="text-[#e2b714]" size={22} />
            Performance Over Time
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm font-medium mt-4 sm:mt-0" style={{ color: "#a0a09b" }}>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm shadow-[0_0_8px_#e2b714]" style={{ background: "#e2b714" }} /> WPM</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm shadow-[0_0_8px_#7ec984]" style={{ background: "#7ec984" }} /> Accuracy %</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm shadow-[0_0_8px_#ca4343]" style={{ background: "#ca4343" }} /> Errors</span>
          </div>
        </div>
        
        {metrics.length < 2 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#646669] gap-4">
            <BarChart3 size={48} className="opacity-20" />
            <p className="font-medium tracking-wide">Not enough data to construct graph</p>
          </div>
        ) : (
          <div className="w-full h-[250px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorWpm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e2b714" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#e2b714" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7ec984" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#7ec984" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorErr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ca4343" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#ca4343" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#3a3c3f" vertical={false} opacity={0.5} />
                <XAxis 
                  dataKey="time" 
                  stroke="#646669" 
                  tick={{ fill: '#646669', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={false}
                  minTickGap={30}
                />
                <YAxis 
                  yAxisId="left" 
                  stroke="#646669" 
                  tick={{ fill: '#646669', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={false}
                  tickCount={6}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  stroke="#646669" 
                  tick={{ fill: '#646669', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={false}
                  domain={[0, 100]}
                  hide
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#646669', strokeWidth: 1, strokeDasharray: '4 4' }} />
                
                <Area yAxisId="left" type="monotone" dataKey="wpm" name="WPM" stroke="#e2b714" strokeWidth={3} fillOpacity={1} fill="url(#colorWpm)" activeDot={{ r: 6, fill: '#e2b714', stroke: '#1e1e1e', strokeWidth: 2 }} />
                <Area yAxisId="right" type="monotone" dataKey="accuracy" name="Accuracy" stroke="#7ec984" strokeWidth={2} fillOpacity={1} fill="url(#colorAcc)" activeDot={{ r: 5, fill: '#7ec984', stroke: '#1e1e1e', strokeWidth: 2 }} />
                <Area yAxisId="left" type="monotone" dataKey="errors" name="Errors" stroke="#ca4343" strokeWidth={2} fillOpacity={1} fill="url(#colorErr)" activeDot={{ r: 5, fill: '#ca4343', stroke: '#1e1e1e', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ── WPM Distribution ── */}
        {wpmData.length >= 5 && (
          <div className="rounded-2xl p-6 sm:p-8 bg-[#2c2e31]/60 border border-[#3a3c3f]/50 backdrop-blur w-full">
            <div className="text-lg font-bold mb-6 pb-4 border-b border-[#3a3c3f]/30" style={{ color: "#d1d0c5" }}>
              WPM Distribution
            </div>
            <div className="w-full h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distData} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                  <XAxis dataKey="wpmAt" stroke="#646669" tick={{ fill: '#646669', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis stroke="#646669" tick={{ fill: '#646669', fontSize: 11 }} tickLine={false} axisLine={false} tickCount={4} />
                  <Tooltip content={<DistTooltip />} cursor={{ fill: '#3a3c3f', opacity: 0.2 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {distData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── Error Heatmap ── */}
        {wordResults.filter((w) => !w.correct).length > 0 ? (
          <div className="rounded-2xl p-6 sm:p-8 bg-[#2c2e31]/60 border border-[#3a3c3f]/50 backdrop-blur w-full flex flex-col">
            <div className="text-lg font-bold mb-6 pb-4 border-b border-[#3a3c3f]/30 text-[#d1d0c5] flex items-center justify-between">
              Missed Words
              <span className="text-xs font-medium text-[#ca4343] bg-[#ca4343]/10 px-2 py-1 rounded-md">{wordResults.filter(w => !w.correct).length} total</span>
            </div>
            <div className="flex flex-wrap gap-2.5 overflow-y-auto pr-2 custom-scrollbar flex-1 max-h-[180px]">
              {wordResults.filter((w) => !w.correct).slice(0, 40).map((w, i) => (
                <div key={i} className="flex items-center text-[13px] px-3 py-1.5 rounded-lg bg-[#ca4343]/10 border border-[#ca4343]/30 text-[#ca4343] group transition-colors hover:bg-[#ca4343]/20">
                  <span className="opacity-60 line-through font-mono tracking-tight">{w.typed || "—"}</span>
                  <span className="mx-2 opacity-50 group-hover:translate-x-0.5 transition-transform">→</span>
                  <span className="font-semibold">{w.word}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl p-6 sm:p-8 bg-[#2c2e31]/60 border border-[#3a3c3f]/50 backdrop-blur w-full flex flex-col justify-center items-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#7ec984]/20 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7ec984" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <div className="text-xl font-bold text-[#7ec984] mb-1">Perfect Accuracy!</div>
            <div className="text-sm text-[#646669]">You didn't miss a single word.</div>
          </div>
        )}
      </div>

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════ */
export default function Home() {
  /* ── Search ── */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchSong[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ── Player ── */
  const [activeSong, setActiveSong] = useState<SearchSong | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [streamUrl, setStreamUrl] = useState("");
  const [songLoading, setSongLoading] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [lyricsProvider, setLyricsProvider] = useState<LyricsProvider>("auto");
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [lyricsSource, setLyricsSource] = useState("");
  const [isAutoPilot, setIsAutoPilot] = useState(false);

  /* ── Typing state ── */
  const [activeLineIdx, setActiveLineIdx] = useState(0);
  const [activeWordIdx, setActiveWordIdx] = useState(0); // index in current line's wordTokens
  const [typedBuffer, setTypedBuffer] = useState("");     // what the user has typed for current word
  const [wordResults, setWordResults] = useState<WordResult[]>([]);
  const [sessionMetrics, setSessionMetrics] = useState<SecondMetric[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [lastMetricSecond, setLastMetricSecond] = useState(-1);
  const [sessionErrors, setSessionErrors] = useState(0);
  const [usedAutoPilot, setUsedAutoPilot] = useState(false);
  const typingRef = useRef<HTMLInputElement>(null);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);

  // Use refs to avoid stale closure in keydown handler
  const activeLineIdxRef = useRef(0);
  const activeWordIdxRef = useRef(0);
  const typedBufferRef = useRef("");
  const lyricsRef = useRef<LyricLine[]>([]);
  const sessionStartTimeRef = useRef<number | null>(null);
  const wordResultsRef = useRef<WordResult[]>([]);
  const currentTimeRef = useRef(0);
  const sessionErrorsRef = useRef(0);
  const isAutoPilotRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { activeLineIdxRef.current = activeLineIdx; }, [activeLineIdx]);
  useEffect(() => { activeWordIdxRef.current = activeWordIdx; }, [activeWordIdx]);
  useEffect(() => { typedBufferRef.current = typedBuffer; }, [typedBuffer]);
  useEffect(() => { lyricsRef.current = lyrics; }, [lyrics]);
  useEffect(() => { sessionStartTimeRef.current = sessionStartTime; }, [sessionStartTime]);
  useEffect(() => { wordResultsRef.current = wordResults; }, [wordResults]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { sessionErrorsRef.current = sessionErrors; }, [sessionErrors]);
  useEffect(() => { isAutoPilotRef.current = isAutoPilot; }, [isAutoPilot]);

  /* ── View ── */
  const [showResults, setShowResults] = useState(false);

  /* ════════════════════════════════════════
     SEARCH LOGIC
  ════════════════════════════════════════ */
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearchLoading(false); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearchLoading(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
      const d = await r.json();
      if (!ctrl.signal.aborted) { setResults(d.results || []); setHoveredIdx(0); }
    } catch (e: any) {
      if (e.name !== "AbortError") console.error(e);
    } finally {
      if (!ctrl.signal.aborted) setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    debounceRef.current = setTimeout(() => doSearch(query), 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchOpen, doSearch]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 50);
    else { setQuery(""); setResults([]); }
  }, [searchOpen]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSearchOpen(v => !v); }
      if (e.key === "Escape") { setSearchOpen(false); setShowSpeedMenu(false); setShowProviderMenu(false); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const searchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHoveredIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHoveredIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[hoveredIdx]) playSong(results[hoveredIdx]);
  };

  /* ════════════════════════════════════════
     PLAYER LOGIC
  ════════════════════════════════════════ */
  const fetchLyrics = async (song: SearchSong, provider: LyricsProvider) => {
    const providerParam = provider !== "auto" ? `&provider=${provider}` : "";
    const lr = await fetch(
      `/api/lyrics?track_name=${encodeURIComponent(song.name)}&artist_name=${encodeURIComponent(song.artistName || "")}${providerParam}`
    );
    return lr.json();
  };

  const playSong = async (song: SearchSong, provider = lyricsProvider) => {
    setSearchOpen(false);
    setActiveSong(song);
    setLyrics([]);
    setStreamUrl("");
    setActiveLineIdx(0);
    setActiveWordIdx(0);
    setTypedBuffer("");
    setWordResults([]);
    setSessionMetrics([]);
    setSessionStartTime(null);
    setLastMetricSecond(-1);
    setSessionErrors(0);
    setUsedAutoPilot(isAutoPilot);
    setPlayerError("");
    setSongLoading(true);
    setIsPlaying(false);
    setShowResults(false);
    setLyricsSource("");

    try {
      setStreamUrl(`/api/stream?id=${song.videoId}`);
      const ld = await fetchLyrics(song, provider);
      if (ld.syncedLyrics) {
        const parsed = parseSyncedLyrics(ld.syncedLyrics).filter(l => l.words.trim());
        setLyrics(parsed);
        setLyricsSource(ld.source || "");
      } else if (ld.plainLyrics) {
        const lines = ld.plainLyrics.split("\n").filter((l: string) => l.trim())
          .map((l: string, i: number) => ({ time: i * 5, endTime: i * 5 + 5, words: l.trim(), wordTokens: [] }));
        const withTokens = parseSyncedLyrics(
          lines.map((l: LyricLine) => `[${Math.floor(l.time / 60)}:${(l.time % 60).toFixed(2)}] ${l.words}`).join("\n")
        );
        setLyrics(withTokens);
        setLyricsSource(ld.source || "");
      }
    } catch (err) {
      console.error(err);
      setPlayerError("Failed to load. Try another song.");
    } finally {
      setSongLoading(false);
    }
  };

  // Audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrentTime(a.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onDur = () => setDuration(a.duration || 0);
    const onCanPlay = () => setSongLoading(false);
    const onEnded = () => { setIsPlaying(false); setShowResults(true); };
    const onError = () => { setPlayerError("Stream failed. Try again."); setIsPlaying(false); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("canplay", onCanPlay);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
    };
  }, [streamUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !streamUrl) return;
    a.playbackRate = playbackSpeed;
    a.load();
    a.play().catch(() => {});
  }, [streamUrl]);

  // Keep playback speed in sync
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  /* ════════════════════════════════════════
     LINE SYNC — only track active line via audio time.
     Word advancement is driven by the USER pressing space, not by audio.
     This is critical: auto-advancing words would reset typedBuffer
     every fraction of a second, making typing impossible.
  ════════════════════════════════════════ */
  useEffect(() => {
    if (lyrics.length === 0) return;

    const lineIdx = lyrics.findIndex((l, i) => {
      const nextTime = lyrics[i + 1]?.time ?? Infinity;
      return currentTime >= l.time && currentTime < nextTime;
    });
    if (lineIdx === -1 || lineIdx === activeLineIdx) return;

    // New line started — reset word index and buffer
    setActiveLineIdx(lineIdx);
    setActiveWordIdx(0);
    setTypedBuffer("");
  }, [currentTime, lyrics.length, activeLineIdx]);

  // Scroll active line into view
  useEffect(() => {
    if (!lyricsScrollRef.current) return;
    const el = lyricsScrollRef.current.querySelector(`[data-line="${activeLineIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeLineIdx]);

  /* ════════════════════════════════════════
     METRICS (per-second accumulation)
  ════════════════════════════════════════ */
  useEffect(() => {
    if (!sessionStartTime || !isPlaying) return;
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    if (elapsed === lastMetricSecond) return;

    setLastMetricSecond(elapsed);
    const completed = wordResults.filter(w => w.time <= currentTime);
    const elapsedMin = elapsed / 60;
    const correctCount = completed.filter(w => w.correct).length;
    const wpm = elapsedMin > 0 ? Math.round(correctCount / elapsedMin) : 0;
    const acc = completed.length > 0
      ? Math.round(completed.filter(w => w.correct).length / completed.length * 100)
      : 100;

    setSessionMetrics(prev => [...prev, { second: elapsed, wpm, accuracy: acc, errors: sessionErrors }]);
  }, [currentTime, isPlaying, sessionStartTime, lastMetricSecond, wordResults, sessionErrors]);

  // Document-level keydown for reliable typing capture
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when search is open or typing in another input (except our hidden typing input)
      if (searchOpen) return;
      const targetTag = (e.target as HTMLElement)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') {
        if (e.target !== typingRef.current && e.target !== document.body) return;
      }
      if (!activeSong || songLoading || showResults) return;

      const line = lyricsRef.current[activeLineIdxRef.current];
      if (!line || line.wordTokens.length === 0) return;

      const wordToken = line.wordTokens[activeWordIdxRef.current];
      if (!wordToken) return;

      if (!sessionStartTimeRef.current) {
        const now = Date.now();
        sessionStartTimeRef.current = now;
        setSessionStartTime(now);
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        setTypedBuffer(prev => {
          const next = prev.slice(0, -1);
          typedBufferRef.current = next;
          return next;
        });
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        const typed = typedBufferRef.current;
        const targetWord = wordToken.word;
        const correct = typed.trim().toLowerCase() === targetWord.toLowerCase();

        if (!correct) {
          sessionErrorsRef.current += 1;
          setSessionErrors(n => n + 1);
        }

        const start = sessionStartTimeRef.current!;
        const elapsedMin = (Date.now() - start) / 1000 / 60;
        const prevCorrect = wordResultsRef.current.filter(w => w.correct).length + (correct ? 1 : 0);
        const wpm = elapsedMin > 0 ? Math.round(prevCorrect / 5 / elapsedMin) : 0;

        const result: WordResult = {
          word: targetWord,
          typed: typed.trim(),
          correct,
          wpm,
          time: currentTimeRef.current,
          lineIdx: activeLineIdxRef.current,
        };
        wordResultsRef.current = [...wordResultsRef.current, result];
        setWordResults(wordResultsRef.current);

        const nextWordIdx = activeWordIdxRef.current + 1;
        if (nextWordIdx < line.wordTokens.length) {
          activeWordIdxRef.current = nextWordIdx;
          setActiveWordIdx(nextWordIdx);
        }
        typedBufferRef.current = '';
        setTypedBuffer('');
        return;
      }

        // Printable character
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setTypedBuffer(prev => prev + e.key);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [searchOpen, activeSong, songLoading, showResults]);

  /* ════════════════════════════════════════
     AUTO PILOT LOGIC
  ════════════════════════════════════════ */
  useEffect(() => {
    if (!isAutoPilot || !isPlaying || !activeSong || songLoading || showResults) return;

    let frameId: number;

    const processAutoPilot = () => {
      frameId = requestAnimationFrame(processAutoPilot);

      const line = lyricsRef.current[activeLineIdxRef.current];
      if (!line || line.wordTokens.length === 0) return;

      const wordToken = line.wordTokens[activeWordIdxRef.current];
      if (!wordToken) return;

      const t = currentTimeRef.current;
      
      // Calculate how many characters we should have typed by now
      const duration = Math.max(wordToken.endTime - wordToken.startTime, 0.1);
      const wordLen = wordToken.word.length;
      
      // Buffer a little bit so it finishes the word slightly before the end time
      // to leave room for space, but typing it precisely linearly is fine.
      let expectedChars = 0;
      if (t > wordToken.endTime - 0.05) {
        expectedChars = wordLen + 1; // full word + space
      } else if (t > wordToken.startTime) {
        let fraction = (t - wordToken.startTime) / duration;
        expectedChars = Math.floor(fraction * (wordLen + 1)); // include space
      }

      const currentBufferLen = typedBufferRef.current.length;

      // Type characters if we are behind expected
      if (expectedChars > currentBufferLen) {
        setUsedAutoPilot(true);
        // Start session if not started
        if (!sessionStartTimeRef.current) {
          const now = Date.now();
          sessionStartTimeRef.current = now;
          setSessionStartTime(now);
          setUsedAutoPilot(true);
        }

        if (currentBufferLen === wordLen) {
          // Time to press Space
          const typed = typedBufferRef.current;
          const targetWord = wordToken.word;
          const correct = typed.trim().toLowerCase() === targetWord.toLowerCase();
          if (!correct) {
            sessionErrorsRef.current += 1;
            setSessionErrors(n => n + 1);
          }
          const start = sessionStartTimeRef.current!;
          const elapsedMin = (Date.now() - start) / 1000 / 60;
          const prevCorrect = wordResultsRef.current.filter(w => w.correct).length + (correct ? 1 : 0);
          const wpm = elapsedMin > 0 ? Math.round(prevCorrect / 5 / elapsedMin) : 0;

          const result: WordResult = {
            word: targetWord,
            typed: typed.trim(),
            correct,
            wpm,
            time: t,
            lineIdx: activeLineIdxRef.current,
          };
          
          wordResultsRef.current = [...wordResultsRef.current, result];
          setWordResults(wordResultsRef.current);

          const nextWordIdx = activeWordIdxRef.current + 1;
          if (nextWordIdx < line.wordTokens.length) {
            activeWordIdxRef.current = nextWordIdx;
            setActiveWordIdx(nextWordIdx);
          }
          
          typedBufferRef.current = '';
          setTypedBuffer('');
        } else if (currentBufferLen < wordLen) {
          // Add the next character
          const nextChar = wordToken.word[currentBufferLen];
          if (nextChar) {
            typedBufferRef.current += nextChar;
            setTypedBuffer(typedBufferRef.current);
          }
        }
      }
    };

    frameId = requestAnimationFrame(processAutoPilot);
    return () => cancelAnimationFrame(frameId);
  }, [isAutoPilot, isPlaying, activeSong, songLoading, showResults]);

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    a.paused ? a.play().catch(() => {}) : a.pause();
  };

  const handleSkip = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const a = audioRef.current;
    if (a) a.pause();
    setShowResults(true);
  };

  const handleReset = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const a = audioRef.current;
    if (a) { a.currentTime = 0; a.play().catch(() => {}); }
    setActiveLineIdx(0);
    setActiveWordIdx(0);
    setTypedBuffer("");
    setWordResults([]);
    setSessionMetrics([]);
    setSessionStartTime(null);
    setLastMetricSecond(-1);
    setSessionErrors(0);
    setUsedAutoPilot(isAutoPilot);
    setShowResults(false);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // WPM display
  const currentWpm = (() => {
    if (!sessionStartTime || wordResults.length === 0) return 0;
    const elapsed = (Date.now() - sessionStartTime) / 1000 / 60;
    return elapsed > 0 ? Math.round(wordResults.filter(w => w.correct).length / 5 / elapsed) : 0;
  })();
  const sessionAcc = wordResults.length > 0
    ? Math.round(wordResults.filter(w => w.correct).length / wordResults.length * 100)
    : 0;

  /* ════════════════════════════════════════
     RENDER
  ════════════════════════════════════════ */
  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "#323437", color: "#d1d0c5" }}
      onClick={() => { typingRef.current?.focus(); setShowSpeedMenu(false); setShowProviderMenu(false); }}
    >
      {/* Audio */}
      {streamUrl && <audio ref={audioRef} src={streamUrl} preload="auto" />}

      {/* Hidden typing input — must NOT have pointer-events-none so focus works */}
      <input
        ref={typingRef}
        type="text"
        value={typedBuffer}
        readOnly
        className="fixed"
        style={{
          top: -9999,
          left: -9999,
          width: 1,
          height: 1,
          opacity: 0,
          caretColor: "transparent",
        }}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />

      {/* ── SEARCH OVERLAY ── */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
          onClick={(e) => e.target === e.currentTarget && setSearchOpen(false)}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} />
          <div className="relative w-full max-w-xl mx-4 rounded-xl overflow-hidden shadow-2xl" style={{ background: "#2c2e31" }}>
            <div className="flex items-center gap-3 px-5 h-14" style={{ borderBottom: "1px solid #3a3c3f" }}>
              <Search size={18} style={{ color: "#646669" }} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={searchKeyDown}
                placeholder="search for a song..."
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-transparent outline-none text-base"
                style={{ color: "#d1d0c5", caretColor: "#e2b714" }}
              />
              {searchLoading
                ? <Loader2 size={16} className="animate-spin shrink-0" style={{ color: "#e2b714" }} />
                : <kbd className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "#3a3c3f", color: "#646669" }}>esc</kbd>
              }
            </div>
            <div className="max-h-[55vh] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {results.length === 0 && query && !searchLoading && (
                <div className="px-5 py-10 text-center text-sm" style={{ color: "#646669" }}>no results for &quot;{query}&quot;</div>
              )}
              {results.length === 0 && !query && (
                <div className="px-5 py-10 text-center" style={{ color: "#646669" }}>
                  <Music2 size={24} className="mx-auto mb-2 opacity-30" />
                  <div className="text-sm">type to search youtube music</div>
                </div>
              )}
              {results.map((song, i) => (
                <button
                  key={`${song.videoId}-${i}`}
                  onClick={(e) => { e.stopPropagation(); playSong(song); }}
                  onMouseEnter={() => setHoveredIdx(i)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors"
                  style={{ background: i === hoveredIdx ? "#3a3c3f" : "transparent" }}
                >
                  {song.thumbnail
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={song.thumbnail} alt="" className="w-10 h-10 rounded object-cover shrink-0" style={{ background: "#3a3c3f" }} />
                    : <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center" style={{ background: "#3a3c3f" }}><Music2 size={16} style={{ color: "#646669" }} /></div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "#d1d0c5" }}>{song.name}</div>
                    <div className="text-xs truncate" style={{ color: "#646669" }}>{song.artistName}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: "#4a4c4f" }}>{song.source}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <header className="flex items-center justify-between px-6 lg:px-10 h-14 shrink-0 z-20">
        <div className="flex items-center gap-2.5">
          <Keyboard size={18} style={{ color: "#e2b714" }} />
          <span className="font-bold text-sm tracking-tight" style={{ color: "#e2b714" }}>musictype</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto Pilot Toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); setIsAutoPilot(v => !v); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
            style={{ 
              background: isAutoPilot ? "#e2b714" : "#2c2e31", 
              color: isAutoPilot ? "#1e1e1e" : "#646669", 
              border: "1px solid #3a3c3f" 
            }}
          >
            Auto Pilot
          </button>
          
          {/* Provider selector */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowProviderMenu(v => !v); setShowSpeedMenu(false); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
              style={{ background: "#2c2e31", color: lyricsSource ? "#7ec984" : "#646669", border: "1px solid #3a3c3f" }}
            >
              <RefreshCw size={12} />
              <span className="hidden sm:inline">{lyricsSource || lyricsProvider}</span>
              <ChevronDown size={10} />
            </button>
            {showProviderMenu && (
              <div className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden shadow-xl z-30" style={{ background: "#2c2e31", border: "1px solid #3a3c3f", minWidth: 140 }}>
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLyricsProvider(p.id);
                      setShowProviderMenu(false);
                      if (activeSong) playSong(activeSong, p.id);
                    }}
                    className="w-full text-left px-4 py-2 text-xs transition-colors"
                    style={{
                      background: lyricsProvider === p.id ? "#3a3c3f" : "transparent",
                      color: lyricsProvider === p.id ? "#e2b714" : "#d1d0c5",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Speed selector */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(v => !v); setShowProviderMenu(false); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
              style={{ background: "#2c2e31", color: playbackSpeed !== 1 ? "#e2b714" : "#646669", border: "1px solid #3a3c3f" }}
            >
              {playbackSpeed}x <ChevronDown size={10} />
            </button>
            {showSpeedMenu && (
              <div className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden shadow-xl z-30" style={{ background: "#2c2e31", border: "1px solid #3a3c3f", minWidth: 100 }}>
                {SPEED_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={(e) => { e.stopPropagation(); setPlaybackSpeed(s); setShowSpeedMenu(false); }}
                    className="w-full text-left px-4 py-2 text-xs transition-colors"
                    style={{
                      background: playbackSpeed === s ? "#3a3c3f" : "transparent",
                      color: playbackSpeed === s ? "#e2b714" : "#d1d0c5",
                    }}
                  >
                    {s}x {playbackSpeed === s ? "✓" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search button */}
          <button
            onClick={(e) => { e.stopPropagation(); setSearchOpen(true); }}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded transition-colors"
            style={{ background: "#2c2e31", color: "#646669", border: "1px solid #3a3c3f" }}
          >
            <Search size={13} />
            <span className="hidden sm:inline">search</span>
            <span className="hidden sm:inline text-[10px]" style={{ color: "#4a4c4f" }}>ctrl+k</span>
          </button>
        </div>
      </header>

      {/* ── ERROR ── */}
      {playerError && (
        <div className="mx-6 lg:mx-10 mb-2 text-sm py-2 px-4 rounded" style={{ background: "#ca43431a", color: "#ca4343" }}>
          {playerError}
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 lg:px-10 overflow-hidden min-h-0">

        {/* LANDING */}
        {!activeSong && (
          <div className="flex flex-col items-center text-center gap-6 max-w-lg">
            <Keyboard size={40} style={{ color: "#e2b714", opacity: 0.25 }} />
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight" style={{ color: "#d1d0c5" }}>
              type the lyrics.<br />
              <span style={{ color: "#e2b714" }}>feel the beat.</span>
            </h1>
            <p className="text-sm max-w-xs" style={{ color: "#646669" }}>
              search any song — type word by word as it plays. see your stats when it ends.
            </p>
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-lg"
              style={{ background: "#e2b714", color: "#323437" }}
            >
              <Search size={16} /> start typing
            </button>
          </div>
        )}

        {/* LOADING */}
        {activeSong && songLoading && (
          <div className="flex flex-col items-center gap-5">
            <div className="relative w-20 h-20">
              {activeSong.thumbnail
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={activeSong.thumbnail} alt="" className="w-full h-full rounded-xl object-cover opacity-50" />
                : <div className="w-full h-full rounded-xl" style={{ background: "#2c2e31" }} />
              }
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin" style={{ color: "#e2b714" }} />
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold" style={{ color: "#d1d0c5" }}>{activeSong.name}</div>
              <div className="text-xs mt-0.5" style={{ color: "#646669" }}>{activeSong.artistName}</div>
              <div className="text-xs mt-3" style={{ color: "#4a4c4f" }}>loading audio stream...</div>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {activeSong && !songLoading && showResults && (
          <div className="w-full overflow-y-auto max-h-full py-6" style={{ scrollbarWidth: "thin" }}>
            <ResultsScreen
              song={activeSong}
              wordResults={wordResults}
              metrics={sessionMetrics}
              usedAutoPilot={usedAutoPilot}
              onRetry={handleReset}
              onNew={() => setSearchOpen(true)}
            />
          </div>
        )}

        {/* TYPING GAME */}
        {activeSong && !songLoading && !showResults && (
          <div className="w-full h-full flex flex-col max-w-3xl" onClick={() => typingRef.current?.focus()}>
            {/* Stats row */}
            <div className="flex flex-col gap-2 mb-4 shrink-0">
              <div className="flex items-center gap-6 text-xs" style={{ color: "#646669" }}>
                {activeSong.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={activeSong.thumbnail} alt="" className="w-8 h-8 rounded object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-medium truncate text-sm block" style={{ color: "#d1d0c5" }}>{activeSong.name}</span>
                  <span className="truncate" style={{ color: "#646669" }}>{activeSong.artistName}</span>
                </div>
                {sessionStartTime && (
                  <>
                    <div className="text-right shrink-0">
                      <span className="text-xl font-bold tabular-nums block" style={{ color: "#e2b714" }}>{currentWpm}</span>
                      <span>wpm</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xl font-bold block" style={{ color: sessionAcc >= 80 ? "#7ec984" : sessionAcc >= 50 ? "#e2b714" : "#ca4343" }}>{sessionAcc}%</span>
                      <span>acc</span>
                    </div>
                  </>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowResults(true); }}
                  className="shrink-0 text-xs px-2 py-1 rounded"
                  style={{ background: "#2c2e31", color: "#4a4c4f", border: "1px solid #3a3c3f" }}
                >
                  <BarChart3 size={13} />
                </button>
              </div>

              {/* Instructions Row */}
              <div className="flex items-center justify-between text-[11px] font-mono opacity-60 tracking-tight" style={{ color: "#e2b714" }}>
                <span>Type to start</span>
                <span>Space to advance word</span>
                <span>Click any line to skip</span>
              </div>
            </div>

            {/* ─── LYRICS SCROLL (Apple Music karaoke style) ─── */}
            <div
              ref={lyricsScrollRef}
              className="flex-1 overflow-y-auto min-h-0 relative"
              style={{
                scrollbarWidth: "none",
                maskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
                paddingTop: "30vh",
                paddingBottom: "30vh",
              }}
            >
              {lyrics.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40" style={{ color: "#646669" }}>
                  <Music2 size={28} className="mb-2 opacity-25" />
                  <span className="text-sm">no lyrics found — try another song or change provider</span>
                </div>
              ) : (
                lyrics.map((line, li) => {
                  const isActive = li === activeLineIdx;
                  const isPast = li < activeLineIdx;

                  return (
                    <div
                      key={li}
                      data-line={li}
                      className="py-1.5 px-2 rounded-lg transition-all duration-300 cursor-pointer mb-1"
                      style={{
                        opacity: isActive ? 1 : isPast ? 0.2 : 0.3,
                        transform: isActive ? "scale(1.02)" : "scale(1)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (audioRef.current && line.time > 0) {
                          audioRef.current.currentTime = line.time;
                        }
                        typingRef.current?.focus();
                      }}
                    >
                      {isActive ? (
                        /* ─── Active line: word-by-word highlighting ─── */
                        <div className="text-2xl md:text-3xl font-bold leading-relaxed flex flex-wrap gap-y-1">
                          {line.wordTokens.map((tok, wi) => {
                            const isCurrentWord = wi === activeWordIdx;
                            const isPastWord = wi < activeWordIdx;
                            const pastResult = wordResults.find(
                              r => r.lineIdx === li && r.word === tok.word &&
                                   wordResults.indexOf(r) === wordResults.filter(x => x.lineIdx < li).length + wi
                            );

                            let wordColor = "#646669"; // upcoming
                            if (isPastWord) {
                              wordColor = pastResult?.correct ? "#e2b714" : "#ca4343";
                            }
                            if (isCurrentWord) {
                              wordColor = "#d1d0c5"; // active
                            }

                            // Show character-level feedback for current word
                            return (
                              <span key={wi} className="relative mr-[0.35em] transition-colors duration-100">
                                {isCurrentWord ? (
                                  /* Character-by-character for current word */
                                  tok.word.split("").map((ch, ci) => {
                                    const typedCh = typedBuffer[ci];
                                    let chColor = "#5a5c5f"; // not-yet-typed part of current word
                                    if (typedCh) {
                                      chColor = typedCh.toLowerCase() === ch.toLowerCase() ? "#e2b714" : "#ca4343";
                                    }
                                    const isCursor = ci === typedBuffer.length;
                                    return (
                                      <span key={ci} className="relative transition-colors duration-75" style={{ color: chColor }}>
                                        {ch}
                                        {isCursor && isPlaying && (
                                          <span className="absolute -bottom-0.5 left-0 w-[2px] h-[1.1em]" style={{ background: "#e2b714", animation: "blink 1s step-end infinite" }} />
                                        )}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span style={{ color: wordColor }}>
                                    {tok.word}
                                    {isPastWord && pastResult && !pastResult.correct && (
                                      <span className="absolute -bottom-0.5 left-0 w-full h-[2px] rounded" style={{ background: "#ca4343" }} />
                                    )}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        /* ─── Non-active lines ─── */
                        <div className="text-2xl md:text-3xl font-bold leading-relaxed" style={{ color: "#646669" }}>
                          {line.words}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── PLAYER BAR ── */}
      {activeSong && streamUrl && !showResults && (
        <footer className="shrink-0 px-6 lg:px-10 pb-4 pt-2 z-10">
          {/* Progress */}
          <div className="max-w-3xl mx-auto mb-2">
            <div
              className="w-full h-1 rounded-full cursor-pointer relative group"
              style={{ background: "#2c2e31" }}
              onClick={(e) => {
                e.stopPropagation();
                if (!audioRef.current || !duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
              }}
            >
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#e2b714" }} />
            </div>
          </div>

          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <span className="text-xs tabular-nums w-12" style={{ color: "#646669" }}>{formatTime(currentTime)}</span>
            <div className="flex items-center gap-4">
              <button onClick={handleReset} className="transition-colors" style={{ color: "#646669" }}>
                <RotateCcw size={15} />
              </button>
              <button
                onClick={togglePlay}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style={{ background: "#e2b714", color: "#323437" }}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button onClick={handleSkip} className="transition-colors" style={{ color: "#646669" }} title="Skip song and show results">
                <SkipForward size={15} />
              </button>
            </div>
            <span className="text-xs tabular-nums w-12 text-right" style={{ color: "#646669" }}>{formatTime(duration)}</span>
          </div>
        </footer>
      )}

      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3a3c3f; border-radius: 2px; }
      `}</style>
    </div>
  );
}
