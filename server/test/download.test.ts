import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyFailure } from "../src/crawler.ts";
import {
  downloadMedia,
  extensionFor,
  fileMatches,
  isAcceptableMime,
  mediaFileName,
} from "../src/download.ts";
import type { MediaItem } from "../src/types.ts";

let server: ReturnType<typeof Bun.serve>;
let tmp: string;
const jpeg = new Uint8Array(4096).map((_, i) => (i * 31) & 0xff);
const hits: Record<string, number> = {};
let flaky = 0;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-test-"));
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      hits[p] = (hits[p] ?? 0) + 1;
      if (p === "/image.jpg")
        return new Response(jpeg, {
          headers: { "content-type": "image/jpeg" },
        });
      if (p === "/video.mp4")
        return new Response(jpeg, { headers: { "content-type": "video/mp4" } });
      if (p === "/html")
        return new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        });
      if (p === "/missing") return new Response("nope", { status: 404 });
      if (p === "/rate") return new Response("slow down", { status: 429 });
      if (p === "/flaky") {
        flaky++;
        if (flaky < 3) return new Response("oops", { status: 503 });
        return new Response(jpeg, {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (p === "/slow")
        return new Promise((r) =>
          setTimeout(
            () =>
              r(
                new Response(jpeg, {
                  headers: { "content-type": "image/jpeg" },
                }),
              ),
            2000,
          ),
        );
      if (p === "/big")
        return new Response(new Uint8Array(10_000), {
          headers: { "content-type": "image/jpeg" },
        });
      return new Response("unknown", { status: 500 });
    },
  });
});

afterAll(async () => {
  server.stop(true);
  await rm(tmp, { recursive: true, force: true });
});

const opts = { timeoutMs: 500, retries: 3, maxBytes: 1_000_000 };
const item = (type: "image" | "video", p: string, index = 0): MediaItem => ({
  index,
  type,
  sourceUrl: `${server.url.href}${p.slice(1)}`,
  status: "pending",
});

describe("downloadMedia", () => {
  test("streams a valid image to disk with the exact byte count", async () => {
    const dir = path.join(tmp, "post-a");
    const r = await downloadMedia(item("image", "/image.jpg"), dir, opts);
    expect(r.fileName).toBe("01.jpg");
    expect(r.bytes).toBe(jpeg.byteLength);
    const onDisk = await readFile(path.join(dir, r.fileName));
    expect(onDisk.equals(Buffer.from(jpeg))).toBe(true);
    expect(await fileMatches(path.join(dir, r.fileName), r.bytes)).toBe(true);
    expect((await readdir(dir)).some((f) => f.endsWith(".part"))).toBe(false);
  });

  test("saves a video as mp4", async () => {
    const dir = path.join(tmp, "post-v");
    const r = await downloadMedia(item("video", "/video.mp4", 1), dir, opts);
    expect(r.fileName).toBe("02.mp4");
    expect(r.mimeType).toBe("video/mp4");
  });

  test("rejects an unexpected content type without leaving a file", async () => {
    const dir = path.join(tmp, "post-html");
    await expect(
      downloadMedia(item("image", "/html"), dir, opts),
    ).rejects.toThrow("Unexpected content-type");
    await expect(stat(path.join(dir, "01.jpg"))).rejects.toThrow();
  });

  test("does not retry a 404 and reports it", async () => {
    const before = hits["/missing"] ?? 0;
    await expect(
      downloadMedia(
        item("image", "/missing"),
        path.join(tmp, "post-404"),
        opts,
      ),
    ).rejects.toThrow("HTTP 404");
    expect((hits["/missing"] ?? 0) - before).toBe(1);
  });

  test("retries 503 responses and succeeds on a later attempt", async () => {
    flaky = 0;
    const r = await downloadMedia(
      item("image", "/flaky"),
      path.join(tmp, "post-flaky"),
      opts,
    );
    expect(r.bytes).toBe(jpeg.byteLength);
    expect(flaky).toBe(3);
  });

  test("gives up after the retry limit on a persistent 429", async () => {
    const before = hits["/rate"] ?? 0;
    await expect(
      downloadMedia(item("image", "/rate"), path.join(tmp, "post-rate"), {
        ...opts,
        retries: 2,
      }),
    ).rejects.toThrow("429");
    expect((hits["/rate"] ?? 0) - before).toBe(3);
  });

  test("times out a slow response and reports a timeout", async () => {
    await expect(
      downloadMedia(item("image", "/slow"), path.join(tmp, "post-slow"), {
        ...opts,
        retries: 0,
        timeoutMs: 200,
      }),
    ).rejects.toThrow("Timed out");
  });

  test("refuses a response larger than the byte limit", async () => {
    await expect(
      downloadMedia(item("image", "/big"), path.join(tmp, "post-big"), {
        ...opts,
        maxBytes: 1000,
      }),
    ).rejects.toThrow("exceeds limit");
    const files = await readdir(path.join(tmp, "post-big")).catch(() => []);
    expect(
      files.filter((f) => f.endsWith(".part") || f.endsWith(".jpg")),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  test("file names depend only on index and extension", () => {
    expect(mediaFileName(0, "jpg")).toBe("01.jpg");
    expect(mediaFileName(11, "mp4")).toBe("12.mp4");
  });

  test("extension and MIME checks", () => {
    expect(extensionFor("image/png; charset=x", "image")).toBe("png");
    expect(extensionFor(null, "video")).toBe("mp4");
    expect(isAcceptableMime("video/mp4", "video")).toBe(true);
    expect(isAcceptableMime("image/webp", "image")).toBe(true);
    expect(isAcceptableMime("text/html", "image")).toBe(false);
    expect(isAcceptableMime("image/jpeg", "video")).toBe(false);
  });

  test("classifyFailure maps common signals to failure kinds", () => {
    expect(classifyFailure("x", 429)).toBe("rate_limited");
    expect(classifyFailure("Instagram challenge page detected")).toBe(
      "challenge",
    );
    expect(classifyFailure("login_required: no post links")).toBe(
      "login_required",
    );
    expect(classifyFailure("x", 404)).toBe("not_found");
    expect(classifyFailure("Timeout 60000ms exceeded")).toBe("timeout");
    expect(classifyFailure("No media found for url")).toBe(
      "malformed_metadata",
    );
    expect(classifyFailure("something odd")).toBe("unknown");
  });
});
