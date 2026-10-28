import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchSaveFromMedia } from "../src/crawler.ts";
import { downloadMedia } from "../src/download.ts";

describe("Live Instagram story media verification", () => {
  let liveVideoUrl = "";
  let liveImageUrl = "";

  beforeAll(async () => {
    try {
      const hRecords = await fetchSaveFromMedia(
        "https://www.instagram.com/stories/highlights/18118228273512957/",
        "18118228273512957",
        "arybaryxo",
        "highlight",
      );
      const videoItem = hRecords?.flatMap((r) => r.media).find((m) => m.type === "video");
      if (videoItem?.sourceUrl) liveVideoUrl = videoItem.sourceUrl;
    } catch {}

    try {
      const sRecords = await fetchSaveFromMedia(
        "https://www.instagram.com/stories/instagram/",
        "story",
        "instagram",
        "story",
      );
      const imageItem = sRecords?.flatMap((r) => r.media).find((m) => m.type === "image");
      if (imageItem?.sourceUrl) liveImageUrl = imageItem.sourceUrl;
    } catch {}
  }, 25000);

  test("downloads real live Instagram story video and verifies MP4 file signature and extension", async () => {
    expect(liveVideoUrl).toBeTruthy();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-live-"));
    try {
      const res = await downloadMedia(
        { index: 0, type: "video", sourceUrl: liveVideoUrl, status: "pending" },
        tmp,
        { timeoutMs: 25000, retries: 1, maxBytes: 50 * 1024 * 1024 },
      );
      expect(res.fileName).toBe("01.mp4");
      expect(res.mimeType).toBe("video/mp4");
      expect(res.bytes).toBeGreaterThan(1000);
      console.log(
        `Live video story downloaded: ${res.bytes} bytes, file=${res.fileName}, mime=${res.mimeType}`,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30000);

  test("downloads real live Instagram story image and verifies JPEG file signature and extension", async () => {
    expect(liveImageUrl).toBeTruthy();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-live-img-"));
    try {
      const res = await downloadMedia(
        { index: 0, type: "image", sourceUrl: liveImageUrl, status: "pending" },
        tmp,
        { timeoutMs: 25000, retries: 1, maxBytes: 50 * 1024 * 1024 },
      );
      expect(res.fileName).toBe("01.jpg");
      expect(res.mimeType).toBe("image/jpeg");
      expect(res.bytes).toBeGreaterThan(1000);
      console.log(
        `Live image story downloaded: ${res.bytes} bytes, file=${res.fileName}, mime=${res.mimeType}`,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30000);
});
