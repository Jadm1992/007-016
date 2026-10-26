import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PlaywrightCrawler, RequestQueue } from "crawlee";
import { downloadMedia, fileMatches, UA } from "./download.ts";
import {
  ExtractionError,
  extractHighlightFromHtml,
  extractHighlightFromPayloads,
  extractPost,
  extractStorySequenceFromHtml,
  postLinksFromHrefs,
} from "./extract.ts";
import type { FailureKind, PostRecord, RequestFailure } from "./types.ts";
import { type ClassifiedUrl, classifyUrl } from "./url.ts";
export type CrawlOptions = {
  inputUrl: string;
  outDir: string;
  maxPosts: number;
  maxConcurrency: number;
  maxRequestRetries: number;
  navigationTimeoutSecs: number;
  handlerTimeoutSecs: number;
  downloadTimeoutMs: number;
  downloadRetries: number;
  maxMediaBytes: number;
  storageDir: string;
  cookieHeader?: string;
  cookies?: { name: string; value: string; domain: string; path: string }[];
  maxScrollSteps: number;
  onProgress?: (e: ProgressEvent) => void;
};

export type ProgressEvent =
  | { type: "post_saved"; url: string; media: number }
  | { type: "post_partial"; url: string; errors: string[] }
  | { type: "failure"; failure: RequestFailure }
  | { type: "profile_listed"; url: string; posts: number };

export type CrawlSummary = {
  inputUrl: string;
  kind: ClassifiedUrl["kind"];
  postsSaved: number;
  postsPartial: number;
  postsFailed: number;
  failures: RequestFailure[];
};

export function classifyFailure(
  message: string,
  status?: number,
  bodyHint = "",
): FailureKind {
  const text = `${message} ${bodyHint}`.toLowerCase();
  if (status === 429 || text.includes("rate limit") || text.includes("too many requests"))
    return "rate_limited";
  if (text.includes("checkpoint") || text.includes("challenge") || text.includes("suspicious"))
    return "challenge";
  if (status === 401 || status === 403 || text.includes("login") || text.includes("log in to"))
    return "login_required";
  if (status === 404 || text.includes("page not found") || text.includes("sorry, this page"))
    return "not_found";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("malformed") || text.includes("no media found") || text.includes("no highlight"))
    return "malformed_metadata";
  if (text.includes("http 4") || text.includes("http 5") || text.includes("blocked"))
    return "blocked";
  return "unknown";
}

async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export async function loadPostRecord(postDir: string): Promise<PostRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(postDir, "meta.json"), "utf8")) as PostRecord;
  } catch {
    return null;
  }
}

export async function postIsComplete(dir: string, record: PostRecord): Promise<boolean> {
  if (record.extractionStatus === "failed") return false;
  for (const m of record.media) {
    if (m.status !== "saved" || !m.localPath || m.bytes === undefined) return false;
    if (!(await fileMatches(path.join(dir, m.localPath), m.bytes))) return false;
  }
  return true;
}

export async function runCrawl(opts: CrawlOptions): Promise<CrawlSummary> {
  const root = classifyUrl(opts.inputUrl);
  const jobName =
    root.kind === "profile"
      ? root.username!
      : (root.highlightId ?? root.shortcode ?? root.storyId ?? "story");
  const jobDir = path.join(opts.outDir, jobName);
  await mkdir(jobDir, { recursive: true });
  const queueName = `dropclip-${root.canonicalUrl}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const jobFile = path.join(jobDir, "job.json");
  const previous = await readFile(jobFile, "utf8")
    .then((t) => JSON.parse(t) as { finishedAt?: string })
    .catch(() => null);
  if (!previous || previous.finishedAt)
    await (await RequestQueue.open(queueName)).drop();
  const queue = await RequestQueue.open(queueName);

  const summary: CrawlSummary = {
    inputUrl: root.canonicalUrl,
    kind: root.kind,
    postsSaved: 0,
    postsPartial: 0,
    postsFailed: 0,
    failures: [],
  };
  const seenPosts = new Set<string>();
  const postLabel = "POST";
  const listLabel = "PROFILE";
  const highlightLabel = "HIGHLIGHT";
  const downloadOpts = {
    timeoutMs: opts.downloadTimeoutMs,
    retries: opts.downloadRetries,
    maxBytes: opts.maxMediaBytes,
    cookieHeader: opts.cookieHeader ?? opts.cookies?.map((c) => `${c.name}=${c.value}`).join("; "),
  };

  const recordFailure = (url: string, kind: FailureKind, message: string) => {
    const failure: RequestFailure = { url, kind, message, at: new Date().toISOString() };
    summary.failures.push(failure);
    opts.onProgress?.({ type: "failure", failure });
  };

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    maxConcurrency: opts.maxConcurrency,
    maxRequestRetries: opts.maxRequestRetries,
    navigationTimeoutSecs: opts.navigationTimeoutSecs,
    requestHandlerTimeoutSecs: opts.handlerTimeoutSecs,
    maxRequestsPerCrawl: opts.maxPosts + 50,
    launchContext: { launchOptions: { headless: true }, userAgent: UA },
    preNavigationHooks: [
      async ({ page }) => {
        if (opts.cookies?.length) await page.context().addCookies(opts.cookies);
      },
    ],
    async requestHandler({ request, page, enqueueLinks }) {
      const label = request.userData.label as string | undefined;
      const finalUrl = new URL(page.url());
      if (/^\/(challenge|checkpoint)\b/.test(finalUrl.pathname)) {
        throw new Error("Instagram challenge page detected");
      }
      if (/^\/accounts\/login\b/.test(finalUrl.pathname)) {
        throw new Error("login_required: redirected to the Instagram login page");
      }

      if (label === highlightLabel) {
        const highlightId = root.highlightId;
        if (!highlightId) throw new Error("missing highlight id");
        const payloads: string[] = [];
        page.on("response", (response) => {
          const url = response.url();
          if (!/graphql|reels_media|highlight/i.test(url)) return;
          void response.text().then((body) => {
            if (body) payloads.push(body);
          }).catch(() => {});
        });
        await page.waitForSelector("video, img", { timeout: 15_000 }).catch(() => {});
        const apiBody = await page.evaluate(async (id) => {
          const res = await fetch(`/api/v1/feed/reels_media/?reel_ids=highlight:${id}`, {
            headers: { "x-ig-app-id": "936619743392459" },
          }).catch(() => null);
          return res && res.ok ? await res.text() : "";
        }, highlightId).catch(() => "");
        if (apiBody) payloads.push(apiBody);
        await page.waitForTimeout(1500);
        const html = await page.content();
        const fromPayloads = extractHighlightFromPayloads(payloads, highlightId, root.canonicalUrl);
        const records = fromPayloads.length
          ? fromPayloads
          : extractHighlightFromHtml(html, highlightId, root.canonicalUrl);
        if (records.length === 0) {
          throw Object.assign(new Error(`no highlight items found for ${highlightId}`), {
            failureKind: "malformed_metadata",
          });
        }
        for (const rec of records) {
          const dir = path.join(jobDir, rec.shortcode);
          await mkdir(dir, { recursive: true });
          for (const item of rec.media) {
            try {
              const saved = await downloadMedia(item, dir, downloadOpts);
              item.status = "saved";
              item.localPath = `${rec.shortcode}/${saved.fileName}`;
              item.bytes = saved.bytes;
              item.mimeType = saved.mimeType;
            } catch (err) {
              item.status = "failed";
              item.error = (err as Error).message;
              rec.errors.push(`media ${item.index}: ${item.error}`);
            }
          }
          const savedCount = rec.media.filter((m) => m.status === "saved").length;
          rec.extractionStatus =
            savedCount === rec.media.length ? "complete" : savedCount > 0 ? "partial" : "failed";
          await writeAtomic(path.join(dir, "meta.json"), JSON.stringify(rec, null, 2));
          if (savedCount > 0) {
            summary.postsSaved++;
            opts.onProgress?.({ type: "post_saved", url: rec.canonicalUrl, media: savedCount });
          }
        }
        return;
      }

      if (label === listLabel) {
        await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 20_000 }).catch(() => {});
        const collected: string[] = [];
        let stalled = 0;
        for (let step = 0; step < opts.maxScrollSteps && collected.length < opts.maxPosts; step++) {
          const hrefs = await page.$$eval(
            'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
            (as) => as.map((a) => a.getAttribute("href") ?? ""),
          );
          const before = collected.length;
          for (const url of postLinksFromHrefs(hrefs))
            if (!collected.includes(url)) collected.push(url);
          if (collected.length === before) stalled++;
          else stalled = 0;
          if (stalled >= 3) break;
          await page.evaluate(() => window.scrollBy(0, 2400)).catch(() => {});
          await page.mouse.wheel(0, 2400).catch(() => {});
          await page.waitForTimeout(1500);
        }
        const posts = collected.slice(0, opts.maxPosts);
        opts.onProgress?.({ type: "profile_listed", url: request.url, posts: posts.length });
        if (posts.length === 0) {
          throw new Error("login_required: no post links on profile page; the profile may need a logged-in session");
        }
        const storyAvatarSelector =
          'header [role="button"]:has(canvas), header a[href*="/stories/"], header [aria-label*="story" i]';
        const storyAvatar = await page.$(storyAvatarSelector).catch(() => null);
        if (storyAvatar) {
          try {
            await storyAvatar.click();
            await page.waitForTimeout(2000);
            if (page.url().includes("/stories/")) {
              const storyHtml = await page.content();
              const storyRecords = extractStorySequenceFromHtml(storyHtml, page.url(), root.username ?? "unknown");
              for (const sRec of storyRecords) {
                const sDir = path.join(jobDir, `story_${sRec.shortcode}`);
                await mkdir(sDir, { recursive: true });
                for (const item of sRec.media) {
                  try {
                    const saved = await downloadMedia(item, sDir, downloadOpts);
                    item.status = "saved";
                    item.localPath = `story_${sRec.shortcode}/${saved.fileName}`;
                    item.bytes = saved.bytes;
                    item.mimeType = saved.mimeType;
                  } catch (err) {
                    item.status = "failed";
                    item.error = (err as Error).message;
                    sRec.errors.push(`media ${item.index}: ${item.error}`);
                  }
                }
                const savedCount = sRec.media.filter((m) => m.status === "saved").length;
                sRec.extractionStatus =
                  savedCount === sRec.media.length ? "complete" : savedCount > 0 ? "partial" : "failed";
                await writeAtomic(path.join(sDir, "meta.json"), JSON.stringify(sRec, null, 2));
                if (savedCount > 0) {
                  summary.postsSaved++;
                  opts.onProgress?.({ type: "post_saved", url: sRec.canonicalUrl, media: savedCount });
                }
              }
              await page.goto(root.canonicalUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
            }
          } catch (e) {
            const msg = (e as Error).message;
            if (msg.includes("login")) recordFailure(request.url, "login_required", msg);
          }
        }
        const fresh = posts.filter((u) => !seenPosts.has(u));
        for (const u of fresh) seenPosts.add(u);
        await enqueueLinks({ urls: fresh, userData: { label: postLabel, owner: root.username } });
        return;
      }

      const currentUrl = page.url();
      const pageTarget = currentUrl.includes("/stories/") ? classifyUrl(currentUrl) : null;
      const target = pageTarget ?? classifyUrl(request.url);
      const owner = target.username ?? (request.userData.owner as string | undefined) ?? "unknown";

      if (target.kind === "story") {
        const storyHtml = await page.content();
        const storyRecords = extractStorySequenceFromHtml(storyHtml, target.canonicalUrl, owner);
        if (storyRecords.length > 0) {
          for (const sRec of storyRecords) {
            const sDir = path.join(jobDir, `story_${sRec.shortcode}`);
            await mkdir(sDir, { recursive: true });
            for (const item of sRec.media) {
              try {
                const saved = await downloadMedia(item, sDir, downloadOpts);
                item.status = "saved";
                item.localPath = `story_${sRec.shortcode}/${saved.fileName}`;
                item.bytes = saved.bytes;
                item.mimeType = saved.mimeType;
              } catch (err) {
                item.status = "failed";
                item.error = (err as Error).message;
                sRec.errors.push(`media ${item.index}: ${item.error}`);
              }
            }
            const savedCount = sRec.media.filter((m) => m.status === "saved").length;
            sRec.extractionStatus =
              savedCount === sRec.media.length ? "complete" : savedCount > 0 ? "partial" : "failed";
            await writeAtomic(path.join(sDir, "meta.json"), JSON.stringify(sRec, null, 2));
            if (savedCount > 0) {
              summary.postsSaved++;
              opts.onProgress?.({ type: "post_saved", url: sRec.canonicalUrl, media: savedCount });
            }
          }
          return;
        }
      }

      const shortcode =
        target.shortcode ?? target.storyId ?? (request.userData.shortcode as string | undefined) ?? "story";
      const dir = path.join(jobDir, shortcode);
      const existing = await loadPostRecord(dir);
      if (existing && (await postIsComplete(dir, existing))) {
        summary.postsSaved++;
        opts.onProgress?.({ type: "post_saved", url: request.url, media: existing.media.length });
        return;
      }

      const html = await page.content();
      let record: PostRecord;
      try {
        record = extractPost({
          html,
          canonicalUrl: target.canonicalUrl,
          shortcode,
          kind: target.kind === "profile" ? "post" : target.kind,
          username: owner,
        });
      } catch (err) {
        if (err instanceof ExtractionError) {
          throw Object.assign(new Error(err.message), { failureKind: err.kind });
        }
        throw err;
      }

      for (const item of record.media) {
        try {
          const saved = await downloadMedia(item, dir, downloadOpts);
          item.status = "saved";
          item.localPath = `${shortcode}/${saved.fileName}`;
          item.bytes = saved.bytes;
          item.mimeType = saved.mimeType;
        } catch (err) {
          item.status = "failed";
          item.error = (err as Error).message;
          record.errors.push(`media ${item.index}: ${item.error}`);
        }
      }
      const savedCount = record.media.filter((m) => m.status === "saved").length;
      if (savedCount === 0) record.extractionStatus = "failed";
      else if (savedCount < record.media.length || record.errors.length) record.extractionStatus = "partial";

      await mkdir(dir, { recursive: true });
      await writeAtomic(path.join(dir, "meta.json"), JSON.stringify(record, null, 2));

      if (record.extractionStatus === "failed") {
        throw Object.assign(new Error(`All media downloads failed for ${request.url}`), {
          failureKind: "download_failed",
        });
      }
      if (record.extractionStatus === "partial") {
        summary.postsPartial++;
        opts.onProgress?.({ type: "post_partial", url: request.url, errors: record.errors });
      } else {
        summary.postsSaved++;
        opts.onProgress?.({ type: "post_saved", url: request.url, media: savedCount });
      }
    },
    failedRequestHandler({ request }, error) {
      const kind =
        (error as Error & { failureKind?: FailureKind }).failureKind ?? classifyFailure(error.message);
      if (request.userData.label === postLabel) summary.postsFailed++;
      recordFailure(request.url, kind, error.message);
    },
  });

  const startLabel =
    root.kind === "profile" ? listLabel : root.kind === "highlight" ? highlightLabel : postLabel;
  await crawler.run([{ url: root.canonicalUrl, userData: { label: startLabel, owner: root.username } }]);

  await writeAtomic(
    path.join(jobDir, "job.json"),
    JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }, null, 2),
  );
  return summary;
}
