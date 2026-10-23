import { useState, useRef } from "react";
import { Download, Link2, Video, CheckCircle, AlertCircle, Loader2, ChevronDown, Play, Globe, Zap, Shield, Code2 } from "lucide-react";

type Format = {
  id: string;
  label: string;
  quality: string;
  size: string;
  ext: string;
};

type DownloadState = "idle" | "analyzing" | "ready" | "downloading" | "done" | "error";

type VideoSource =
  | { kind: "direct"; url: string; ext: string }
  | { kind: "iframe"; url: string; src: string }
  | { kind: "known"; url: string; platform: string }
  | { kind: "generic"; url: string };

const KNOWN_PLATFORMS: { pattern: RegExp; name: string }[] = [
  { pattern: /youtube\.com|youtu\.be/, name: "YouTube" },
  { pattern: /vimeo\.com/, name: "Vimeo" },
  { pattern: /dailymotion\.com/, name: "Dailymotion" },
  { pattern: /twitch\.tv/, name: "Twitch" },
  { pattern: /tiktok\.com/, name: "TikTok" },
  { pattern: /twitter\.com|x\.com/, name: "Twitter / X" },
  { pattern: /instagram\.com/, name: "Instagram" },
  { pattern: /facebook\.com|fb\.watch/, name: "Facebook" },
  { pattern: /streamable\.com/, name: "Streamable" },
  { pattern: /wistia\.com|wistia\.net/, name: "Wistia" },
  { pattern: /loom\.com/, name: "Loom" },
  { pattern: /kaltura\.com/, name: "Kaltura" },
  { pattern: /brightcove\.net/, name: "Brightcove" },
  { pattern: /jwplatform\.com|jwplayer\.com/, name: "JW Player" },
  { pattern: /rumble\.com/, name: "Rumble" },
  { pattern: /bitchute\.com/, name: "BitChute" },
  { pattern: /odysee\.com|lbry\.tv/, name: "Odysee" },
];

const DIRECT_VIDEO_EXTS = ["mp4", "webm", "ogg", "mov", "avi", "mkv", "m4v", "flv", "3gp"];
const STREAM_EXTS = ["m3u8", "mpd"];

const FORMATS_FOR_DIRECT: Format[] = [
  { id: "original", label: "Original File", quality: "Source", size: "~varies", ext: "mp4" },
  { id: "mp4-1080", label: "MP4 Full HD", quality: "1080p", size: "~245 MB", ext: "mp4" },
  { id: "mp4-720", label: "MP4 HD", quality: "720p", size: "~128 MB", ext: "mp4" },
  { id: "mp4-480", label: "MP4 SD", quality: "480p", size: "~64 MB", ext: "mp4" },
  { id: "mp3-320", label: "MP3 Audio", quality: "320kbps", size: "~18 MB", ext: "mp3" },
];

const FORMATS_FOR_EMBED: Format[] = [
  { id: "mp4-1080", label: "MP4 Full HD", quality: "1080p", size: "~245 MB", ext: "mp4" },
  { id: "mp4-720", label: "MP4 HD", quality: "720p", size: "~128 MB", ext: "mp4" },
  { id: "mp4-480", label: "MP4 SD", quality: "480p", size: "~64 MB", ext: "mp4" },
  { id: "mp4-360", label: "MP4 Low", quality: "360p", size: "~32 MB", ext: "mp4" },
  { id: "mp3-320", label: "MP3 Audio", quality: "320kbps", size: "~18 MB", ext: "mp3" },
  { id: "mp3-128", label: "MP3 Audio", quality: "128kbps", size: "~8 MB", ext: "mp3" },
  { id: "webm-1080", label: "WebM HD", quality: "1080p", size: "~198 MB", ext: "webm" },
];

function detectSource(raw: string): VideoSource | null {
  const trimmed = raw.trim();

  // iframe embed code
  const iframeSrcMatch = trimmed.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeSrcMatch) {
    return { kind: "iframe", url: trimmed, src: iframeSrcMatch[1] };
  }

  // must be a URL from here
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const pathname = url.pathname.toLowerCase();
  const ext = pathname.split(".").pop() ?? "";

  if (DIRECT_VIDEO_EXTS.includes(ext)) {
    return { kind: "direct", url: trimmed, ext };
  }
  if (STREAM_EXTS.includes(ext)) {
    return { kind: "direct", url: trimmed, ext };
  }

  for (const { pattern, name } of KNOWN_PLATFORMS) {
    if (pattern.test(url.hostname)) {
      return { kind: "known", url: trimmed, platform: name };
    }
  }

  return { kind: "generic", url: trimmed };
}

function sourceLabel(src: VideoSource): { platform: string; badge: string; badgeColor: string } {
  switch (src.kind) {
    case "direct":
      return { platform: "Direct Video File", badge: `.${src.ext}`, badgeColor: "#06b6d4" };
    case "iframe":
      return { platform: "Embed / iframe", badge: "EMBED", badgeColor: "#7c3aed" };
    case "known":
      return { platform: src.platform, badge: src.platform.split(" ")[0].toUpperCase().slice(0, 3), badgeColor: "#6c63ff" };
    case "generic":
      return { platform: "Generic URL", badge: "URL", badgeColor: "#10b981" };
  }
}

function mockTitle(src: VideoSource): string {
  switch (src.kind) {
    case "direct": return `Video File — ${src.ext.toUpperCase()} Source`;
    case "iframe": {
      try { return `Embedded Player — ${new URL(src.src).hostname}`; } catch { return "Embedded Video Player"; }
    }
    case "known": return `${src.platform} Video`;
    case "generic": {
      try { return `Video from ${new URL(src.url).hostname}`; } catch { return "Online Video"; }
    }
  }
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--primary), var(--accent))" }}
      />
    </div>
  );
}

const SUPPORTED_PLATFORMS = [
  "YouTube", "Vimeo", "Twitter/X", "Instagram", "TikTok",
  "Facebook", "Dailymotion", "Twitch", "Streamable", "Wistia",
  "Loom", "Kaltura", "Brightcove", "JW Player", "Rumble",
  "Odysee", "Direct MP4/WebM", "HLS (m3u8)", "DASH (mpd)", "Any iframe",
];

export default function App() {
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<"url" | "embed">("url");
  const [state, setState] = useState<DownloadState>("idle");
  const [source, setSource] = useState<VideoSource | null>(null);
  const [formats, setFormats] = useState<Format[]>(FORMATS_FOR_EMBED);
  const [selectedFormat, setSelectedFormat] = useState<Format>(FORMATS_FOR_EMBED[0]);
  const [formatOpen, setFormatOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleAnalyze() {
    if (!input.trim()) return;
    const detected = detectSource(input.trim());
    if (!detected) {
      setErrorMsg("Could not detect a valid video URL or embed code. Please check your input.");
      setState("error");
      return;
    }
    setState("analyzing");
    setErrorMsg("");
    await new Promise((r) => setTimeout(r, 1600));
    const fmts = detected.kind === "direct" ? FORMATS_FOR_DIRECT : FORMATS_FOR_EMBED;
    setFormats(fmts);
    setSelectedFormat(fmts[0]);
    setSource(detected);
    setState("ready");
  }

  async function handleDownload() {
    if (!source) return;

    // For direct video files, simulate a real browser download
    if (source.kind === "direct") {
      setState("downloading");
      setProgress(0);
      let p = 0;
      progressRef.current = setInterval(() => {
        p += Math.random() * 12 + 4;
        if (p >= 100) {
          clearInterval(progressRef.current!);
          setProgress(100);
          setTimeout(() => {
            // Attempt real download for direct files
            const a = document.createElement("a");
            a.href = source.url;
            a.download = "";
            a.target = "_blank";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setState("done");
          }, 300);
        } else {
          setProgress(Math.round(p));
        }
      }, 150);
      return;
    }

    setState("downloading");
    setProgress(0);
    let p = 0;
    progressRef.current = setInterval(() => {
      p += Math.random() * 7 + 2;
      if (p >= 100) {
        clearInterval(progressRef.current!);
        setProgress(100);
        setTimeout(() => setState("done"), 400);
      } else {
        setProgress(Math.round(p));
      }
    }, 180);
  }

  function handleReset() {
    setState("idle");
    setInput("");
    setProgress(0);
    setSource(null);
  }

  const placeholder =
    inputMode === "url"
      ? "https://example.com/video.mp4  or  https://youtube.com/watch?v=…"
      : '<iframe src="https://player.vimeo.com/video/123456" ...></iframe>';

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(108,99,255,0.18) 0%, transparent 70%), var(--background)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* MARKER-MAKE-KIT-INVOKED */}

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))" }}
          >
            <Download className="w-4 h-4 text-white" />
          </div>
          <span className="text-foreground tracking-tight" style={{ fontWeight: 600, fontSize: "1.1rem" }}>
            VidGrab
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-6">
          {["Features", "Supported Sites", "FAQ"].map((item) => (
            <a key={item} href="#" className="text-muted-foreground hover:text-foreground transition-colors" style={{ fontSize: "0.9rem" }}>
              {item}
            </a>
          ))}
        </nav>
      </header>

      {/* Hero */}
      <main className="max-w-3xl mx-auto px-4 pt-20 pb-12">
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6 border"
            style={{ borderColor: "rgba(108,99,255,0.3)", background: "rgba(108,99,255,0.08)", fontSize: "0.8rem" }}
          >
            <Zap className="w-3 h-3" style={{ color: "var(--primary)" }} />
            <span style={{ color: "var(--primary)" }}>Free · No signup · Supports any embed URL</span>
          </div>

          <h1
            className="text-foreground mb-4 leading-tight"
            style={{ fontSize: "clamp(2rem, 5vw, 3.25rem)", fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            Download Any Video<br />
            <span style={{ background: "linear-gradient(90deg, var(--primary), var(--accent))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              From Any Embed URL
            </span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto" style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
            Paste a video URL, direct file link, or iframe embed code. Supports HLS streams, MP4 files, and 50+ platforms.
          </p>
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>

          {/* Input Mode Toggle */}
          <div
            className="flex gap-1 p-1 rounded-xl mb-4 w-fit"
            style={{ background: "var(--muted)" }}
          >
            {([["url", Link2, "URL / Link"], ["embed", Code2, "Embed Code"]] as const).map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => { setInputMode(mode); setInput(""); if (state !== "idle") handleReset(); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all"
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 500,
                  background: inputMode === mode ? "var(--card)" : "transparent",
                  color: inputMode === mode ? "var(--foreground)" : "var(--muted-foreground)",
                  boxShadow: inputMode === mode ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Input Field */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              {inputMode === "url" ? (
                <>
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => { setInput(e.target.value); if (state === "error") setState("idle"); }}
                    onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                    placeholder={placeholder}
                    disabled={state === "analyzing" || state === "downloading"}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
                    style={{ background: "var(--input-background)", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem" }}
                  />
                </>
              ) : (
                <textarea
                  value={input}
                  onChange={(e) => { setInput(e.target.value); if (state === "error") setState("idle"); }}
                  placeholder={placeholder}
                  disabled={state === "analyzing" || state === "downloading"}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors resize-none"
                  style={{ background: "var(--input-background)", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.78rem", lineHeight: 1.6 }}
                />
              )}
            </div>
            <button
              onClick={handleAnalyze}
              disabled={!input.trim() || state === "analyzing" || state === "downloading"}
              className="px-5 py-3 rounded-xl text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0 self-start"
              style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))", fontWeight: 600, fontSize: "0.9rem" }}
            >
              {state === "analyzing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              {state === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>
          </div>

          {/* Supported types hint */}
          {state === "idle" && (
            <div className="flex flex-wrap gap-2 mb-2">
              {["Direct MP4/WebM", "HLS (m3u8)", "iframe embed", "YouTube", "Vimeo", "+ more"].map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-md border"
                  style={{ fontSize: "0.72rem", color: "var(--muted-foreground)", borderColor: "var(--border)", background: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Error State */}
          {state === "error" && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-2" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
              <span className="text-destructive" style={{ fontSize: "0.875rem" }}>{errorMsg}</span>
            </div>
          )}

          {/* Analyzing State */}
          {state === "analyzing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(108,99,255,0.1)" }}>
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--primary)" }} />
              </div>
              <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>Extracting video source…</p>
            </div>
          )}

          {/* Ready / Downloading / Done */}
          {source && (state === "ready" || state === "downloading" || state === "done") && (() => {
            const { platform, badge, badgeColor } = sourceLabel(source);
            const title = mockTitle(source);
            return (
              <div className="flex flex-col gap-4">
                {/* Detected Source Info */}
                <div className="flex gap-3 p-4 rounded-xl border" style={{ background: "var(--muted)", borderColor: "var(--border)" }}>
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: badgeColor + "22" }}
                  >
                    <Play className="w-5 h-5" style={{ color: badgeColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="px-2 py-0.5 rounded-md text-white shrink-0"
                        style={{ background: badgeColor, fontSize: "0.68rem", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}
                      >
                        {badge}
                      </span>
                      <p className="text-foreground truncate" style={{ fontWeight: 600, fontSize: "0.9rem" }}>{title}</p>
                    </div>
                    <p
                      className="text-muted-foreground mt-1 truncate"
                      style={{ fontSize: "0.75rem", fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {source.kind === "iframe" ? source.src : source.url}
                    </p>
                    <p className="text-muted-foreground mt-0.5" style={{ fontSize: "0.75rem" }}>
                      Source: {platform}
                      {source.kind === "direct" && ` · ${source.ext.toUpperCase()} file`}
                      {source.kind === "iframe" && " · Extracted from embed code"}
                    </p>
                  </div>
                </div>

                {/* Inline preview for direct video files */}
                {source.kind === "direct" && DIRECT_VIDEO_EXTS.includes(source.ext) && (
                  <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                    {/* using <video> instead of a kit component: kit has no video player component */}
                    <video
                      src={source.url}
                      controls
                      className="w-full max-h-48 bg-black"
                      style={{ display: "block" }}
                    />
                  </div>
                )}

                {/* Format Selector */}
                <div>
                  <label className="text-muted-foreground block mb-2" style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                    Format & Quality
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setFormatOpen(!formatOpen)}
                      disabled={state === "downloading" || state === "done"}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border text-foreground transition-colors hover:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ background: "var(--input-background)", borderColor: "var(--border)", fontSize: "0.9rem" }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="px-2 py-0.5 rounded-md text-white shrink-0"
                          style={{ background: "var(--primary)", fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          .{selectedFormat.ext}
                        </span>
                        <span>{selectedFormat.label}</span>
                        <span className="text-muted-foreground">{selectedFormat.quality}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>{selectedFormat.size}</span>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${formatOpen ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {formatOpen && (
                      <div
                        className="absolute top-full left-0 right-0 mt-2 rounded-xl border z-10 overflow-hidden"
                        style={{ background: "var(--card)", borderColor: "var(--border)" }}
                      >
                        {formats.map((fmt) => (
                          <button
                            key={fmt.id}
                            onClick={() => { setSelectedFormat(fmt); setFormatOpen(false); }}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted transition-colors"
                            style={{ borderBottom: "1px solid var(--border)", fontSize: "0.875rem" }}
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className="px-2 py-0.5 rounded-md text-white shrink-0"
                                style={{
                                  background: fmt.id === selectedFormat.id ? "var(--primary)" : "var(--secondary)",
                                  fontSize: "0.72rem",
                                  fontFamily: "'JetBrains Mono', monospace",
                                }}
                              >
                                .{fmt.ext}
                              </span>
                              <span className="text-foreground">{fmt.label}</span>
                              <span className="text-muted-foreground">{fmt.quality}</span>
                            </div>
                            <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>{fmt.size}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress */}
                {state === "downloading" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>Downloading…</span>
                      <span style={{ fontSize: "0.8rem", color: "var(--primary)", fontFamily: "'JetBrains Mono', monospace" }}>{progress}%</span>
                    </div>
                    <ProgressBar progress={progress} />
                  </div>
                )}

                {/* Done */}
                {state === "done" && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#10b981" }} />
                    <span style={{ fontSize: "0.875rem", color: "#10b981" }}>Download complete! Your file is ready.</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  {state === "ready" && (
                    <button
                      onClick={handleDownload}
                      className="flex-1 py-3 rounded-xl text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95"
                      style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))", fontWeight: 600, fontSize: "0.95rem" }}
                    >
                      <Download className="w-4 h-4" />
                      Download {selectedFormat.quality}
                    </button>
                  )}
                  {state === "done" && (
                    <>
                      <button
                        className="flex-1 py-3 rounded-xl text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all"
                        style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))", fontWeight: 600, fontSize: "0.95rem" }}
                      >
                        <Download className="w-4 h-4" />
                        Save File
                      </button>
                      <button
                        onClick={handleReset}
                        className="px-5 py-3 rounded-xl border text-foreground transition-colors hover:bg-muted"
                        style={{ borderColor: "var(--border)", fontSize: "0.9rem" }}
                      >
                        New Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          {[
            { icon: Globe, label: "Any Embed URL", sub: "iframe, HLS, MP4, m3u8" },
            { icon: Zap, label: "Instant Extraction", sub: "No queue, no signup" },
            { icon: Shield, label: "100% Private", sub: "No data stored" },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex flex-col items-center gap-2 py-5 px-3 rounded-xl border text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(108,99,255,0.12)" }}>
                <Icon className="w-4 h-4" style={{ color: "var(--primary)" }} />
              </div>
              <div>
                <p className="text-foreground" style={{ fontWeight: 600, fontSize: "0.85rem" }}>{label}</p>
                <p className="text-muted-foreground" style={{ fontSize: "0.75rem" }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Supported Types */}
      <section className="max-w-3xl mx-auto px-4 pb-16">
        <p className="text-center text-muted-foreground mb-6" style={{ fontSize: "0.85rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Supported Formats & Platforms
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {SUPPORTED_PLATFORMS.map((p) => (
            <span
              key={p}
              className="px-3 py-1.5 rounded-full border"
              style={{ background: "var(--card)", borderColor: "var(--border)", fontSize: "0.8rem", color: "var(--muted-foreground)" }}
            >
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="max-w-3xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>
            © 2026 VidGrab · For personal use only. Respect copyright laws.
          </p>
          <div className="flex gap-4">
            {["Privacy", "Terms", "Contact"].map((item) => (
              <a key={item} href="#" className="text-muted-foreground hover:text-foreground transition-colors" style={{ fontSize: "0.8rem" }}>{item}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
