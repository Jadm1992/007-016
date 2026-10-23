#!/usr/bin/env bun
// Usage: bun run src/cli.ts <instagram-url> [--out DIR] [--max-posts N]
// Env: IG_COOKIES_FILE (optional JSON array of browser-exported cookies), CONCURRENCY, MAX_SCROLL_STEPS,
//      REQUEST_RETRIES, NAV_TIMEOUT_SECS, HANDLER_TIMEOUT_SECS, DOWNLOAD_TIMEOUT_MS, DOWNLOAD_RETRIES, MAX_MEDIA_MB
import path from "node:path";
import { readFile } from "node:fs/promises";
import { runCrawl, type CrawlOptions, type ProgressEvent } from "./crawler.ts";
import { classifyUrl } from "./url.ts";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    } else positional.push(a);
  }
  return { positional, flags };
}

const env = (k: string, d: number) => {
  const v = process.env[k];
  const n = v === undefined ? d : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a non-negative number`);
  return n;
};

const { positional, flags } = parseArgs(process.argv.slice(2));
const inputUrl = positional[0];
if (!inputUrl) {
  console.error("Usage: bun run src/cli.ts <instagram-url> [--out DIR] [--max-posts N]");
  process.exit(2);
}

let classified;
try {
  classified = classifyUrl(inputUrl);
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

const cookies = process.env.IG_COOKIES_FILE
  ? (JSON.parse(await readFile(process.env.IG_COOKIES_FILE, "utf8")) as CrawlOptions["cookies"])
  : undefined;

const opts: CrawlOptions = {
  inputUrl,
  outDir: path.resolve(flags.out ?? "downloads"),
  maxPosts: Number(flags["max-posts"] ?? env("MAX_POSTS", 12)),
  maxConcurrency: env("CONCURRENCY", 2),
  maxRequestRetries: env("REQUEST_RETRIES", 2),
  navigationTimeoutSecs: env("NAV_TIMEOUT_SECS", 60),
  handlerTimeoutSecs: env("HANDLER_TIMEOUT_SECS", 240),
  downloadTimeoutMs: env("DOWNLOAD_TIMEOUT_MS", 60_000),
  downloadRetries: env("DOWNLOAD_RETRIES", 3),
  maxMediaBytes: env("MAX_MEDIA_MB", 500) * 1024 * 1024,
  storageDir: path.resolve("storage"),
  cookies,
  maxScrollSteps: env("MAX_SCROLL_STEPS", 40),
  onProgress: (e: ProgressEvent) => {
    if (e.type === "post_saved") console.log(`saved   ${e.url} (${e.media} media)`);
    else if (e.type === "post_partial") console.log(`partial ${e.url}: ${e.errors.join("; ")}`);
    else if (e.type === "failure") console.log(`failed  [${e.failure.kind}] ${e.failure.url}: ${e.failure.message}`);
    else if (e.type === "profile_listed") console.log(`listed  ${e.posts} post links from ${e.url}`);
  },
};

console.log(`crawl ${classified.kind} ${classified.canonicalUrl} -> ${opts.outDir}`);
const summary = await runCrawl(opts);
console.log(JSON.stringify({ saved: summary.postsSaved, partial: summary.postsPartial, failed: summary.postsFailed, failures: summary.failures.length }));
process.exit(summary.postsSaved + summary.postsPartial > 0 || summary.failures.length === 0 ? 0 : 1);
