// Local API. POST /jobs starts a crawl; GET /jobs/:id returns status and results.
// Job state is stored in OUT_DIR/jobs/<id>.json so status survives restarts.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type CrawlOptions, type CrawlSummary, runCrawl } from "./crawler.ts";
import type { PostRecord } from "./types.ts";
import { classifyUrl } from "./url.ts";

export type JobProgress = {
  stage: "listing" | "downloading" | "warning";
  message: string;
  count?: number;
};

export type JobState = {
  id: string;
  inputUrl: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  summary?: CrawlSummary;
  progress?: JobProgress;
  error?: string;
};

const OUT_DIR = path.resolve(process.env.OUT_DIR ?? "downloads");
const PUBLIC_DIR = path.resolve(import.meta.dir, "../../public");
const PORT = Number(process.env.PORT ?? 8787);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEV_HINT = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClipTrawl API</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e6e8ef; margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { max-width: 560px; padding: 32px; }
    h1 { margin: 0 0 12px; font-size: 1.4rem; }
    p { color: #a1a7b5; line-height: 1.5; }
    code { background: #1b1f2a; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>API is running on port ${PORT}</h1>
    <p>This process is the backend. The React UI is not built yet, so there is nothing to serve here.</p>
    <p>In another terminal, from the repo root, run <code>bun install</code> then <code>bun run dev</code>. Open the Vite URL it prints (usually <code>http://localhost:5173</code>).</p>
    <p>For a single-process production setup, run <code>bun run build</code> first, then restart this server. It will serve the built files from <code>public/</code>.</p>
  </main>
</body>
</html>`;

async function saveJob(jobsDir: string, job: JobState): Promise<void> {
  await mkdir(jobsDir, { recursive: true });
  const file = path.join(jobsDir, `${job.id}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(job, null, 2));
  await rename(`${file}.tmp`, file);
}

export async function loadJob(
  jobsDir: string,
  id: string,
): Promise<JobState | null> {
  if (!UUID.test(id)) return null;
  try {
    return JSON.parse(
      await readFile(path.join(jobsDir, `${id}.json`), "utf8"),
    ) as JobState;
  } catch {
    return null;
  }
}

export async function loadJobPosts(
  outDir: string,
  job: JobState,
): Promise<PostRecord[]> {
  const target = classifyUrl(job.inputUrl);
  const jobName =
    target.kind === "profile"
      ? target.username!
      : (target.highlightId ?? target.shortcode ?? target.storyId ?? target.username ?? "story");
  const jobDir = path.join(outDir, jobName);
  const records: PostRecord[] = [];
  for (const entry of await readdir(jobDir, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    const meta = await readFile(
      path.join(jobDir, entry.name, "meta.json"),
      "utf8",
    ).catch(() => null);
    if (!meta) continue;
    const record = JSON.parse(meta) as PostRecord;
    for (const m of record.media)
      if (m.localPath) m.localPath = `${jobName}/${m.localPath}`;
    records.push(record);
  }
  return records;
}

async function runJob(
  jobsDir: string,
  job: JobState,
  opts: CrawlOptions,
): Promise<void> {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  await saveJob(jobsDir, job);
  try {
    const crawlOpts: CrawlOptions = {
      ...opts,
      onProgress: (e) => {
        if (e.type === "profile_listed") {
          job.progress = {
            stage: "listing",
            message: `Found ${e.posts} posts`,
            count: e.posts,
          };
        } else if (e.type === "post_saved") {
          job.progress = {
            stage: "downloading",
            message: `Saved ${e.url} (${e.media} media)`,
          };
        } else if (e.type === "post_partial") {
          job.progress = {
            stage: "downloading",
            message: `Partial save for ${e.url}`,
          };
        } else if (e.type === "failure") {
          job.progress = {
            stage: "warning",
            message: `Error: ${e.failure.message}`,
          };
        }
        job.updatedAt = new Date().toISOString();
        void saveJob(jobsDir, job).catch(() => {});
      },
    };
    job.summary = await runCrawl(crawlOpts);
    job.status = "succeeded";
  } catch (err) {
    job.status = "failed";
    job.error = (err as Error).message;
  }
  job.updatedAt = new Date().toISOString();
  await saveJob(jobsDir, job);
}

export function buildHandler(
  outDir: string,
  makeOptions: (inputUrl: string) => CrawlOptions,
) {
  const jobsDir = path.join(outDir, "jobs");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (
      req.method === "GET" &&
      !url.pathname.startsWith("/jobs") &&
      !url.pathname.startsWith("/media")
    ) {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.resolve(PUBLIC_DIR, rel);
      if (file.startsWith(PUBLIC_DIR + path.sep) || file === PUBLIC_DIR) {
        const f = Bun.file(file);
        if (await f.exists()) return new Response(f);
      }
      const index = Bun.file(path.join(PUBLIC_DIR, "index.html"));
      if (await index.exists()) return new Response(index);
      if (url.pathname === "/") {
        return new Response(DEV_HINT, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      let inputUrl = "";
      try {
        const body = (await req.json()) as { url?: unknown };
        inputUrl = typeof body.url === "string" ? body.url : "";
      } catch {
        return json(
          { error: "Request body must be JSON with a url field" },
          400,
        );
      }
      try {
        classifyUrl(inputUrl);
      } catch (err) {
        return json({ error: (err as Error).message }, 400);
      }
      const now = new Date().toISOString();
      const job: JobState = {
        id: randomUUID(),
        inputUrl,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      await saveJob(jobsDir, job);
      void runJob(jobsDir, job, makeOptions(inputUrl));
      return json(job, 202);
    }

    const posts = url.pathname.match(/^\/jobs\/([^/]+)\/posts$/);
    if (req.method === "GET" && posts) {
      const job = await loadJob(jobsDir, posts[1]!);
      if (!job) return json({ error: "job not found" }, 404);
      return json(await loadJobPosts(outDir, job));
    }

    const m = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const job = await loadJob(jobsDir, m[1]!);
      return job ? json(job) : json({ error: "job not found" }, 404);
    }

    const media = url.pathname.match(/^\/media\/(.+)$/);
    if (req.method === "GET" && media) {
      const rel = decodeURIComponent(media[1]!);
      const file = path.resolve(outDir, rel);
      if (
        !file.startsWith(outDir + path.sep) ||
        file.includes(`${path.sep}jobs${path.sep}`)
      ) {
        return json({ error: "not found" }, 404);
      }
      const f = Bun.file(file);
      return (await f.exists())
        ? new Response(f)
        : json({ error: "not found" }, 404);
    }

    return json({ error: "not found" }, 404);
  };
}

if (import.meta.main) {
  let cookies: CrawlOptions["cookies"];
  const cookiesFile = process.env.IG_COOKIES_FILE;
  if (cookiesFile) {
    try {
      cookies = JSON.parse(
        await readFile(cookiesFile, "utf8"),
      ) as CrawlOptions["cookies"];
    } catch (err) {
      console.warn("Failed to load IG_COOKIES_FILE:", (err as Error).message);
    }
  }

  const handle = buildHandler(OUT_DIR, (inputUrl) => ({
    inputUrl,
    outDir: OUT_DIR,
    maxPosts: Number(process.env.MAX_POSTS ?? 12),
    maxConcurrency: Number(process.env.CONCURRENCY ?? 2),
    maxRequestRetries: Number(process.env.REQUEST_RETRIES ?? 2),
    navigationTimeoutSecs: 60,
    handlerTimeoutSecs: 240,
    downloadTimeoutMs: 60_000,
    downloadRetries: 3,
    maxMediaBytes: 500 * 1024 * 1024,
    storageDir: path.resolve("storage"),
    maxScrollSteps: 40,
    cookies,
  }));
  Bun.serve({ port: PORT, fetch: handle });
  console.log(`dropclip API on http://localhost:${PORT}`);
}
