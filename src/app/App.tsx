import { useState, useEffect, useRef } from "react";
import { Download, Link2, Video, CheckCircle, AlertCircle, Loader2, Play, Zap, Shield } from "lucide-react";

type JobStatus = "queued" | "running" | "succeeded" | "failed";

type Job = {
  id: string;
  inputUrl: string;
  status: JobStatus;
  progress?: { stage: string; message: string; count?: number };
  error?: string;
};

type MediaItem = {
  type: "image" | "video";
  status: string;
  localPath?: string;
};

type PostRecord = {
  media: MediaItem[];
};

type GalleryItem = {
  url: string;
  filename: string;
  type: "image" | "video";
};

export default function App() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function reset() {
    setInput("");
    setError("");
    setProgress(0);
    setProgressMsg("");
    setItems([]);
    setSelected(new Set());
    setBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = input.trim();
    if (!url) return;
    if (!/instagram\.com/i.test(url)) {
      setError("Only Instagram URLs are supported.");
      return;
    }

    setError("");
    setBusy(true);
    setProgress(10);
    setProgressMsg("Starting…");
    setItems([]);
    setSelected(new Set());

    try {
      const res = await fetch("/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const job = (await res.json()) as Job & { error?: string };
      if (!res.ok) throw new Error(job.error || "Failed to start job");

      const poll = async () => {
        const statusRes = await fetch(`/jobs/${job.id}`);
        const status = (await statusRes.json()) as Job;
        if (status.progress?.message) {
          setProgressMsg(status.progress.message);
          setProgress((p) => Math.min(85, p + 10));
        }
        if (status.status === "succeeded") {
          setProgress(100);
          const posts = (await fetch(`/jobs/${job.id}/posts`).then((r) => r.json())) as PostRecord[];
          const gallery: GalleryItem[] = [];
          for (const post of posts) {
            for (const m of post.media) {
              if (m.status !== "saved" || !m.localPath) continue;
              const mediaUrl = "/media/" + m.localPath.split("/").map(encodeURIComponent).join("/");
              gallery.push({
                url: mediaUrl,
                filename: m.localPath.split("/").pop() || (m.type === "video" ? "video.mp4" : "image.jpg"),
                type: m.type,
              });
            }
          }
          setItems(gallery);
          setBusy(false);
          if (!gallery.length) setError("Job finished but no media was saved.");
          return;
        }
        if (status.status === "failed") {
          throw new Error(status.error || "Download failed");
        }
        pollRef.current = setTimeout(poll, 1400);
      };
      await poll();
    } catch (err) {
      setError((err as Error).message || "Error");
      setBusy(false);
    }
  }

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function download(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadSelected() {
    for (const item of items) {
      if (selected.has(item.url)) download(item.url, item.filename);
    }
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(108,99,255,0.18) 0%, transparent 70%), var(--background)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
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
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-20 pb-12">
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6 border"
            style={{ borderColor: "rgba(108,99,255,0.3)", background: "rgba(108,99,255,0.08)", fontSize: "0.8rem" }}
          >
            <Zap className="w-3 h-3" style={{ color: "var(--primary)" }} />
            <span style={{ color: "var(--primary)" }}>Free · No signup</span>
          </div>

          <h1
            className="text-foreground mb-4 leading-tight"
            style={{ fontSize: "clamp(2rem, 5vw, 3.25rem)", fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            Download Instagram<br />
            <span style={{ background: "linear-gradient(90deg, var(--primary), var(--accent))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Photos and Videos
            </span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto" style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
            Paste an Instagram post, reel, story, or profile URL.
          </p>
        </div>

        <div className="rounded-2xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <form onSubmit={handleSubmit} className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={input}
                onChange={(e) => { setInput(e.target.value); if (error) setError(""); }}
                placeholder="https://www.instagram.com/reel/…"
                disabled={busy}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
                style={{ background: "var(--input-background)", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="px-5 py-3 rounded-xl text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
              style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))", fontWeight: 600, fontSize: "0.9rem" }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              {busy ? "Extracting…" : "Download"}
            </button>
          </form>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-2" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
              <span className="text-destructive" style={{ fontSize: "0.875rem" }}>{error}</span>
            </div>
          )}

          {busy && (
            <div className="flex flex-col gap-2 py-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{progressMsg || "Extracting media…"}</span>
                <span style={{ color: "var(--primary)", fontFamily: "'JetBrains Mono', monospace" }}>{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--primary), var(--accent))" }}
                />
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Choose your media</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{items.length} item{items.length === 1 ? "" : "s"}</p>
                </div>
                <button
                  type="button"
                  onClick={downloadSelected}
                  disabled={selected.size === 0}
                  className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))" }}
                >
                  Download Selected ({selected.size})
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((item) => (
                  <article
                    key={item.url}
                    onClick={() => toggle(item.url)}
                    className="rounded-xl overflow-hidden border cursor-pointer transition-all"
                    style={{
                      borderColor: selected.has(item.url) ? "var(--primary)" : "var(--border)",
                      background: "var(--muted)",
                    }}
                  >
                    <div className="relative aspect-video bg-black">
                      {item.type === "video" ? (
                        <video src={item.url} preload="metadata" playsInline className="w-full h-full object-cover" />
                      ) : (
                        <img src={item.url} alt="" className="w-full h-full object-cover" />
                      )}
                      <span
                        className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-white text-[9px] font-bold"
                        style={{ background: "var(--primary)" }}
                      >
                        {item.type === "video" ? "MP4" : "IMG"}
                      </span>
                      {selected.has(item.url) && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "var(--primary)" }}>
                          <CheckCircle className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-mono truncate">{item.filename}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); download(item.url, item.filename); }}
                        className="text-primary hover:opacity-80"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <button
                type="button"
                onClick={reset}
                className="mt-4 px-4 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--border)" }}
              >
                New Download
              </button>
            </div>
          )}
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="flex flex-col items-center gap-2 py-5 px-3 rounded-xl border text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <Play className="w-4 h-4" style={{ color: "var(--primary)" }} />
            <div>
              <p className="text-foreground font-semibold text-sm">Posts, Reels, Stories</p>
              <p className="text-muted-foreground text-xs mt-0.5">Profiles too</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 py-5 px-3 rounded-xl border text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <Zap className="w-4 h-4" style={{ color: "var(--primary)" }} />
            <div>
              <p className="text-foreground font-semibold text-sm">Instant Extraction</p>
              <p className="text-muted-foreground text-xs mt-0.5">No queue, no signup</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 py-5 px-3 rounded-xl border text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <Shield className="w-4 h-4" style={{ color: "var(--primary)" }} />
            <div>
              <p className="text-foreground font-semibold text-sm">100% Private</p>
              <p className="text-muted-foreground text-xs mt-0.5">No data stored</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
