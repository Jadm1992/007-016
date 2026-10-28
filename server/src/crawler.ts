import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Configuration, PlaywrightCrawler, RequestQueue } from "crawlee";
import { downloadMedia, fileMatches, UA } from "./download.ts";
import {
  ExtractionError,
  extractHighlightFromHtml,
  extractHighlightFromPayloads,
  extractPost,
  extractPostFromMediaInfo,
  extractFromSnabrixPayload,
  extractStorySequenceFromHtml,
  postLinksFromHrefs,
} from "./extract.ts";
import type { FailureKind, MediaItem, PostRecord, RequestFailure } from "./types.ts";
import {
  type ClassifiedUrl,
  classifyUrl,
  highlightFetchUrls,
  highlightReelsMediaRequest,
  postMediaInfoRequest,
  shortcodeToMediaId,
  snabrixGatewayUrl,
} from "./url.ts";

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

async function saveRecords(
  records: PostRecord[],
  jobDir: string,
  downloadOpts: {
    timeoutMs: number;
    retries: number;
    maxBytes: number;
    cookieHeader?: string;
  },
  summary: CrawlSummary,
  onProgress?: (e: ProgressEvent) => void,
): Promise<number> {
  let anySaved = 0;
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
      anySaved += savedCount;
      summary.postsSaved++;
      onProgress?.({ type: "post_saved", url: rec.canonicalUrl, media: savedCount });
    }
  }
  return anySaved;
}

export function highlightNeedsLogin(html: string, apiBody = ""): boolean {
  const text = `${html}\n${apiBody}`.toLowerCase();
  if (text.includes("sign up to see more story highlights")) return true;
  if (text.includes("view more highlights") && text.includes("sign up")) return true;
  if (text.includes('"reels":{}') || text.includes('"reels": {}')) return true;
  return (
    html.includes('reels_media__connection":{"edges":[]') ||
    html.includes('reels_media__connection\\":{\\"edges\\":[]')
  );
}

export async function runCrawl(opts: CrawlOptions): Promise<CrawlSummary> {
  const root = classifyUrl(opts.inputUrl);
  const jobName =
    root.kind === "profile"
      ? root.username!
      : (root.highlightId ?? root.shortcode ?? root.storyId ?? root.username ?? "story");
  const jobDir = path.join(opts.outDir, jobName);
  await mkdir(jobDir, { recursive: true });

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

  // Direct fast-path for standalone posts/reels/tv
  if (
    (root.kind === "post" || root.kind === "reel" || root.kind === "tv") &&
    root.shortcode
  ) {
    const shortcode = root.shortcode;
    const dir = path.join(jobDir, shortcode);
    const existing = await loadPostRecord(dir);
    if (existing && (await postIsComplete(dir, existing))) {
      summary.postsSaved++;
      opts.onProgress?.({ type: "post_saved", url: root.canonicalUrl, media: existing.media.length });
      await writeAtomic(
        path.join(jobDir, "job.json"),
        JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }, null, 2),
      );
      return summary;
    }

    let directRecords: PostRecord[] | null = null;
    const apiData = await fetchPostMediaInfo(shortcode, opts.cookies);
    if (apiData) {
      try {
        directRecords = [extractPostFromMediaInfo(apiData, root.canonicalUrl, shortcode, root.username)];
      } catch {}
    }
    if (!directRecords) {
      directRecords = await fetchSaveFromMedia(root.canonicalUrl, shortcode, root.username, root.kind);
    }
    if (!directRecords) {
      const snabrixText = await fetchSnabrixGateway(root.canonicalUrl);
      if (snabrixText) {
        const rec = extractFromSnabrixPayload(snabrixText, root.canonicalUrl, shortcode, root.username);
        if (rec) directRecords = [rec];
      }
    }

    if (directRecords && directRecords.length > 0) {
      const savedCount = await saveRecords(directRecords, jobDir, downloadOpts, summary, opts.onProgress);
      if (savedCount > 0) {
        await writeAtomic(
          path.join(jobDir, "job.json"),
          JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }, null, 2),
        );
        return summary;
      }
    }
  }

  // Direct fast-path for highlights
  if (root.kind === "highlight" && root.highlightId) {
    const highlightId = root.highlightId;
    let highlightRecords: PostRecord[] | null = null;
    if (opts.cookies?.length) {
      const directBody = await fetchHighlightReelsMedia(highlightId, opts.cookies);
      if (directBody) {
        const recs = extractHighlightFromPayloads([directBody], highlightId, root.canonicalUrl);
        if (recs.length > 0) highlightRecords = recs;
      }
    }
    if (!highlightRecords) {
      highlightRecords = await fetchSaveFromMedia(root.canonicalUrl, highlightId, root.username, "highlight");
    }
    if (highlightRecords && highlightRecords.length > 0) {
      const savedCount = await saveRecords(highlightRecords, jobDir, downloadOpts, summary, opts.onProgress);
      if (savedCount > 0) {
        await writeAtomic(
          path.join(jobDir, "job.json"),
          JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }, null, 2),
        );
        return summary;
      }
    }
  }

  // Direct fast-path for stories
  if (root.kind === "story") {
    const fallbackCode = root.storyId ?? root.username ?? "story";
    let storyRecords: PostRecord[] | null = null;
    storyRecords = await fetchSaveFromMedia(root.canonicalUrl, fallbackCode, root.username, "story");
    if (!storyRecords && root.username) {
      storyRecords = await fetchSaveFromMedia(
        `https://www.instagram.com/stories/${root.username}/`,
        fallbackCode,
        root.username,
        "story",
      );
    }
    if (storyRecords && storyRecords.length > 0) {
      const savedCount = await saveRecords(storyRecords, jobDir, downloadOpts, summary, opts.onProgress);
      if (savedCount > 0) {
        await writeAtomic(
          path.join(jobDir, "job.json"),
          JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }, null, 2),
        );
        return summary;
      }
    }
  }

  const captured = new Map<string, string[]>();
  const crawlRunId = randomUUID();
  const config = new Configuration({ persistStorage: false });
  const queue = await RequestQueue.open(`queue-${crawlRunId}`, { config });
  const crawler = new PlaywrightCrawler(
    {
      requestQueue: queue,
    maxConcurrency: opts.maxConcurrency,
    maxRequestRetries: opts.maxRequestRetries,
    navigationTimeoutSecs: opts.navigationTimeoutSecs,
    requestHandlerTimeoutSecs: opts.handlerTimeoutSecs,
    maxRequestsPerCrawl: opts.maxPosts + 50,
    launchContext: { launchOptions: { headless: true }, userAgent: UA },
    preNavigationHooks: [
      async ({ page, request }) => {
        if (opts.cookies?.length) await page.context().addCookies(opts.cookies);
        if (request.userData.label !== highlightLabel && request.userData.label !== "STORY") return;
        const payloads: string[] = [];
        captured.set(request.uniqueKey, payloads);
        page.on("response", (response) => {
          const url = response.url();
          if (!/graphql|reels_media|highlight|api\/v1/i.test(url)) return;
          void response.text().then((body) => {
            if (body && body.length > 50) payloads.push(body);
          }).catch(() => {});
        });
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
        const pages = highlightFetchUrls(opts.inputUrl, highlightId);
        const payloads = captured.get(request.uniqueKey) ?? [];
        const directBody = await fetchHighlightReelsMedia(highlightId, opts.cookies);
        if (directBody) payloads.push(directBody);
        let records = extractHighlightFromPayloads(payloads, highlightId, root.canonicalUrl);
        let sawLoginWall = false;
        if (records.length === 0) for (let i = 0; i < pages.length && records.length === 0; i++) {
          if (i > 0) {
            await page
              .goto(pages[i]!, {
                waitUntil: "domcontentloaded",
                timeout: opts.navigationTimeoutSecs * 1000,
              })
              .catch(() => null);
            if (/^\/accounts\/login\b/.test(new URL(page.url()).pathname)) {
              throw Object.assign(new Error("login_required: redirected to the Instagram login page"), {
                failureKind: "login_required",
              });
            }
          }
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          const apiBody = await page
            .evaluate(async (id) => {
              const res = await fetch(`/api/v1/feed/reels_media/?reel_ids=highlight:${id}`, {
                headers: { "x-ig-app-id": "936619743392459" },
              }).catch(() => null);
              return res && res.ok ? await res.text() : "";
            }, highlightId)
            .catch(() => "");
          if (apiBody) payloads.push(apiBody);
          const html = await page.content();
          if (highlightNeedsLogin(html, apiBody)) sawLoginWall = true;
          const fromPayloads = extractHighlightFromPayloads(payloads, highlightId, root.canonicalUrl);
          records = fromPayloads.length
            ? fromPayloads
            : extractHighlightFromHtml(html, highlightId, root.canonicalUrl);
        }
        if (records.length === 0) {
          records = (await fetchSaveFromMedia(root.canonicalUrl, highlightId, root.username, "highlight")) ?? [];
        }
        if (records.length === 0) {
          if (sawLoginWall) {
            throw Object.assign(
              new Error(
                `login_required: Instagram is hiding highlight ${highlightId} behind a signup wall. Pass a logged-in session via IG_COOKIES_FILE.`,
              ),
              { failureKind: "login_required" },
            );
          }
          throw Object.assign(
            new Error(`no highlight items found for ${highlightId} (captured ${payloads.length} responses)`),
            { failureKind: "malformed_metadata" },
          );
        }
        await saveRecords(records, jobDir, downloadOpts, summary, opts.onProgress);
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
              if (storyRecords.length > 0) {
                await saveRecords(storyRecords, jobDir, downloadOpts, summary, opts.onProgress);
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

      if (label === "STORY" || target.kind === "story") {
        const storyHtml = await page.content();
        let storyRecords = extractStorySequenceFromHtml(storyHtml, target.canonicalUrl, owner);
        if (storyRecords.length === 0) {
          const fallbackCode = target.storyId ?? owner ?? "story";
          storyRecords = (await fetchSaveFromMedia(target.canonicalUrl, fallbackCode, owner, "story")) ?? [];
          if (storyRecords.length === 0 && target.username) {
            storyRecords = (await fetchSaveFromMedia(
              `https://www.instagram.com/stories/${target.username}/`,
              fallbackCode,
              owner,
              "story",
            )) ?? [];
          }
        }
        if (storyRecords.length > 0) {
          const savedCount = await saveRecords(storyRecords, jobDir, downloadOpts, summary, opts.onProgress);
          if (savedCount === 0) {
            throw Object.assign(new Error(`All media downloads failed for ${request.url}`), {
              failureKind: "download_failed",
            });
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

      let record: PostRecord | null = null;
      if (shortcode && shortcode !== "story") {
        const apiData = await fetchPostMediaInfo(shortcode, opts.cookies);
        if (apiData) {
          try {
            record = extractPostFromMediaInfo(apiData, target.canonicalUrl, shortcode, owner);
          } catch {}
        }
        if (!record) {
          const recs = await fetchSaveFromMedia(
            target.canonicalUrl,
            shortcode,
            owner,
            target.kind === "profile" ? "post" : target.kind,
          );
          if (recs && recs.length > 0) record = recs[0]!;
        }
        if (!record) {
          const snabrixText = await fetchSnabrixGateway(target.canonicalUrl);
          if (snabrixText) {
            record = extractFromSnabrixPayload(snabrixText, target.canonicalUrl, shortcode, owner);
          }
        }
      }
      if (!record) {
        const html = await page.content();
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
      if (
        request.userData.label === postLabel ||
        request.userData.label === highlightLabel ||
        request.userData.label === "STORY"
      )
        summary.postsFailed++;
      recordFailure(request.url, kind, error.message);
    },
    },
    config,
  );

  const startLabel =
    root.kind === "profile"
      ? listLabel
      : root.kind === "highlight"
        ? highlightLabel
        : root.kind === "story"
          ? "STORY"
          : postLabel;
  const startUrl =
    root.kind === "highlight" && root.highlightId
      ? highlightFetchUrls(opts.inputUrl, root.highlightId)[0]!
      : root.canonicalUrl;
  await crawler.run([{ url: startUrl, userData: { label: startLabel, owner: root.username } }]);

  await writeAtomic(
    path.join(jobDir, "job.json"),
    JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }, null, 2),
  );
  return summary;
}

function cookieHeaderFrom(cookies: CrawlOptions["cookies"]): string {
  return (cookies ?? []).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

// Same call FastDl makes after its WebView has an Instagram session cookie.
async function fetchHighlightReelsMedia(
  highlightId: string,
  cookies: CrawlOptions["cookies"],
): Promise<string> {
  const req = highlightReelsMediaRequest(highlightId, cookieHeaderFrom(cookies));
  const res = await fetch(req.url, { headers: req.headers }).catch(() => null);
  if (!res?.ok) return "";
  return res.text();
}

async function fetchPostMediaInfo(
  shortcode: string,
  cookies: CrawlOptions["cookies"],
): Promise<unknown | null> {
  try {
    const mediaId = /^\d+$/.test(shortcode) ? shortcode : shortcodeToMediaId(shortcode);
    const req = postMediaInfoRequest(mediaId, cookieHeaderFrom(cookies));
    const res = await fetch(req.url, { headers: req.headers }).catch(() => null);
    if (!res?.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchSnabrixGateway(
  canonicalUrl: string,
): Promise<string> {
  try {
    const url = snabrixGatewayUrl(canonicalUrl);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        Referer: "https://snabrix.com/",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }).catch(() => null);
    if (!res?.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

export async function fetchSaveFromMedia(
  targetUrl: string,
  shortcode: string,
  owner?: string,
  kind: PostRecord["kind"] = "post",
): Promise<PostRecord[] | null> {
  try {
    const res = await fetch("https://worker.downloadhelper.app/savefrom.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      },
      body: new URLSearchParams({
        sf_url: targetUrl,
        sf_submit: "",
        new: "1",
        lang: "en",
        app: "savefrom-android",
        version: "3.2.20",
      }).toString(),
    }).catch(() => null);

    if (!res?.ok) return null;
    const html = await res.text();
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch || !scriptMatch[1]) return null;

    const script = scriptMatch[1];
    const fnMatch = script.match(
      /this\.(_[a-z])=function\(a,b\)\{\[\]\["filter"\]\["constructor"\]\(b\)\.call\(a\);?\};/,
    );
    if (!fnMatch || !fnMatch[1]) return null;
    const fnName = fnMatch[1];

    const hookedScript = script.replace(
      /this\._[a-z]=function\(a,b\)\{\[\]\["filter"\]\["constructor"\]\(b\)\.call\(a\);?\};/,
      `let __j_count = 0;
       this.${fnName} = function(a, b) {
         __j_count++;
         if (__j_count === 1) {
           eval(b);
         } else {
           finalPayload = b;
         }
       };`,
    );

    const unwrapFn = new Function("let finalPayload = \"\";\n" + hookedScript + "\nreturn finalPayload;");
    const unpacked = unwrapFn();
    if (!unpacked) return null;

    type SaveFromRow = {
      type?: string;
      response?: number;
      success?: boolean;
      url?: { url?: string; ext?: string; name?: string }[];
      meta?: {
        title?: string;
        username?: string;
        taken_at?: number | string;
        like_count?: number | null;
      };
    };

    let rows: SaveFromRow[] | null = null;
    const window = {
      location: { hostname: "localhost" },
      parent: {
        document: { getElementById: () => ({ innerHTML: "loading" }) },
        sf: {
          finishRequest: () => {},
          enableElement: () => {},
          videoResult: {
            showRows: (r: SaveFromRow[]) => {
              rows = r;
            },
            show: (r: SaveFromRow) => {
              rows = [r];
            },
          },
          result: {
            showRows: (r: SaveFromRow[]) => {
              rows = r;
            },
            show: (r: SaveFromRow) => {
              rows = [r];
            },
          },
        },
      },
    };
    const document = { body: { firstChild: null, removeChild: () => {} } };

    const runShow = new Function("window", "document", unpacked);
    runShow(window, document);

    const resultRows = rows as SaveFromRow[] | null;
    if (!resultRows || resultRows.length === 0 || resultRows[0]?.response === 4 || resultRows[0]?.success === false) return null;

    if (kind === "story" || kind === "highlight") {
      const records: PostRecord[] = [];
      const fetchedAt = new Date().toISOString();
      for (let i = 0; i < resultRows.length; i++) {
        const row = resultRows[i]!;
        const u = row.url?.[0]?.url;
        if (!u) continue;
        const isVideo = row.type === "mp4" || row.url?.[0]?.ext === "mp4" || u.includes(".mp4");
        const mediaItem: MediaItem = {
          index: 0,
          type: isVideo ? "video" : "image",
          sourceUrl: u,
          mimeType: isVideo ? "video/mp4" : "image/jpeg",
          status: "pending",
        };
        const itemCode = kind === "highlight" ? `${shortcode}_${i + 1}` : `story_${i + 1}`;
        const itemUrl =
          kind === "highlight"
            ? targetUrl
            : `https://www.instagram.com/stories/${owner ?? row.meta?.username ?? "unknown"}/${itemCode}/`;
        records.push({
          canonicalUrl: itemUrl,
          shortcode: itemCode,
          kind,
          username: owner ?? row.meta?.username,
          caption: row.meta?.title ?? null,
          takenAt: row.meta?.taken_at ? String(row.meta.taken_at) : null,
          likeCount: row.meta?.like_count ?? null,
          commentCount: null,
          media: [mediaItem],
          extractionStatus: "complete",
          errors: ["extracted via SaveFrom core engine"],
          fetchedAt,
        });
      }
      return records.length > 0 ? records : null;
    }

    const media: MediaItem[] = [];
    resultRows.forEach((row, i) => {
      const u = row.url?.[0]?.url;
      if (!u) return;
      const isVideo = row.type === "mp4" || row.url?.[0]?.ext === "mp4" || u.includes(".mp4");
      media.push({
        index: i,
        type: isVideo ? "video" : "image",
        sourceUrl: u,
        mimeType: isVideo ? "video/mp4" : "image/jpeg",
        status: "pending",
      });
    });

    if (media.length === 0) return null;

    const firstMeta = resultRows[0]?.meta;
    return [
      {
        canonicalUrl: targetUrl,
        shortcode,
        kind: media.some((m) => m.type === "video") ? "reel" : "post",
        username: owner ?? firstMeta?.username,
        fetchedAt: new Date().toISOString(),
        caption: firstMeta?.title,
        takenAt: firstMeta?.taken_at ? String(firstMeta.taken_at) : null,
        likeCount: firstMeta?.like_count ?? null,
        commentCount: null,
        media,
        extractionStatus: "complete",
        errors: ["extracted via SaveFrom core engine"],
      },
    ];
  } catch {
    return null;
  }
}
