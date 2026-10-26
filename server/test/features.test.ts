import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHandler, type JobState, loadJob } from "../src/api.ts";
import type { CrawlOptions } from "../src/crawler.ts";
import {
  DownloadError,
  detectFileSignature,
  downloadMedia,
} from "../src/download.ts";
import {
  ExtractionError,
  extractPost,
  extractStorySequenceFromHtml,
  postLinksFromHrefs,
} from "../src/extract.ts";

describe("GraphQL edge_sidecar_to_children extraction", () => {
  test("extracts multi-item carousel containing images and videos as one parent post with media[]", () => {
    const graphqlCarousel = {
      shortcode: "GQLCAR99",
      taken_at_timestamp: 1710000000,
      edge_media_to_caption: {
        edges: [{ node: { text: "carousel from graphql" } }],
      },
      edge_sidecar_to_children: {
        edges: [
          {
            node: {
              is_video: false,
              display_resources: [
                {
                  src: "https://cdn.example/g_small.jpg",
                  config_width: 300,
                  config_height: 300,
                },
                {
                  src: "https://cdn.example/g_large.jpg",
                  config_width: 1080,
                  config_height: 1080,
                },
              ],
            },
          },
          {
            node: {
              is_video: true,
              video_url: "https://cdn.example/g_video.mp4",
              display_url: "https://cdn.example/g_poster.jpg",
            },
          },
        ],
      },
    };

    const html = `<html><body><script type="application/json">${JSON.stringify({
      entry_data: {
        PostPage: [{ graphql: { shortcode_media: graphqlCarousel } }],
      },
    })}</script></body></html>`;

    const res = extractPost({
      canonicalUrl: "https://www.instagram.com/p/GQLCAR99/",
      shortcode: "GQLCAR99",
      kind: "post",
      html,
    });

    expect(res.extractionStatus).toBe("complete");
    expect(res.media).toHaveLength(2);
    expect(res.media[0]).toMatchObject({
      index: 0,
      type: "image",
      sourceUrl: "https://cdn.example/g_large.jpg",
      mimeType: "image/jpeg",
    });
    expect(res.media[1]).toMatchObject({
      index: 1,
      type: "video",
      sourceUrl: "https://cdn.example/g_video.mp4",
      mimeType: "video/mp4",
    });
  });

  test("extracts direct video_url and display_url single nodes", () => {
    const singleNode = {
      shortcode: "SINGLE1",
      video_url: "https://cdn.example/clip.mp4",
      is_video: true,
    };
    const html = `<html><body><script type="application/json">${JSON.stringify({
      node: singleNode,
    })}</script></body></html>`;

    const res = extractPost({
      canonicalUrl: "https://www.instagram.com/reel/SINGLE1/",
      shortcode: "SINGLE1",
      kind: "reel",
      html,
    });

    expect(res.media).toHaveLength(1);
    expect(res.media[0]?.sourceUrl).toBe("https://cdn.example/clip.mp4");
    expect(res.media[0]?.type).toBe("video");
  });
});

describe("Story extraction & poster substitution prevention", () => {
  test("extracts video story using actual video URL and never substitutes poster image", () => {
    const videoStoryNode = {
      id: "99887766_123",
      pk: "99887766",
      media_type: 2,
      is_video: true,
      video_versions: [
        { url: "https://cdn.example/story_high.mp4", width: 720, height: 1280 },
      ],
      image_versions2: {
        candidates: [
          {
            url: "https://cdn.example/story_poster_do_not_use.jpg",
            width: 720,
            height: 1280,
          },
        ],
      },
    };
    const html = `<html><body><script type="application/json">${JSON.stringify({
      reels_media: [{ items: [videoStoryNode] }],
    })}</script></body></html>`;

    const res = extractPost({
      canonicalUrl: "https://www.instagram.com/stories/alice/99887766/",
      shortcode: "99887766",
      kind: "story",
      username: "alice",
      html,
    });

    expect(res.media).toHaveLength(1);
    expect(res.media[0]?.type).toBe("video");
    expect(res.media[0]?.sourceUrl).toBe("https://cdn.example/story_high.mp4");
    expect(res.media[0]?.mimeType).toBe("video/mp4");
  });

  test("throws an explicit extraction failure if video story has no video URL (no poster fallback)", () => {
    const videoWithoutUrl = {
      id: "77777777_123",
      pk: "77777777",
      media_type: 2,
      is_video: true,
      image_versions2: {
        candidates: [
          {
            url: "https://cdn.example/poster_only.jpg",
            width: 720,
            height: 1280,
          },
        ],
      },
    };
    const html = `<html><head><meta property="og:image" content="https://cdn.example/poster_og.jpg"></head><body><script type="application/json">${JSON.stringify(
      {
        reels_media: [{ items: [videoWithoutUrl] }],
      },
    )}</script></body></html>`;

    expect(() =>
      extractPost({
        canonicalUrl: "https://www.instagram.com/stories/alice/77777777/",
        shortcode: "77777777",
        kind: "story",
        username: "alice",
        html,
      }),
    ).toThrow(ExtractionError);
  });

  test("extracts pure image story correctly", () => {
    const imageStoryNode = {
      id: "55555555_123",
      pk: "55555555",
      media_type: 1,
      is_video: false,
      image_versions2: {
        candidates: [
          {
            url: "https://cdn.example/pure_image.jpg",
            width: 1080,
            height: 1920,
          },
        ],
      },
    };
    const html = `<html><body><script type="application/json">${JSON.stringify({
      reels_media: [{ items: [imageStoryNode] }],
    })}</script></body></html>`;

    const res = extractPost({
      canonicalUrl: "https://www.instagram.com/stories/alice/55555555/",
      shortcode: "55555555",
      kind: "story",
      username: "alice",
      html,
    });

    expect(res.media).toHaveLength(1);
    expect(res.media[0]?.type).toBe("image");
    expect(res.media[0]?.sourceUrl).toBe("https://cdn.example/pure_image.jpg");
    expect(res.media[0]?.mimeType).toBe("image/jpeg");
  });

  test("extracts entire sequence of accessible story items (mixed video and image)", () => {
    const sequence = {
      reels_media: [
        {
          user: { username: "bob" },
          items: [
            {
              id: "STORY_1_123",
              pk: "STORY_1",
              media_type: 2,
              video_versions: [
                { url: "https://cdn.example/s1.mp4", width: 720, height: 1280 },
              ],
              image_versions2: {
                candidates: [{ url: "https://cdn.example/s1_poster.jpg" }],
              },
            },
            {
              id: "STORY_2_123",
              pk: "STORY_2",
              media_type: 1,
              image_versions2: {
                candidates: [
                  {
                    url: "https://cdn.example/s2.jpg",
                    width: 1080,
                    height: 1920,
                  },
                ],
              },
            },
            {
              id: "STORY_3_123",
              pk: "STORY_3",
              media_type: 2,
              video_versions: [
                {
                  url: "https://cdn.example/s3.mp4",
                  width: 1080,
                  height: 1920,
                },
              ],
            },
          ],
        },
      ],
    };
    const html = `<html><body><script type="application/json">${JSON.stringify(sequence)}</script></body></html>`;

    const stories = extractStorySequenceFromHtml(
      html,
      "https://www.instagram.com/stories/bob/",
      "bob",
    );
    expect(stories).toHaveLength(3);

    expect(stories[0]!.shortcode).toBe("STORY");
    expect(stories[0]!.media[0]!.type).toBe("video");
    expect(stories[0]!.media[0]!.sourceUrl).toBe("https://cdn.example/s1.mp4");

    expect(stories[1]!.media[0]!.type).toBe("image");
    expect(stories[1]!.media[0]!.sourceUrl).toBe("https://cdn.example/s2.jpg");

    expect(stories[2]!.media[0]!.type).toBe("video");
    expect(stories[2]!.media[0]!.sourceUrl).toBe("https://cdn.example/s3.mp4");
  });
});

describe("File signature & MIME type validation during download", () => {
  const mp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]); // '....ftypisom'
  const jpegHeader = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]);

  test("detectFileSignature identifies JPEG, PNG, WebP, and MP4", () => {
    expect(detectFileSignature(jpegHeader)).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
      ext: "jpg",
    });
    expect(detectFileSignature(mp4Header)).toMatchObject({
      type: "video",
      mimeType: "video/mp4",
      ext: "mp4",
    });
  });

  test("rejects when server returns JPEG signature bytes for an expected video", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-sig-"));
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Buffer.concat([jpegHeader, Buffer.alloc(100)]), {
          headers: { "content-type": "video/mp4" },
        });
      },
    });

    try {
      await expect(
        downloadMedia(
          {
            index: 0,
            type: "video",
            sourceUrl: server.url.href,
            status: "pending",
          },
          tmp,
          { timeoutMs: 2000, retries: 0, maxBytes: 1024 * 1024 },
        ),
      ).rejects.toThrow(/file signature/);
    } finally {
      server.stop(true);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("rejects when server returns MP4 signature bytes for an expected image", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-sig2-"));
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Buffer.concat([mp4Header, Buffer.alloc(100)]), {
          headers: { "content-type": "image/jpeg" },
        });
      },
    });

    try {
      await expect(
        downloadMedia(
          {
            index: 0,
            type: "image",
            sourceUrl: server.url.href,
            status: "pending",
          },
          tmp,
          { timeoutMs: 2000, retries: 0, maxBytes: 1024 * 1024 },
        ),
      ).rejects.toThrow(/file signature/);
    } finally {
      server.stop(true);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("rejects contradictory MIME type (image/jpeg for video)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-mime-"));
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Buffer.alloc(100), {
          headers: { "content-type": "image/jpeg" },
        });
      },
    });

    try {
      await expect(
        downloadMedia(
          {
            index: 0,
            type: "video",
            sourceUrl: server.url.href,
            status: "pending",
          },
          tmp,
          { timeoutMs: 2000, retries: 0, maxBytes: 1024 * 1024 },
        ),
      ).rejects.toThrow(/content-type/);
    } finally {
      server.stop(true);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("successfully downloads verified MP4 video with .mp4 extension", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-ok-"));
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Buffer.concat([mp4Header, Buffer.alloc(100)]), {
          headers: { "content-type": "video/mp4" },
        });
      },
    });

    try {
      const saved = await downloadMedia(
        {
          index: 0,
          type: "video",
          sourceUrl: server.url.href,
          status: "pending",
        },
        tmp,
        { timeoutMs: 2000, retries: 0, maxBytes: 1024 * 1024 },
      );
      expect(saved.fileName).toBe("01.mp4");
      expect(saved.mimeType).toBe("video/mp4");
    } finally {
      server.stop(true);
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Profile pagination & deduplication", () => {
  test("accumulates and deduplicates posts across virtualized scroll steps", () => {
    const batch1 = [
      "/p/POST01/",
      "/p/POST02/",
      "/reel/REEL03/",
      "/p/POST04/",
      "/p/POST05/",
    ];
    const batch2 = [
      "/reel/REEL03/",
      "/p/POST04/",
      "/p/POST05/",
      "/p/POST06/",
      "/p/POST07/",
    ];
    const batch3 = [
      "/p/POST06/",
      "/p/POST07/",
      "/p/POST08/",
      "/reel/REEL09/",
      "/p/POST10/",
    ];

    const collected: string[] = [];
    for (const batch of [batch1, batch2, batch3]) {
      const urls = postLinksFromHrefs(batch);
      for (const u of urls) {
        if (!collected.includes(u)) collected.push(u);
      }
    }

    expect(collected).toHaveLength(10);
    expect(collected[0]).toBe("https://www.instagram.com/p/POST01/");
    expect(collected[2]).toBe("https://www.instagram.com/reel/REEL03/");
    expect(collected[9]).toBe("https://www.instagram.com/p/POST10/");
    const set = new Set(collected);
    expect(set.size).toBe(10);
  });
});

describe("Job progress in API", () => {
  test("updates job progress state through onProgress callbacks", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "dropclip-progress-"));
    try {
      const handler = buildHandler(tmp, (inputUrl) => {
        return {
          inputUrl,
          outDir: tmp,
          maxPosts: 5,
        } as unknown as CrawlOptions;
      });

      const server = Bun.serve({ port: 0, fetch: handler });
      try {
        const createRes = await fetch(`${server.url.href}jobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: "https://www.instagram.com/p/TEST_PROGRESS/",
          }),
        });
        expect(createRes.status).toBe(202);
        const job = (await createRes.json()) as JobState;

        const getRes = await fetch(`${server.url.href}jobs/${job.id}`);
        expect(getRes.status).toBe(200);
        const fetchedJob = (await getRes.json()) as JobState;
        expect(["queued", "running", "succeeded", "failed"]).toContain(
          fetchedJob.status,
        );
      } finally {
        server.stop(true);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
